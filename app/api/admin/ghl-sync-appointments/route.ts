import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { classifyCalendar, matchClientFromContact } from '@/lib/ghl-appointments';
import { listCalendarEvents, getContact } from '@/lib/ghl-opportunities';

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

// POST /api/admin/ghl-sync-appointments?past_days=N&future_days=M
//
// Sync GHL → gh_appointments sur les 3 calendriers (closing/onboarding/
// tournage). Window paramétrable :
//   - past_days   : nombre de jours en arrière (default 1, max 90)
//   - future_days : nombre de jours en avant   (default 14, max 180)
// Sans param = sync léger (1j arrière, 14j avant) optimisé pour le
// polling 60s du dashboard. Avec ?past_days=30 ou plus, sert au "deep
// sync" manuel pour re-puller l'historique depuis le bouton Settings.
//
// Optimisation rate-limit GHL : on ne re-fetch contact_email/phone/name
// QUE si la row locale ne les a pas déjà. Sans cette short-circuit, un
// deep sync sur 90j = 100+ getContact() = on tape le rate limit GHL.
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const url = req.nextUrl;
  const pastDays = Math.max(0, Math.min(90, parseInt(url.searchParams.get('past_days') || '1', 10)));
  const futureDays = Math.max(0, Math.min(180, parseInt(url.searchParams.get('future_days') || '14', 10)));

  const calendars = [
    { id: CLOSING_ID,    envName: 'GHL_CLOSING_CALENDAR_ID' },
    { id: ONBOARDING_ID, envName: 'GHL_ONBOARDING_CALENDAR_ID' },
    { id: FILMING_ID,    envName: 'GHL_FILMING_CALENDAR_ID' },
  ];

  const now = Date.now();
  const fromIso = new Date(now - pastDays * 86400 * 1000).toISOString();
  const toIso = new Date(now + futureDays * 86400 * 1000).toISOString();

  let synced = 0;
  let processed = 0;
  let enriched = 0;
  let errors = 0;

  // Pré-fetch les rows déjà miroirées (par appointment_id) pour skip
  // l'enrichissement contact si la row a déjà email/phone/name.
  const eventsByCalendar: { calId: string; events: Awaited<ReturnType<typeof listCalendarEvents>>['events'] }[] = [];
  for (const cal of calendars) {
    if (!cal.id) continue;
    try {
      const { events } = await listCalendarEvents(cal.id, fromIso, toIso);
      eventsByCalendar.push({ calId: cal.id, events });
    } catch {
      errors++;
    }
  }

  const allIds = eventsByCalendar.flatMap(c => c.events.map(e => e.id)).filter(Boolean);
  type ExistingRow = { ghl_appointment_id: string; contact_email: string | null; contact_phone: string | null; contact_name: string | null };
  const existing = new Map<string, ExistingRow>();
  if (allIds.length > 0) {
    const inList = allIds.map(id => `"${id}"`).join(',');
    const r = await supaFetch(
      `gh_appointments?ghl_appointment_id=in.(${encodeURIComponent(inList)})`
      + `&select=ghl_appointment_id,contact_email,contact_phone,contact_name`,
      {}, true,
    ).catch(() => null);
    if (r?.ok) {
      const rows: ExistingRow[] = await r.json();
      for (const row of rows) existing.set(row.ghl_appointment_id, row);
    }
  }

  for (const { calId, events } of eventsByCalendar) {
    await Promise.all(events.map(async (ev) => {
      processed++;
      try {
        const exist = existing.get(ev.id);
        const needsEnrich = !exist || (!exist.contact_email && !exist.contact_phone);

        let contactEmail = exist?.contact_email || null;
        let contactPhone = exist?.contact_phone || null;
        let contactName = exist?.contact_name || null;
        let clientId: string | null = null;

        if (needsEnrich && ev.contactId) {
          const contact = await getContact(ev.contactId).catch(() => null);
          if (contact) {
            contactEmail = contact.email || contactEmail;
            contactPhone = contact.phone || contactPhone;
            contactName = contact.name
              || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim()
              || contactName;
            enriched++;
          }
          clientId = await matchClientFromContact({
            ghl_contact_id: ev.contactId || null,
            email: contact?.email || null,
            phone: contact?.phone || null,
            first_name: contact?.firstName || null,
            last_name: contact?.lastName || null,
          });
        } else if (ev.contactId) {
          clientId = await matchClientFromContact({
            ghl_contact_id: ev.contactId,
            email: contactEmail,
            phone: contactPhone,
            first_name: null,
            last_name: null,
          });
        }

        const calendarKind = classifyCalendar(calId);
        const status = normalizeStatus(ev.appointmentStatus);

        await supaFetch('gh_appointments?on_conflict=ghl_appointment_id', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            ghl_appointment_id: ev.id,
            ghl_calendar_id: calId,
            ghl_contact_id: ev.contactId || null,
            calendar_kind: calendarKind,
            status,
            starts_at: new Date(ev.startTime).toISOString(),
            ends_at: ev.endTime ? new Date(ev.endTime).toISOString() : null,
            contact_email: contactEmail,
            contact_phone: contactPhone,
            contact_name: contactName,
            client_id: clientId,
            updated_at: new Date().toISOString(),
          }),
        }, true).catch(() => null);
        synced++;
      } catch {
        errors++;
      }
    }));
  }

  return NextResponse.json({
    ok: true,
    processed,
    synced,
    enriched,
    errors,
    window: { from: fromIso, to: toIso, past_days: pastDays, future_days: futureDays },
  });
}
