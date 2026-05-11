import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { resolveMapping, updateOpportunityStage, updateOpportunity, deleteOpportunity, createOpportunity, stageIdToProspectStatus } from '@/lib/ghl-opportunities';
import { createGhlContact, findGhlContactByEmail, ghlRequest } from '@/lib/ghl';
import { sendSlackNotification } from '@/lib/slack';
import { sendPushToAll } from '@/lib/push';

// GET /api/gh-opportunities
//   - Returns all opportunities mirrored from the GHL "Pipeline Bourbon Media"
//   - Plus the live stage definitions in their GHL order, so the kanban can
//     render columns the same way as GHL.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { pipeline } = await resolveMapping();

  const r = await supaFetch(
    'gh_opportunities?select=*&order=ghl_created_at.desc.nullslast&limit=2000',
    {}, true,
  );
  const opportunities = r.ok ? await r.json() : [];

  // Enrichissement à la volée : pour chaque opp avec ghl_contact_id mais sans
  // contact_email/phone (le webhook GHL n'inclut pas toujours les détails du
  // contact), on fetch la fiche contact GHL en arrière-plan et on persiste.
  // Limité à 20 par requête pour ne pas saturer GHL.
  const toEnrich = opportunities
    .filter((o: { ghl_contact_id: string | null; contact_email: string | null; contact_phone: string | null }) =>
      o.ghl_contact_id && (!o.contact_email || !o.contact_phone))
    .slice(0, 20);

  if (toEnrich.length > 0) {
    await Promise.all(toEnrich.map(async (o: { id: string; ghl_contact_id: string; contact_email: string | null; contact_phone: string | null; contact_name: string | null }) => {
      try {
        const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(o.ghl_contact_id)}`);
        const c = data?.contact || data;
        if (!c) return;
        const newEmail = o.contact_email || c.email || null;
        const newPhone = o.contact_phone || c.phone || null;
        const newName = o.contact_name
          || c.contactName
          || c.name
          || [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
          || c.companyName
          || null;
        if (newEmail !== o.contact_email || newPhone !== o.contact_phone || newName !== o.contact_name) {
          await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(o.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              contact_email: newEmail,
              contact_phone: newPhone,
              contact_name: newName,
            }),
          }, true).catch(() => null);
          // Mute la mutation locale pour la réponse
          o.contact_email = newEmail;
          o.contact_phone = newPhone;
          o.contact_name = newName;
        }
      } catch { /* tolerate */ }
    }));
  }

  return NextResponse.json({
    stages: pipeline ? pipeline.stages.map(s => ({ id: s.id, name: s.name })) : [],
    opportunities,
  });
}

// POST /api/gh-opportunities — Quick-add prospect manuellement
// body : { name, email, phone?, monetary_value_cents?, stage_name? }
//   1. Find or create the GHL contact (by email)
//   2. Create the opportunity in GHL on the first stage of Pipeline Bourbon
//   3. Mirror dans gh_opportunities (le webhook GHL le fera aussi mais on
//      le crée tout de suite pour réactivité immédiate)
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = (body.name as string || '').trim();
  const email = (body.email as string || '').trim();
  const phone = (body.phone as string || '').trim();
  const monetaryCents = body.monetary_value_cents as number | undefined;
  const stageName = body.stage_name as string | undefined;

  if (!name || !email) return NextResponse.json({ error: 'name et email requis' }, { status: 400 });

  const { pipeline } = await resolveMapping();
  if (!pipeline) return NextResponse.json({ error: 'Pipeline GHL introuvable' }, { status: 500 });

  // Find or create the GHL contact
  let contactId: string | null = null;
  try {
    contactId = await findGhlContactByEmail(email);
    if (!contactId) {
      const parts = name.trim().split(/\s+/);
      const firstName = parts[0] || name;
      const lastName = parts.slice(1).join(' ') || '';
      contactId = await createGhlContact({ firstName, lastName, email, phone: phone || undefined });
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: 'Création contact GHL échouée: ' + (e as Error).message }, { status: 500 });
  }
  if (!contactId) return NextResponse.json({ error: 'Impossible de créer le contact GHL' }, { status: 500 });

  // Pick stage (default first)
  const targetStage = stageName
    ? pipeline.stages.find(s => s.name.toLowerCase().includes(stageName.toLowerCase())) || pipeline.stages[0]
    : pipeline.stages[0];
  if (!targetStage) return NextResponse.json({ error: 'Aucun stage GHL disponible' }, { status: 500 });

  // Create opportunity in GHL
  const created = await createOpportunity({
    pipelineId: pipeline.id,
    pipelineStageId: targetStage.id,
    contactId,
    name,
    monetaryValue: monetaryCents ? monetaryCents / 100 : undefined,
  });
  if (!created) return NextResponse.json({ error: 'Création opportunité GHL échouée' }, { status: 500 });

  // Mirror in our DB
  await supaFetch('gh_opportunities?on_conflict=ghl_opportunity_id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      ghl_opportunity_id: created.id,
      ghl_contact_id: contactId,
      pipeline_id: pipeline.id,
      pipeline_stage_id: targetStage.id,
      pipeline_stage_name: targetStage.name,
      name,
      contact_email: email,
      contact_phone: phone || null,
      contact_name: name,
      monetary_value_cents: monetaryCents || null,
      ghl_created_at: new Date().toISOString(),
      ghl_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }, true).catch(() => null);

  // Slack + push notifications (best-effort)
  const valueLabel = monetaryCents ? ` · ${(monetaryCents / 100).toLocaleString('fr-FR')} €` : '';
  sendSlackNotification({
    text: `🎯 Nouveau prospect — ${name}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Nouveau prospect 🎯', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Nom:*\n${name}` },
        { type: 'mrkdwn', text: `*Email:*\n${email}` },
        { type: 'mrkdwn', text: `*Stage:*\n${targetStage.name}` },
        ...(monetaryCents ? [{ type: 'mrkdwn', text: `*Valeur:*\n${(monetaryCents / 100).toLocaleString('fr-FR')} €` }] : []),
      ]},
    ],
  }).catch(() => null);
  sendPushToAll({
    title: '🎯 Nouveau prospect',
    body: `${name}${valueLabel}`,
    url: `/dashboard/pipeline?q=${encodeURIComponent(name)}`,
    tag: `prospect-${created.id}`,
  }).catch(() => null);

  return NextResponse.json({ ok: true, opportunityId: created.id, contactId });
}

// PATCH /api/gh-opportunities  body: { id, pipeline_stage_id?, monetary_value_cents?, name? }
//   - Updates the opportunity in our DB
//   - Pushes the change(s) to GHL (pipeline stage, value, name)
//   - Mirrors the new prospect_status on the linked appointment if any
export async function PATCH(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  const newStageId = body.pipeline_stage_id as string | undefined;
  const newValueCents = body.monetary_value_cents as number | undefined;
  const newName = body.name as string | undefined;

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  if (newStageId === undefined && newValueCents === undefined && newName === undefined) {
    return NextResponse.json({ error: 'no field to update' }, { status: 400 });
  }

  // Look up the opportunity to get pipeline_id + ghl_opportunity_id
  const lookupRes = await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, {}, true);
  if (!lookupRes.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const rows = await lookupRes.json();
  const opp = rows[0];
  if (!opp) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { mapping, pipeline } = await resolveMapping();
  const stage = newStageId ? pipeline?.stages.find(s => s.id === newStageId) : null;
  const prospect_status = newStageId ? stageIdToProspectStatus(mapping, newStageId) : undefined;

  // Build the patch for our row
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (newStageId !== undefined) {
    dbPatch.pipeline_stage_id = newStageId;
    dbPatch.pipeline_stage_name = stage?.name || null;
    if (prospect_status !== undefined) dbPatch.prospect_status = prospect_status;
  }
  if (newValueCents !== undefined) dbPatch.monetary_value_cents = newValueCents;
  if (newName !== undefined) dbPatch.name = newName;

  await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dbPatch),
  }, true);

  // Push to GHL — on remonte le résultat dans la réponse pour que
  // l'UI puisse surfacer un échec (typiquement AUTOMATIONS_PAUSED ou
  // erreur API GHL).
  let ghlSync: { ok: boolean; reason?: string } = { ok: true };
  if (newStageId !== undefined) {
    ghlSync = await updateOpportunityStage(opp.ghl_opportunity_id, opp.pipeline_id, newStageId)
      .catch((e: unknown) => ({ ok: false, reason: (e as Error).message || 'exception' }));
  }
  if (newValueCents !== undefined || newName !== undefined) {
    const fields: { monetaryValue?: number; name?: string } = {};
    if (newValueCents !== undefined) fields.monetaryValue = newValueCents / 100; // GHL stores in EUR units
    if (newName !== undefined) fields.name = newName;
    await updateOpportunity(opp.ghl_opportunity_id, fields).catch(() => null);
  }

  // Mirror stage change to the linked appointment(s)
  if (opp.ghl_opportunity_id && newStageId !== undefined) {
    await supaFetch(
      `gh_appointments?opportunity_id=eq.${encodeURIComponent(opp.ghl_opportunity_id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          pipeline_stage_id: newStageId,
          pipeline_stage_name: stage?.name || null,
          ...(prospect_status ? { prospect_status } : {}),
          updated_at: new Date().toISOString(),
        }),
      },
      true,
    ).catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    prospect_status,
    stage_name: stage?.name || null,
    ghl_sync: ghlSync,
  });
}

// DELETE /api/gh-opportunities  body: { id }
//   - Deletes the opportunity in our DB
//   - Pushes DELETE to GHL (best effort)
//   - Cascade : un-link gh_appointments (set opportunity_id to NULL)
export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  // Fetch ghl_opportunity_id for the GHL-side delete
  const lookupRes = await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(id)}&select=ghl_opportunity_id&limit=1`, {}, true);
  if (!lookupRes.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const rows = await lookupRes.json();
  const opp = rows[0];
  if (!opp) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Un-link any appointments pointing to this opportunity (don't delete them)
  if (opp.ghl_opportunity_id) {
    await supaFetch(
      `gh_appointments?opportunity_id=eq.${encodeURIComponent(opp.ghl_opportunity_id)}`,
      { method: 'PATCH', body: JSON.stringify({ opportunity_id: null }) },
      true,
    ).catch(() => null);
  }

  // Delete from our DB
  const r = await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, true);
  if (!r.ok) return NextResponse.json({ error: 'delete failed' }, { status: 500 });

  // Best-effort delete in GHL (will resync on next backfill if user undoes)
  if (opp.ghl_opportunity_id) {
    await deleteOpportunity(opp.ghl_opportunity_id).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
