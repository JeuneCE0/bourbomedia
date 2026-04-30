import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/health
// Renvoie un snapshot opérationnel pour /dashboard/health :
//  - Supabase reachable
//  - Compteurs sur les dernières 24h : errors, funnel events, signups
//  - Crons : si vercel pose le header x-vercel-cron, on peut savoir
//    quand le dernier a tourné — pour l'instant on liste juste les
//    URL et le user vérifie côté Vercel dashboard.
//  - Counts globaux : clients actifs, RDV aujourd'hui, etc.

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Run all checks in parallel — 1 round-trip Supabase total.
  const [supaCheck, errors24h, funnel24h, signups24h, clientsTotal, clientsActive] = await Promise.all([
    supaFetch('clients?limit=1&select=id', {}, true).then(r => r.ok).catch(() => false),
    supaFetch(`error_logs?created_at=gte.${since24h}&select=source`, { headers: { 'Prefer': 'count=exact' } }, true).then(async r => {
      if (!r.ok) return { count: null, by_source: {} };
      const data: Array<{ source: string }> = await r.json();
      const by_source: Record<string, number> = {};
      for (const e of data) by_source[e.source] = (by_source[e.source] || 0) + 1;
      return { count: data.length, by_source };
    }).catch(() => ({ count: null, by_source: {} })),
    supaFetch(`funnel_events?created_at=gte.${since24h}&select=event`, {}, true).then(async r => {
      if (!r.ok) return { count: null, by_event: {} };
      const data: Array<{ event: string }> = await r.json();
      const by_event: Record<string, number> = {};
      for (const e of data) by_event[e.event] = (by_event[e.event] || 0) + 1;
      return { count: data.length, by_event };
    }).catch(() => ({ count: null, by_event: {} })),
    supaFetch(`funnel_events?event=eq.signup_completed&created_at=gte.${since7d}&select=created_at`, {}, true)
      .then(async r => r.ok ? (await r.json()).length : null).catch(() => null),
    supaFetch('clients?archived_at=is.null&select=id', {}, true).then(async r => r.ok ? (await r.json()).length : null).catch(() => null),
    supaFetch('clients?archived_at=is.null&status=neq.published&select=id', {}, true).then(async r => r.ok ? (await r.json()).length : null).catch(() => null),
  ]);

  const checkedAt = new Date().toISOString();
  return NextResponse.json({
    checkedAt,
    supabase: { reachable: supaCheck },
    last24h: {
      errors: errors24h,
      funnelEvents: funnel24h,
    },
    last7d: {
      signups: signups24h,
    },
    clients: {
      total: clientsTotal,
      active: clientsActive,
      published: clientsTotal !== null && clientsActive !== null ? clientsTotal - clientsActive : null,
    },
    crons: [
      { path: '/api/cron/reminders',             schedule: '0 7 * * 1-5',       desc: 'Daily reminders 7am' },
      { path: '/api/cron/appointment-reminders', schedule: '*/15 * * * *',      desc: 'RDV reminders' },
      { path: '/api/cron/ghl-poll',              schedule: '*/15 * * * *',      desc: 'GHL state poll' },
      { path: '/api/cron/error-alerts',          schedule: '*/15 * * * *',      desc: 'Slack alerts on new errors' },
    ],
  });
}
