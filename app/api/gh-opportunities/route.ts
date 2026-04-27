import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { resolveMapping, updateOpportunityStage, updateOpportunity, deleteOpportunity, createOpportunity, stageIdToProspectStatus } from '@/lib/ghl-opportunities';
import { createGhlContact, findGhlContactByEmail } from '@/lib/ghl';

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

  // Push to GHL
  if (newStageId !== undefined) {
    await updateOpportunityStage(opp.ghl_opportunity_id, opp.pipeline_id, newStageId).catch(() => null);
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

  return NextResponse.json({ ok: true, prospect_status, stage_name: stage?.name || null });
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
