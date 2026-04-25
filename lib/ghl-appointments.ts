// Helpers for the GHL appointments flow.

import { supaFetch } from '@/lib/supabase';
import { ghlRequest } from '@/lib/ghl';

const CLOSING_ID    = process.env.GHL_CLOSING_CALENDAR_ID    || '';
const ONBOARDING_ID = process.env.GHL_ONBOARDING_CALENDAR_ID || '';
const FILMING_ID    = process.env.GHL_FILMING_CALENDAR_ID    || '';

export type CalendarKind = 'closing' | 'onboarding' | 'tournage' | 'other';

export function classifyCalendar(calendarId: string): CalendarKind {
  if (!calendarId) return 'other';
  if (calendarId === CLOSING_ID)    return 'closing';
  if (calendarId === ONBOARDING_ID) return 'onboarding';
  if (calendarId === FILMING_ID)    return 'tournage';
  return 'other';
}

export interface ContactHints {
  ghl_contact_id?: string | null;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/**
 * Try to match a GHL contact to a Bourbomedia client. Cascades: ghl_contact_id
 * → email → phone → fuzzy name match. Returns the client UUID or null.
 */
export async function matchClientFromContact(hints: ContactHints): Promise<string | null> {
  // 1. By GHL contact ID
  if (hints.ghl_contact_id) {
    const r = await supaFetch(`clients?ghl_contact_id=eq.${encodeURIComponent(hints.ghl_contact_id)}&select=id&limit=1`, {}, true);
    if (r.ok) {
      const arr = await r.json();
      if (arr[0]?.id) return arr[0].id;
    }
  }
  // 2. By email
  if (hints.email) {
    const enc = encodeURIComponent(hints.email.toLowerCase().trim());
    const r = await supaFetch(`clients?email=ilike.${enc}&select=id&limit=1`, {}, true);
    if (r.ok) {
      const arr = await r.json();
      if (arr[0]?.id) return arr[0].id;
    }
  }
  // 3. By phone (strip non-digits to be tolerant of formatting)
  if (hints.phone) {
    const digits = hints.phone.replace(/\D/g, '');
    if (digits.length >= 6) {
      const r = await supaFetch(`clients?phone=ilike.%25${digits.slice(-9)}%25&select=id&limit=1`, {}, true);
      if (r.ok) {
        const arr = await r.json();
        if (arr[0]?.id) return arr[0].id;
      }
    }
  }
  // 4. By first+last name (fuzzy)
  if (hints.first_name && hints.last_name) {
    const enc = encodeURIComponent(`%${hints.first_name.trim()}%${hints.last_name.trim()}%`);
    const r = await supaFetch(`clients?contact_name=ilike.${enc}&select=id&limit=2`, {}, true);
    if (r.ok) {
      const arr = await r.json();
      if (arr.length === 1) return arr[0].id; // only auto-match if uniquely identified
    }
  }
  return null;
}

/**
 * Push a note + status back to the GHL contact. Honors AUTOMATIONS_PAUSED.
 */
export async function pushNotesToGhl(ghlContactId: string, notes: string, prospectStatus?: string | null): Promise<boolean> {
  if (process.env.AUTOMATIONS_PAUSED === 'true') return false;
  if (!process.env.GHL_API_KEY || !ghlContactId) return false;
  try {
    // Append to the contact's notes via the GHL Contacts API.
    // The "notes" field on a contact is single-string; we append a timestamped block.
    const stamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const block = `\n\n--- ${stamp} (Bourbomedia) ---\n${notes}${prospectStatus ? `\n[Statut: ${prospectStatus}]` : ''}`;
    // GHL doesn't expose a clean "append" — we PATCH the contact and let the user merge in their CRM if needed.
    // We also add a tag to surface the prospect status visually.
    await ghlRequest('PUT', `/contacts/${ghlContactId}`, { notes: block }).catch(() => null);
    if (prospectStatus) {
      const tag = `bbm_prospect_${prospectStatus}`;
      await ghlRequest('POST', `/contacts/${ghlContactId}/tags`, { tags: [tag] }).catch(() => null);
    }
    return true;
  } catch {
    return false;
  }
}
