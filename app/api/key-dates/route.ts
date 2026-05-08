import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/key-dates?days=14
//
// Agrège toutes les dates clés à venir (default 14j en avant + 2j en
// arrière pour rattraper aujourd'hui matin / RDV passés non documentés)
// depuis 3 sources :
//   1. gh_appointments (calendar_kind: closing/onboarding/tournage)
//   2. clients.filming_date (livraison estimée à filming + 5 jours
//      ouvrés, si status filming_done ou editing)
//   3. clients.publication_deadline (date de publication confirmée)
//
// Powers le widget "Échéances clés" du dashboard. Polling 60s côté UI.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const days = Math.max(1, Math.min(60, parseInt(req.nextUrl.searchParams.get('days') || '14', 10)));
  const now = Date.now();
  const fromIso = new Date(now - 2 * 86400 * 1000).toISOString();
  const toIso = new Date(now + days * 86400 * 1000).toISOString();

  type Item = {
    kind: 'closing_call' | 'onboarding_call' | 'tournage' | 'delivery_eta' | 'publication';
    label: string;          // ex: "Tournage", "Appel onboarding"
    emoji: string;
    color: string;
    date: string;           // ISO
    client_id: string | null;
    client_name: string;    // business_name ou contact GHL
    contact_name: string | null;
    href: string;
    extra?: string;         // ex: "Block out Le Zat — Réunion"
  };

  // 1. gh_appointments (on file 3 calendar_kind)
  const apptsR = await supaFetch(
    `gh_appointments?starts_at=gte.${encodeURIComponent(fromIso)}`
    + `&starts_at=lte.${encodeURIComponent(toIso)}`
    + `&status=in.(scheduled,completed)`
    + `&select=id,calendar_kind,starts_at,client_id,contact_name,contact_email,opportunity_name,clients(business_name)`
    + `&order=starts_at.asc&limit=200`,
    {}, true,
  );
  type ApptRow = {
    id: string;
    calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
    starts_at: string;
    client_id: string | null;
    contact_name: string | null;
    contact_email: string | null;
    opportunity_name: string | null;
    clients: { business_name?: string } | null;
  };
  const appts: ApptRow[] = apptsR.ok ? await apptsR.json() : [];

  const items: Item[] = [];
  for (const a of appts) {
    const meta = (() => {
      switch (a.calendar_kind) {
        case 'closing':    return { label: 'Appel closing',    emoji: '📞', color: '#F97316' };
        case 'onboarding': return { label: 'Appel onboarding', emoji: '🚀', color: '#14B8A6' };
        case 'tournage':   return { label: 'Tournage',         emoji: '🎬', color: '#3B82F6' };
        default: return null;
      }
    })();
    if (!meta) continue; // skip 'other'
    const clientName = a.clients?.business_name
      || a.opportunity_name
      || a.contact_name
      || a.contact_email
      || 'Client';
    items.push({
      kind: a.calendar_kind === 'closing' ? 'closing_call'
        : a.calendar_kind === 'onboarding' ? 'onboarding_call'
        : 'tournage',
      label: meta.label,
      emoji: meta.emoji,
      color: meta.color,
      date: a.starts_at,
      client_id: a.client_id,
      client_name: clientName,
      contact_name: a.contact_name,
      href: a.client_id
        ? `/dashboard/clients/${a.client_id}?tab=ghl`
        : '/dashboard/calendar',
    });
  }

  // 2. clients.filming_date → livraison estimée (filming + 5 jours ouvrés)
  // Approxime via +7 jours calendaires (la business-day calc est dans
  // lib/dates côté UI, ici on reste simple et conservateur).
  const filmingR = await supaFetch(
    `clients?filming_date=not.is.null`
    + `&status=in.(filming_done,editing,filming_scheduled)`
    + `&archived_at=is.null`
    + `&select=id,business_name,contact_name,filming_date,status&limit=100`,
    {}, true,
  );
  type FilmingRow = {
    id: string;
    business_name: string;
    contact_name: string | null;
    filming_date: string;
    status: string;
  };
  const filmings: FilmingRow[] = filmingR.ok ? await filmingR.json() : [];
  for (const c of filmings) {
    const filming = new Date(c.filming_date);
    if (Number.isNaN(filming.getTime())) continue;
    const eta = new Date(filming.getTime() + 7 * 86400 * 1000); // +7j ~ 5 ouvrés
    if (eta.getTime() < now - 2 * 86400 * 1000) continue;
    if (eta.getTime() > now + days * 86400 * 1000) continue;
    items.push({
      kind: 'delivery_eta',
      label: 'Livraison vidéo (ETA)',
      emoji: '📹',
      color: '#8B5CF6',
      date: eta.toISOString(),
      client_id: c.id,
      client_name: c.business_name || c.contact_name || 'Client',
      contact_name: c.contact_name,
      href: `/dashboard/clients/${c.id}?tab=delivery`,
      extra: `Tourné le ${filming.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`,
    });
  }

  // 3. clients.publication_deadline → date de publication confirmée
  const pubR = await supaFetch(
    `clients?publication_date_confirmed=eq.true`
    + `&publication_deadline=not.is.null`
    + `&archived_at=is.null`
    + `&select=id,business_name,contact_name,publication_deadline,status&limit=100`,
    {}, true,
  );
  type PubRow = {
    id: string;
    business_name: string;
    contact_name: string | null;
    publication_deadline: string;
    status: string;
  };
  const pubs: PubRow[] = pubR.ok ? await pubR.json() : [];
  for (const c of pubs) {
    const d = new Date(c.publication_deadline);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getTime() < now - 2 * 86400 * 1000) continue;
    if (d.getTime() > now + days * 86400 * 1000) continue;
    items.push({
      kind: 'publication',
      label: 'Publication',
      emoji: '🎉',
      color: '#22C55E',
      date: d.toISOString(),
      client_id: c.id,
      client_name: c.business_name || c.contact_name || 'Client',
      contact_name: c.contact_name,
      href: `/dashboard/clients/${c.id}?tab=delivery`,
    });
  }

  items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return NextResponse.json({ items, total: items.length, window: { from: fromIso, to: toIso, days } });
}
