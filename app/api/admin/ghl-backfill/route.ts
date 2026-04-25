import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
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

// One-shot backfill from GHL since a given start date.
// POST /api/admin/ghl-backfill?since=2026-04-12
//
// Strategy:
//   1. Resolve the "Pipeline Bourbon Média" — get its ID + stage IDs.
//   2. Pull every appointment from the 3 calendars (closing/onboarding/tournage)
//      since `since`. For each, upsert into gh_appointments.
//   3. Pull every opportunity in the pipeline since `since`. For each, find
//      the matching appointment by contactId+pipeline and enrich with the
//      opportunity name + stage. If no appointment exists for an opportunity,
//      we skip it (we only mirror appointments-with-context, not raw leads).

const DEFAULT_SINCE = '2026-04-12';

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

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const url = req.nextUrl;
  const sinceStr = url.searchParams.get('since') || DEFAULT_SINCE;
  const sinceIso = new Date(`${sinceStr}T00:00:00Z`).toISOString();
  const nowIso = new Date().toISOString();

  const summary = {
    since: sinceStr,
    pipeline_resolved: false,
    pipeline_name: '',
    pipeline_id: '',
    stages_mapped: 0,
    expected_stages: [] as string[],
    actual_ghl_stages: [] as string[],
    unmapped_stages: [] as string[],
    appointments_processed: 0,
    appointments_inserted: 0,
    appointments_updated: 0,
    appointments_enriched_with_opportunity: 0,
    opportunities_seen: 0,
    per_calendar: {} as Record<string, { kind: string; events: number; error?: string }>,
    errors: [] as string[],
  };

  // 1. Pipeline mapping
  const { mapping, pipeline } = await resolveMapping();
  summary.expected_stages = Object.keys(mapping.stages);
  if (pipeline) {
    summary.pipeline_resolved = true;
    summary.pipeline_name = pipeline.name;
    summary.pipeline_id = pipeline.id;
    summary.stages_mapped = Object.keys(mapping.stage_ids || {}).length;
    summary.actual_ghl_stages = pipeline.stages.map(s => s.name);
    summary.unmapped_stages = summary.expected_stages.filter(name => !(mapping.stage_ids || {})[name]);
  } else {
    summary.errors.push(`Pipeline "${mapping.pipeline_name}" introuvable dans GHL`);
  }

  // 2. Pull opportunities in the pipeline since `since` and mirror them
  const oppsByContact = new Map<string, { id: string; name: string; pipelineId: string; pipelineStageId: string }>();
  if (pipeline) {
    const opps = await listOpportunitiesByPipeline(pipeline.id);
    summary.opportunities_seen = opps.length;
    for (const o of opps) {
      if (o.contactId) oppsByContact.set(o.contactId, {
        id: o.id, name: o.name, pipelineId: o.pipelineId, pipelineStageId: o.pipelineStageId,
      });

      // Mirror to gh_opportunities for funnel metrics
      const stage = pipeline.stages.find(s => s.id === o.pipelineStageId);
      const oppRow: Record<string, unknown> = {
        ghl_opportunity_id: o.id,
        ghl_contact_id: o.contactId || null,
        pipeline_id: o.pipelineId,
        pipeline_stage_id: o.pipelineStageId,
        pipeline_stage_name: stage?.name || null,
        name: o.name || null,
        monetary_value_cents: o.monetaryValue ? Math.round(o.monetaryValue * 100) : null,
        prospect_status: stageIdToProspectStatus(mapping, o.pipelineStageId),
        ghl_created_at: o.createdAt ? new Date(o.createdAt).toISOString() : null,
        ghl_updated_at: o.updatedAt ? new Date(o.updatedAt).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      await supaFetch('gh_opportunities?on_conflict=ghl_opportunity_id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(oppRow),
      }, true).catch(() => null);
    }
  }

  // 3. Pull appointments from each calendar since `since`
  const calendars: { id: string; envName: string }[] = [
    { id: CLOSING_ID,    envName: 'GHL_CLOSING_CALENDAR_ID' },
    { id: ONBOARDING_ID, envName: 'GHL_ONBOARDING_CALENDAR_ID' },
    { id: FILMING_ID,    envName: 'GHL_FILMING_CALENDAR_ID' },
  ];

  for (const cal of calendars) {
    if (!cal.id) {
      summary.errors.push(`${cal.envName} non défini`);
      continue;
    }
    const { events, error } = await listCalendarEvents(cal.id, sinceIso, nowIso);
    const kind = cal.envName.replace('GHL_', '').replace('_CALENDAR_ID', '').toLowerCase();
    summary.per_calendar[cal.id] = { kind, events: events.length, ...(error ? { error } : {}) };
    if (error) summary.errors.push(`${cal.envName}: ${error}`);
    for (const ev of events) {
      summary.appointments_processed++;

      // Resolve contact info (the calendar event API doesn't always include it)
      const contact = ev.contactId ? await getContact(ev.contactId) : null;

      const calendarKind = classifyCalendar(cal.id);
      const status = normalizeStatus(ev.appointmentStatus);

      // Match to a Bourbomedia client (best effort)
      const clientId = await matchClientFromContact({
        ghl_contact_id: ev.contactId || null,
        email: contact?.email || null,
        phone: contact?.phone || null,
        first_name: contact?.firstName || null,
        last_name: contact?.lastName || null,
      });

      // Look up the matching opportunity (only meaningful for closing calls)
      let opp = ev.contactId ? oppsByContact.get(ev.contactId) : null;
      // Fallback : per-contact lookup if the pipeline-wide fetch returned nothing
      // (the GHL /opportunities/search?pipeline_id endpoint is sometimes empty
      // even with valid data — querying by contact is more reliable).
      if (!opp && ev.contactId && calendarKind === 'closing') {
        const contactOpps = await listOpportunitiesByContact(ev.contactId);
        const inPipeline = pipeline ? contactOpps.find(o => o.pipelineId === pipeline.id) : contactOpps[0];
        if (inPipeline) {
          opp = {
            id: inPipeline.id,
            name: inPipeline.name,
            pipelineId: inPipeline.pipelineId,
            pipelineStageId: inPipeline.pipelineStageId,
          };
          // Mirror to gh_opportunities so the funnel metrics see it
          const stage = pipeline?.stages.find(s => s.id === inPipeline.pipelineStageId);
          await supaFetch('gh_opportunities?on_conflict=ghl_opportunity_id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              ghl_opportunity_id: inPipeline.id,
              ghl_contact_id: inPipeline.contactId,
              pipeline_id: inPipeline.pipelineId,
              pipeline_stage_id: inPipeline.pipelineStageId,
              pipeline_stage_name: stage?.name || null,
              name: inPipeline.name || null,
              monetary_value_cents: inPipeline.monetaryValue ? Math.round(inPipeline.monetaryValue * 100) : null,
              prospect_status: stageIdToProspectStatus(mapping, inPipeline.pipelineStageId),
              ghl_created_at: inPipeline.createdAt ? new Date(inPipeline.createdAt).toISOString() : null,
              ghl_updated_at: inPipeline.updatedAt ? new Date(inPipeline.updatedAt).toISOString() : null,
              updated_at: new Date().toISOString(),
            }),
          }, true).catch(() => null);
        }
      }
      let opportunity_id: string | null = null;
      let opportunity_name: string | null = null;
      let pipeline_id: string | null = null;
      let pipeline_stage_id: string | null = null;
      let pipeline_stage_name: string | null = null;
      let prospect_status: string | null = null;

      if (opp && calendarKind === 'closing') {
        opportunity_id = opp.id;
        opportunity_name = opp.name || null;
        pipeline_id = opp.pipelineId;
        pipeline_stage_id = opp.pipelineStageId;
        const stage = pipeline?.stages.find(s => s.id === pipeline_stage_id);
        pipeline_stage_name = stage?.name || null;
        prospect_status = stageIdToProspectStatus(mapping, pipeline_stage_id);
        summary.appointments_enriched_with_opportunity++;
      }

      const fullName = contact?.name
        || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim()
        || null;

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
        opportunity_id,
        opportunity_name,
        pipeline_id,
        pipeline_stage_id,
        pipeline_stage_name,
        updated_at: new Date().toISOString(),
      };
      if (prospect_status) row.prospect_status = prospect_status;

      // Check existing row to count insert vs update
      const existsRes = await supaFetch(
        `gh_appointments?ghl_appointment_id=eq.${encodeURIComponent(ev.id)}&select=id&limit=1`,
        {}, true,
      );
      const existing = existsRes.ok ? await existsRes.json() : [];
      const wasNew = existing.length === 0;

      const upsert = await supaFetch('gh_appointments?on_conflict=ghl_appointment_id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      }, true);
      if (upsert.ok) {
        if (wasNew) summary.appointments_inserted++;
        else summary.appointments_updated++;
      } else {
        const txt = await upsert.text().catch(() => '');
        summary.errors.push(`upsert failed for ${ev.id}: ${txt.slice(0, 100)}`);
      }
    }
  }

  return NextResponse.json(summary);
}
