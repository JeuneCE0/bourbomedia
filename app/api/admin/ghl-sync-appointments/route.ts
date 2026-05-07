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

// Sync léger des appointments GHL → gh_appointments. Window resserrée
// (-12h pour les RDV en cours et passés du matin / +48h pour le
// lendemain) pour rester rapide. Pensé pour être appelé fréquemment
// depuis TodayAppointments / dashboard quand le webhook GHL et le cron
// Vercel sont muets.
//
// IMPORTANT : pour que les RDV bookés "le jour même" apparaissent
// instantanément côté admin, ce endpoint doit pouvoir tourner sur la
// fenêtre courante sans dépendre d'un cron */15min.
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const calendars = [
    { id: CLOSING_ID,    envName: 'GHL_CLOSING_CALENDAR_ID' },
    { id: ONBOARDING_ID, envName: 'GHL_ONBOARDING_CALENDAR_ID' },
    { id: FILMING_ID,    envName: 'GHL_FILMING_CALENDAR_ID' },
  ];

  const now = Date.now();
  const fromIso = new Date(now - 12 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 48 * 3600 * 1000).toISOString();

  let synced = 0;
  let processed = 0;
  let errors = 0;

  for (const cal of calendars) {
    if (!cal.id) continue;
    try {
      const { events } = await listCalendarEvents(cal.id, fromIso, toIso);
      // Process events in parallel pour rester rapide même si la fenêtre
      // contient ~10 RDV. getContact + matchClientFromContact font 1-2
      // appels chacun, on tape donc max ~50 calls par run mais en
      // parallèle Promise.all c'est <2s en pratique.
      await Promise.all(events.map(async (ev) => {
        processed++;
        try {
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

          const fullName = contact?.name
            || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim()
            || null;

          await supaFetch('gh_appointments?on_conflict=ghl_appointment_id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
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
              updated_at: new Date().toISOString(),
            }),
          }, true).catch(() => null);
          synced++;
        } catch {
          errors++;
        }
      }));
    } catch {
      errors++;
    }
  }

  return NextResponse.json({ ok: true, processed, synced, errors, window: { from: fromIso, to: toIso } });
}
