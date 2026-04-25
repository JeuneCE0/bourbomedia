import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { WORKFLOWS, listGhlWorkflows } from '@/lib/ghl-workflows';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const ghlConfigured = !!(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
  const automationsPaused = process.env.AUTOMATIONS_PAUSED === 'true';
  const liveWorkflows = ghlConfigured && !automationsPaused ? await listGhlWorkflows() : [];
  // Map each canonical workflow to whether the user has set up a workflow that
  // matches the expected name pattern (best-effort heuristic).
  const expected = Object.entries(WORKFLOWS).map(([key, def]) => ({
    event: key,
    tag: def.tag,
    label: def.label,
    channels: def.channels,
    trigger: def.trigger,
    copyHint: def.copyHint,
    workflowConfigured: !!process.env[`GHL_WORKFLOW_ID_${key.toUpperCase()}`],
    matchedGhl: liveWorkflows.find(w => w.name?.toLowerCase().includes(def.tag.toLowerCase()) || w.name?.toLowerCase().includes(def.label.toLowerCase())) || null,
  }));
  return NextResponse.json({
    ghlConfigured,
    notificationsEnabled: process.env.NOTIFICATIONS_ENABLED === 'true',
    automationsPaused,
    workflows: expected,
    liveWorkflowCount: liveWorkflows.length,
  });
}
