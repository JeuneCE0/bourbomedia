'use client';

import { useEffect, useState } from 'react';

// Hook qui récupère le GHL_LOCATION_ID depuis /api/app-settings/integrations
// (admin-only). Caché en module-level pour éviter de re-fetch à chaque
// composant qui en a besoin (TodayAppointments cards, PipelineCommerciale
// drawer, etc.). Sans cette valeur, les deep-links vers GHL renvoient une
// page blanche (URL https://app.gohighlevel.com/v2/location//... — double
// slash).

let cached: string | null | undefined = undefined;
let inflight: Promise<string | null> | null = null;

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

async function fetchLocationId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch('/api/app-settings/integrations', { headers: authHeaders() });
      if (!r.ok) { cached = null; return null; }
      const d = await r.json();
      const id = (d?.ghl_location_id as string | null) || null;
      cached = id;
      return id;
    } catch {
      cached = null;
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useGhlLocationId(): string | null {
  const [locationId, setLocationId] = useState<string | null>(cached || null);
  useEffect(() => {
    if (cached !== undefined) {
      setLocationId(cached || null);
      return;
    }
    let alive = true;
    fetchLocationId().then(id => {
      if (alive) setLocationId(id);
    });
    return () => { alive = false; };
  }, []);
  return locationId;
}

// Helper : URL GHL pour replanifier un RDV. GHL n'a pas de route
// directe `/calendars/appointments/<id>` accessible (page blanche),
// donc on ouvre la fiche contact où l'admin voit tous les RDV du
// contact + bouton Reschedule natif sur chacun. Fallback sur la
// vue calendrier globale si pas de contact_id.
export function buildGhlAppointmentUrl(
  locationId: string | null,
  appointmentId: string | null,
  contactId?: string | null,
): string {
  if (!locationId) return 'https://app.gohighlevel.com/';
  if (contactId) {
    return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`;
  }
  // Pas de contact → vue calendrier mensuelle, l'admin navigue
  return `https://app.gohighlevel.com/v2/location/${locationId}/calendars/calendar-view`;
}

export function buildGhlContactUrl(locationId: string | null, contactId: string | null): string {
  if (!locationId) return 'https://app.gohighlevel.com/';
  if (!contactId) return `https://app.gohighlevel.com/v2/location/${locationId}/contacts`;
  return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`;
}
