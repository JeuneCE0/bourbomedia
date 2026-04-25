import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { notifyAppointmentCompleted } from '@/lib/slack';
import { triggerWorkflow } from '@/lib/ghl-workflows';
import { resolveMapping, prospectStatusToStageId, updateOpportunityStage } from '@/lib/ghl-opportunities';

// Runs every 15 min. GHL workflow auto-confirms appointments on booking and
// doesn't transition them to "Showed" automatically — so we infer "the call
// happened" from the clock: starts_at is past, status is still scheduled, and
// it wasn't cancelled or marked no-show.
//
// On every fresh past appointment (reminded_at IS NULL):
//   - For closings : auto-set prospect_status = 'awaiting_signature' (happy
//     path default — admin can override later if the call went badly), push
//     the stage to GHL, and fire the workflow that emails the onboarding
//     link to the prospect.
//   - For everything else : just ping Slack so Simeon can document.

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  // Only ping for appointments that ended at least 15 min ago — gives a buffer
  // so we don't spam during a call that's running long.
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const r = await supaFetch(
    `gh_appointments?starts_at=lt.${encodeURIComponent(cutoff)}`
    + `&reminded_at=is.null`
    + `&notes_completed_at=is.null`
    + `&status=in.(scheduled,completed)`
    + `&select=id,ghl_appointment_id,ghl_contact_id,opportunity_id,prospect_status,calendar_kind,starts_at,contact_name,contact_email`
    + `&order=starts_at.asc&limit=20`,
    {}, true,
  );

  if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const items = await r.json();

  // Resolve pipeline mapping once for all closings in this batch
  const { mapping } = await resolveMapping();
  const target = prospectStatusToStageId(mapping, 'awaiting_signature');

  let pinged = 0;
  let autoFlipped = 0;
  let onboardingSent = 0;

  for (const a of items) {
    try {
      // Closing happy path : auto-set awaiting_signature + send onboarding link
      if (a.calendar_kind === 'closing' && !a.prospect_status) {
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ prospect_status: 'awaiting_signature' }),
        }, true);
        autoFlipped++;

        // Push to GHL pipeline (best effort)
        if (a.opportunity_id && target.pipelineId && target.stageId) {
          await updateOpportunityStage(a.opportunity_id, target.pipelineId, target.stageId).catch(() => null);
        }

        // Fire the workflow (no-op when AUTOMATIONS_PAUSED=true)
        const res = await triggerWorkflow(a.ghl_contact_id || null, 'prospect_awaiting_signature').catch(() => null);
        if (res && (res.tagged || res.workflowAdded)) onboardingSent++;
      }

      await notifyAppointmentCompleted({
        contactName: a.contact_name || a.contact_email || 'Contact GHL',
        contactEmail: a.contact_email || undefined,
        calendarKind: a.calendar_kind,
        startsAt: a.starts_at,
        appointmentId: a.ghl_appointment_id,
      });
      await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ reminded_at: nowIso }),
      }, true);
      pinged++;
    } catch { /* tolerate, will retry next tick */ }
  }

  return NextResponse.json({ checked: items.length, pinged, auto_flipped_to_awaiting_signature: autoFlipped, onboarding_workflow_fired: onboardingSent, at: nowIso });
}
