import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { classifyCalendar, matchClientFromContact } from '@/lib/ghl-appointments';
import {
  resolveMapping,
  listOpportunitiesByPipeline,
  listOpportunitiesByContact,
  listCalendarEvents,
  getContact,
  stageIdToProspectStatus,
} from '@/lib/ghl-opportunities';

// Polls GHL every 15 min as a safety net — even if the GHL workflow webhook
// isn't configured perfectly, every booking shows up within 15 min.
//
// Pulls only the last 48h to stay fast — the backfill endpoint covers older
// data. Mirrors both calendar events and opportunities, just like the backfill.

const CLOSING_ID    = process.env.GHL_CLOSING_CALENDAR_ID    || '';
const ONBOARDING_ID = process.env.GHL_ONBOARDING_CALENDAR_ID || '';
const FILMING_ID    = process.env.GHL_FILMING_CALENDAR_ID    || '';

function normalizeStatus(raw: string | undefined): 'scheduled' | 'completed' | 'cancelled' | 'no_show' {
  const s = (raw || '').toLowerCase();
  if (s.includes('show') && s.includes('no')) return 'no_show';
  if (s === 'noshow' || s === 'no-show') return 'no_show';
  if (s.includes('cancel')) return 'cancelled';
  if (s === 'showed' || s === 'completed' || s === 'confirmed_show') return 'completed';
  return 'scheduled';
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  // Window : -48h to +14d to capture both newly past and freshly booked appointments
  const fromIso = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
  const toIso = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();

  const summary = { window_from: fromIso, window_to: toIso, processed: 0, inserted: 0, updated: 0, opps_synced: 0 };

  const { mapping, pipeline } = await resolveMapping();

  // Pull all opportunities once per run (cached lookup for appointment enrichment)
  const oppsByContact = new Map<string, { id: string; name: string; pipelineId: string; pipelineStageId: string }>();
  if (pipeline) {
    const opps = await listOpportunitiesByPipeline(pipeline.id);
    for (const o of opps) {
      if (o.contactId) {
        oppsByContact.set(o.contactId, {
          id: o.id, name: o.name, pipelineId: o.pipelineId, pipelineStageId: o.pipelineStageId,
        });
        // Mirror to gh_opportunities + link to bourbomedia client by ghl_contact_id
        const stage = pipeline.stages.find(s => s.id === o.pipelineStageId);
        const clientLookup = await supaFetch(
          `clients?ghl_contact_id=eq.${encodeURIComponent(o.contactId)}&select=id&limit=1`,
          {}, true,
        );
        const clientArr = clientLookup.ok ? await clientLookup.json() : [];
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
        summary.opps_synced++;
      }
    }
  }

  const calendars = [
    { id: CLOSING_ID,    envName: 'GHL_CLOSING_CALENDAR_ID' },
    { id: ONBOARDING_ID, envName: 'GHL_ONBOARDING_CALENDAR_ID' },
    { id: FILMING_ID,    envName: 'GHL_FILMING_CALENDAR_ID' },
  ];

  for (const cal of calendars) {
    if (!cal.id) continue;
    const { events } = await listCalendarEvents(cal.id, fromIso, toIso);
    for (const ev of events) {
      summary.processed++;

      const contact = ev.contactId ? await getContact(ev.contactId) : null;
      const calendarKind = classifyCalendar(cal.id);
      const status = normalizeStatus(ev.appointmentStatus);

      const clientId = await matchClientFromContact({
        ghl_contact_id: ev.contactId || null,
        email: contact?.email || null,
        phone: contact?.phone || null,
        first_name: contact?.firstName || null,
        last_name: contact?.lastName || null,
      });

      let opp = ev.contactId ? oppsByContact.get(ev.contactId) : null;
      if (!opp && ev.contactId && calendarKind === 'closing') {
        const contactOpps = await listOpportunitiesByContact(ev.contactId);
        const inPipeline = pipeline ? contactOpps.find(o => o.pipelineId === pipeline.id) : contactOpps[0];
        if (inPipeline) opp = {
          id: inPipeline.id, name: inPipeline.name,
          pipelineId: inPipeline.pipelineId, pipelineStageId: inPipeline.pipelineStageId,
        };
      }

      const fullName = contact?.name
        || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim()
        || null;

      const stage = opp ? pipeline?.stages.find(s => s.id === opp.pipelineStageId) : null;
      const row: Record<string, unknown> = {
        ghl_appointment_id: ev.id,
        ghl_calendar_id: cal.id,
        ghl_contact_id: ev.contactId || null,
        calendar_kind: calendarKind,
        status,
        starts_at: new Date(ev.startTime).toISOString(),
        ends_at: ev.endTime ? new Date(ev.endTime).toISOString() : null,
        contact_email: contact?.email || null,
        contact_phone: contact?.phone || null,
        contact_name: fullName,
        client_id: clientId,
        opportunity_id: opp?.id || null,
        opportunity_name: opp?.name || null,
        pipeline_id: opp?.pipelineId || null,
        pipeline_stage_id: opp?.pipelineStageId || null,
        pipeline_stage_name: stage?.name || null,
        updated_at: new Date().toISOString(),
      };

      // Detect whether this is a new row to count inserts vs updates
      const existsRes = await supaFetch(
        `gh_appointments?ghl_appointment_id=eq.${encodeURIComponent(ev.id)}&select=id&limit=1`,
        {}, true,
      );
      const wasNew = existsRes.ok ? (await existsRes.json()).length === 0 : false;

      const upsert = await supaFetch('gh_appointments?on_conflict=ghl_appointment_id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      }, true);
      if (upsert.ok) {
        if (wasNew) summary.inserted++;
        else summary.updated++;
      }
    }
  }

  return NextResponse.json(summary);
}
