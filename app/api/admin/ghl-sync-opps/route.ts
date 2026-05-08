import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { resolveMapping, listOpportunitiesByPipeline, stageIdToProspectStatus, getContact } from '@/lib/ghl-opportunities';

// Sync léger GHL → gh_opportunities. Ne fait PAS les calendars/RDVs (vs
// /api/admin/ghl-backfill) — pensé pour être appelé fréquemment depuis
// la page Pipeline (toutes les 60s) afin de rendre l'apparition d'un
// nouvel optin GHL quasi-temps-réel sans cron Vercel.
//
// Idempotent : upsert via on_conflict=ghl_opportunity_id. Dupliqué d'un
// run en cours = no-op (les writes Supabase tolèrent les conflits).
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { mapping, pipeline } = await resolveMapping();
  if (!pipeline) {
    return NextResponse.json({ ok: false, error: 'Pipeline GHL introuvable' }, { status: 200 });
  }

  let synced = 0;
  let enriched = 0;
  try {
    const opps = await listOpportunitiesByPipeline(pipeline.id);

    // Pré-fetch les rows déjà miroirées pour savoir lesquelles n'ont pas
    // encore email/phone — on n'enrichit QUE celles-là (économise des
    // appels GHL contacts pour les opps déjà complètes). Les nouveaux
    // opps n'auront pas de row → on enrichit aussi.
    const idsList = opps.map(o => o.id).filter(Boolean);
    type ExistingRow = { ghl_opportunity_id: string; contact_email: string | null; contact_phone: string | null; contact_name: string | null };
    const existing = new Map<string, ExistingRow>();
    if (idsList.length > 0) {
      const inList = idsList.map(id => `"${id}"`).join(',');
      const r = await supaFetch(
        `gh_opportunities?ghl_opportunity_id=in.(${encodeURIComponent(inList)})`
        + `&select=ghl_opportunity_id,contact_email,contact_phone,contact_name`,
        {}, true,
      ).catch(() => null);
      if (r?.ok) {
        const rows: ExistingRow[] = await r.json();
        for (const row of rows) existing.set(row.ghl_opportunity_id, row);
      }
    }

    await Promise.all(opps.map(async (o) => {
      if (!o.contactId) return;
      const stage = pipeline.stages.find(s => s.id === o.pipelineStageId);

      // Lookup client lié best-effort, ne bloque jamais le sync
      const clientLookup = await supaFetch(
        `clients?ghl_contact_id=eq.${encodeURIComponent(o.contactId)}&select=id&limit=1`,
        {}, true,
      ).catch(() => null);
      const clientArr = clientLookup?.ok ? await clientLookup.json() : [];
      const linkedClientId = clientArr[0]?.id || null;

      // Enrichissement contact : si la row existante n'a ni email ni phone,
      // on tape /contacts/{id} pour les récupérer. Sans ça, le picker
      // "Depuis prospect" filtré par email ne trouve rien parce que
      // contact_email reste null en DB locale.
      const exist = existing.get(o.id);
      const needsEnrich = !exist || (!exist.contact_email && !exist.contact_phone);
      let contactEmail: string | null = exist?.contact_email || null;
      let contactPhone: string | null = exist?.contact_phone || null;
      let contactName: string | null = exist?.contact_name || null;
      if (needsEnrich) {
        try {
          const c = await getContact(o.contactId);
          if (c) {
            contactEmail = c.email || contactEmail;
            contactPhone = c.phone || contactPhone;
            contactName = c.name
              || [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
              || contactName;
            enriched++;
          }
        } catch { /* tolerate */ }
      }

      await supaFetch('gh_opportunities?on_conflict=ghl_opportunity_id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          ghl_opportunity_id: o.id,
          ghl_contact_id: o.contactId,
          client_id: linkedClientId,
          pipeline_id: o.pipelineId,
          pipeline_stage_id: o.pipelineStageId,
          pipeline_stage_name: stage?.name || null,
          name: o.name || null,
          contact_email: contactEmail,
          contact_phone: contactPhone,
          contact_name: contactName,
          monetary_value_cents: o.monetaryValue ? Math.round(o.monetaryValue * 100) : null,
          prospect_status: stageIdToProspectStatus(mapping, o.pipelineStageId),
          ghl_created_at: o.createdAt ? new Date(o.createdAt).toISOString() : null,
          ghl_updated_at: o.updatedAt ? new Date(o.updatedAt).toISOString() : null,
          updated_at: new Date().toISOString(),
        }),
      }, true).catch(() => null);
      synced++;
    }));
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message, synced, enriched }, { status: 200 });
  }

  return NextResponse.json({ ok: true, synced, enriched, pipeline: pipeline.name });
}
