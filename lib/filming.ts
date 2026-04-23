import { supaFetch } from './supabase';

export async function findNextAvailableSlot(): Promise<string | null> {
  const today = new Date();
  const searchEnd = new Date(today);
  searchEnd.setDate(searchEnd.getDate() + 90);

  const r = await supaFetch(
    `filming_slots?status=eq.available&date=gte.${today.toISOString().slice(0, 10)}&date=lte.${searchEnd.toISOString().slice(0, 10)}&order=date.asc&limit=1`,
    {},
    true
  );

  if (!r.ok) return null;
  const slots = await r.json();
  if (slots.length) return slots[0].date;

  // No pre-created slots — find next weekday without a booking
  const bookedR = await supaFetch(
    `filming_slots?date=gte.${today.toISOString().slice(0, 10)}&select=date&order=date.asc`,
    {},
    true
  );
  const bookedDates = new Set<string>();
  if (bookedR.ok) {
    const bookedSlots = await bookedR.json();
    bookedSlots.forEach((s: { date: string }) => bookedDates.add(s.date));
  }

  const candidate = new Date(today);
  candidate.setDate(candidate.getDate() + 1);
  for (let i = 0; i < 90; i++) {
    const day = candidate.getDay();
    if (day >= 1 && day <= 5) {
      const dateStr = candidate.toISOString().slice(0, 10);
      if (!bookedDates.has(dateStr)) return dateStr;
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  return null;
}

export async function bookFilmingSlot(date: string, clientId: string): Promise<boolean> {
  const existingR = await supaFetch(`filming_slots?date=eq.${date}`, {}, true);
  if (existingR.ok) {
    const existing = await existingR.json();
    if (existing.length) {
      if (existing[0].status !== 'available') return false;
      const r = await supaFetch(`filming_slots?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ client_id: clientId, status: 'booked' }),
      }, true);
      return r.ok;
    }
  }

  const r = await supaFetch('filming_slots', {
    method: 'POST',
    body: JSON.stringify({ date, client_id: clientId, status: 'booked' }),
  }, true);
  return r.ok;
}

export function computePublicationDeadline(filmingDate: string): string {
  const d = new Date(filmingDate);
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
