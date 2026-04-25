import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { resolveMapping, updateOpportunityStage, stageIdToProspectStatus } from '@/lib/ghl-opportunities';

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

// PATCH /api/gh-opportunities  body: { id, pipeline_stage_id }
//   - Moves the opportunity in our DB to the new stage
//   - Pushes the change to GHL pipeline
//   - Mirrors the new prospect_status on the linked appointment if any
export async function PATCH(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  const newStageId = body.pipeline_stage_id as string | undefined;
  if (!id || !newStageId) return NextResponse.json({ error: 'missing id or pipeline_stage_id' }, { status: 400 });

  // Look up the opportunity to get pipeline_id + ghl_opportunity_id
  const lookupRes = await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, {}, true);
  if (!lookupRes.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const rows = await lookupRes.json();
  const opp = rows[0];
  if (!opp) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { mapping, pipeline } = await resolveMapping();
  const stage = pipeline?.stages.find(s => s.id === newStageId);
  const prospect_status = stageIdToProspectStatus(mapping, newStageId);

  // Update our row
  await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      pipeline_stage_id: newStageId,
      pipeline_stage_name: stage?.name || null,
      prospect_status,
      updated_at: new Date().toISOString(),
    }),
  }, true);

  // Push to GHL
  await updateOpportunityStage(opp.ghl_opportunity_id, opp.pipeline_id, newStageId).catch(() => null);

  // Mirror to the linked appointment(s)
  if (opp.ghl_opportunity_id) {
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
