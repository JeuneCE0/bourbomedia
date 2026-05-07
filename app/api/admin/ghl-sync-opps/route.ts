import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { resolveMapping, listOpportunitiesByPipeline, stageIdToProspectStatus } from '@/lib/ghl-opportunities';

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
  try {
    const opps = await listOpportunitiesByPipeline(pipeline.id);
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
    return NextResponse.json({ ok: false, error: (e as Error).message, synced }, { status: 200 });
  }

  return NextResponse.json({ ok: true, synced, pipeline: pipeline.name });
}
