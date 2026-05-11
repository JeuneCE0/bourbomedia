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
 *
 * Implémentation : les notes GHL sont des entités à part entière sous
 * /contacts/{id}/notes (objet { id, body, dateAdded, userId }). Avant
 * on faisait PUT /contacts/{id} { notes: "..." } qui silencieusement
 * ne sauvegardait rien (champ inexistant côté API GHL) → les notes
 * documentées dans le SaaS ne remontaient pas en GHL.
 *
 * On utilise maintenant le bon endpoint POST /contacts/{id}/notes pour
 * créer une nouvelle note à chaque save. Idempotence : on préfixe le
 * body avec un tag "[Bourbomedia · timestamp]" pour qu'un re-save crée
 * une nouvelle entrée datée plutôt qu'écraser l'ancienne — l'admin GHL
 * voit l'historique complet des révisions de notes.
 */
export async function pushNotesToGhl(ghlContactId: string, notes: string, prospectStatus?: string | null): Promise<boolean> {
  if (process.env.AUTOMATIONS_PAUSED === 'true') return false;
  if (!process.env.GHL_API_KEY || !ghlContactId) return false;
  const trimmed = (notes || '').trim();
  if (!trimmed && !prospectStatus) return false;
  try {
    if (trimmed) {
      const stamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const body = `[Bourbomedia · ${stamp}]\n${trimmed}${prospectStatus ? `\n\n[Statut: ${prospectStatus}]` : ''}`;
      await ghlRequest('POST', `/contacts/${encodeURIComponent(ghlContactId)}/notes`, { body }).catch(() => null);
    }
    if (prospectStatus) {
      const tag = `bbm_prospect_${prospectStatus}`;
      await ghlRequest('POST', `/contacts/${encodeURIComponent(ghlContactId)}/tags`, { tags: [tag] }).catch(() => null);
    }
    return true;
  } catch {
    return false;
  }
}
