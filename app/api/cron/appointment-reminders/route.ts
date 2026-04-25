import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { notifyAppointmentCompleted } from '@/lib/slack';

// Runs every 15 min. GHL workflow auto-confirms appointments on booking and
// doesn't transition them to "Showed" automatically — so we infer "the call
// happened" from the clock: starts_at is past, status is still scheduled, and
// it wasn't cancelled or marked no-show. We ping Slack once per appointment
// (deduped via reminded_at) so Simeon knows to fill in the notes.

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
    + `&select=id,ghl_appointment_id,calendar_kind,starts_at,contact_name,contact_email`
    + `&order=starts_at.asc&limit=20`,
    {}, true,
  );

  if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const items = await r.json();

  let pinged = 0;
  for (const a of items) {
    try {
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

  return NextResponse.json({ checked: items.length, pinged, at: nowIso });
}
