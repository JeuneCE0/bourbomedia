import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { classifyCalendar, matchClientFromContact } from '@/lib/ghl-appointments';
import { notifyAppointmentCompleted } from '@/lib/slack';
import { listOpportunitiesByContact, resolveMapping, stageIdToProspectStatus } from '@/lib/ghl-opportunities';

// GHL workflows POST appointment events here. Configure in GHL:
//   Settings → Webhooks → URL = https://<host>/api/webhooks/ghl/appointment?secret=<GHL_WEBHOOK_SECRET>
// Trigger on Appointment Created / Status Changed (Confirmed, Showed, No Show, Cancelled).
//
// We expect a payload roughly shaped like the GHL "Appointment" trigger:
//   { type, appointment: { id, calendarId, contactId, startTime, endTime, appointmentStatus },
//     contact: { id, email, phone, firstName, lastName, name } }
// We tolerate the flat shape too (top-level appointment fields).

type GhlPayload = {
  type?: string;
  event?: string;
  appointment?: Record<string, unknown>;
  contact?: Record<string, unknown>;
} & Record<string, unknown>;

function pick<T = string>(obj: Record<string, unknown> | undefined, ...keys: string[]): T | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}

function normalizeStatus(raw: string | undefined): 'scheduled' | 'completed' | 'cancelled' | 'no_show' {
  const s = (raw || '').toLowerCase();
  if (s.includes('show') && s.includes('no')) return 'no_show';
  if (s === 'noshow' || s === 'no-show') return 'no_show';
  if (s.includes('cancel')) return 'cancelled';
  if (s === 'showed' || s === 'completed' || s === 'confirmed_show') return 'completed';
  return 'scheduled';
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || '';
  const expected = process.env.GHL_WEBHOOK_SECRET || '';
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: GhlPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // GHL sometimes nests under "appointment", sometimes flat
  const appt = (payload.appointment as Record<string, unknown>) || payload;
  const contact = (payload.contact as Record<string, unknown>) || {};

  const ghlAppointmentId = pick<string>(appt, 'id', 'appointmentId', '_id');
  const ghlCalendarId = pick<string>(appt, 'calendarId', 'calendar_id') || '';
  const ghlContactId = pick<string>(appt, 'contactId', 'contact_id') || pick<string>(contact, 'id', '_id') || '';
  const startsAt = pick<string>(appt, 'startTime', 'starts_at', 'startsAt', 'startDate');
  const endsAt = pick<string>(appt, 'endTime', 'ends_at', 'endsAt', 'endDate');
  const rawStatus = pick<string>(appt, 'appointmentStatus', 'status');

  if (!ghlAppointmentId || !startsAt) {
    return NextResponse.json({ error: 'missing appointment id or startTime' }, { status: 400 });
  }

  const calendarKind = classifyCalendar(ghlCalendarId);
  const status = normalizeStatus(rawStatus);

  const email = pick<string>(contact, 'email');
  const phone = pick<string>(contact, 'phone');
  const firstName = pick<string>(contact, 'firstName', 'first_name');
  const lastName = pick<string>(contact, 'lastName', 'last_name');
  const fullName = pick<string>(contact, 'name', 'fullName')
    || [firstName, lastName].filter(Boolean).join(' ').trim()
    || null;

  const clientId = await matchClientFromContact({
    ghl_contact_id: ghlContactId || null,
    email: email || null,
    phone: phone || null,
    first_name: firstName || null,
    last_name: lastName || null,
  });

  // Check whether this appointment already exists (to detect a "completed" transition)
  let wasAlreadyCompleted = false;
  let existingNotesCompletedAt: string | null = null;
  try {
    const lookup = await supaFetch(
      `gh_appointments?ghl_appointment_id=eq.${encodeURIComponent(ghlAppointmentId)}&select=status,notes_completed_at&limit=1`,
      {},
      true,
    );
    if (lookup.ok) {
      const arr = await lookup.json();
      if (arr[0]) {
        wasAlreadyCompleted = arr[0].status === 'completed';
        existingNotesCompletedAt = arr[0].notes_completed_at;
      }
    }
  } catch { /* tolerate */ }

  // Best-effort enrich with the related GHL opportunity (name + pipeline stage).
  // Only for closing calls (the others don't live in the sales pipeline).
  let opportunity_id: string | null = null;
  let opportunity_name: string | null = null;
  let pipeline_id: string | null = null;
  let pipeline_stage_id: string | null = null;
  let pipeline_stage_name: string | null = null;
  let prospect_status_from_pipeline: string | null = null;

  if (calendarKind === 'closing' && ghlContactId) {
    try {
      const { mapping, pipeline } = await resolveMapping();
      const opps = await listOpportunitiesByContact(ghlContactId);
      // Prefer an opportunity in our target pipeline; fallback to the most recent
      const candidate = (pipeline ? opps.find(o => o.pipelineId === pipeline.id) : null) || opps[0];
      if (candidate) {
        opportunity_id = candidate.id;
        opportunity_name = candidate.name || null;
        pipeline_id = candidate.pipelineId || null;
        pipeline_stage_id = candidate.pipelineStageId || null;
        if (pipeline_stage_id && pipeline) {
          const stage = pipeline.stages.find(s => s.id === pipeline_stage_id);
          pipeline_stage_name = stage?.name || null;
        }
        if (pipeline_stage_id) {
          prospect_status_from_pipeline = stageIdToProspectStatus(mapping, pipeline_stage_id);
        }
      }
    } catch { /* best-effort, don't block the webhook on GHL outages */ }
  }

  // Upsert by ghl_appointment_id
  const row: Record<string, unknown> = {
    ghl_appointment_id: ghlAppointmentId,
    ghl_calendar_id: ghlCalendarId,
    ghl_contact_id: ghlContactId || null,
    calendar_kind: calendarKind,
    status,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    contact_email: email || null,
    contact_phone: phone || null,
    contact_name: fullName,
    client_id: clientId,
    opportunity_id,
    opportunity_name,
    pipeline_id,
    pipeline_stage_id,
    pipeline_stage_name,
    raw_payload: payload as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };
  // Reflect the GHL-side stage as our prospect_status only on first insert (the
  // admin's manual choice in the dashboard wins on subsequent updates).
  if (prospect_status_from_pipeline && !wasAlreadyCompleted && !existingNotesCompletedAt) {
    row.prospect_status = prospect_status_from_pipeline;
  }

  const upsert = await supaFetch('gh_appointments?on_conflict=ghl_appointment_id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  }, true);

  if (!upsert.ok) {
    const txt = await upsert.text().catch(() => '');
    return NextResponse.json({ error: 'upsert failed', detail: txt }, { status: 500 });
  }

  // Fire the "à documenter" notification when the appointment transitions to completed
  // and the admin hasn't already filled in the notes.
  const justCompleted = status === 'completed' && !wasAlreadyCompleted && !existingNotesCompletedAt;
  if (justCompleted) {
    try {
      await notifyAppointmentCompleted({
        contactName: fullName || email || 'Contact GHL',
        contactEmail: email,
        calendarKind,
        startsAt: row.starts_at as string,
        appointmentId: ghlAppointmentId,
      });
    } catch { /* tolerate slack failure */ }

    // Mark reminded_at so we don't re-ping on subsequent webhooks
    try {
      await supaFetch(`gh_appointments?ghl_appointment_id=eq.${encodeURIComponent(ghlAppointmentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ reminded_at: new Date().toISOString() }),
      }, true);
    } catch { /* tolerate */ }
  }

  return NextResponse.json({ ok: true, appointmentId: ghlAppointmentId, status, calendarKind, clientId });
}
