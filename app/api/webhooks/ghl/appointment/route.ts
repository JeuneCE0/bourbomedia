import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { classifyCalendar, matchClientFromContact } from '@/lib/ghl-appointments';
import { notifyAppointmentCompleted } from '@/lib/slack';

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

  // Upsert by ghl_appointment_id
  const row = {
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
    raw_payload: payload as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };

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
        startsAt: row.starts_at,
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
