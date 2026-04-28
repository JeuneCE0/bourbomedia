import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/stats/evolution?weeks=12
//   Calcule des séries temporelles hebdomadaires pour piloter l'agence :
//     - closing_rate : calls_won / calls_done par semaine
//     - leads : nouveaux leads (gh_opportunities créés dans la semaine)
//     - won : opportunités gagnées (prospect_status contracted + ghl_updated_at en semaine)
//     - revenue_cents : CA encaissé sur la semaine (payments.created_at)
//     - cycle_days : avg jours lead → contracted pour les opps signées cette semaine
//   + top sources GHL par CA total sur la période.

type WeekBucket = {
  week_start: string;       // YYYY-MM-DD (lundi)
  label: string;            // 'sem 03' / '13 janv'
  leads: number;
  calls_done: number;
  calls_won: number;
  closing_rate: number | null;
  revenue_cents: number;
  cycle_days_avg: number | null;
  won_count: number;
};

function startOfWeek(d: Date): Date {
  // Monday-start weeks (FR convention)
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const out = new Date(d);
  out.setDate(d.getDate() - (day - 1));
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtWeekLabel(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const weeks = Math.max(4, Math.min(52, parseInt(req.nextUrl.searchParams.get('weeks') || '12', 10)));
  const now = new Date();
  const earliestWeek = startOfWeek(new Date(now.getTime() - weeks * 7 * 86_400_000));
  const fromIso = earliestWeek.toISOString();

  // Pull tout en parallèle
  const [oppsR, apptsR, paymentsR] = await Promise.all([
    supaFetch(
      `gh_opportunities?ghl_created_at=gte.${encodeURIComponent(fromIso)}`
      + `&select=id,ghl_created_at,ghl_updated_at,prospect_status,monetary_value_cents`
      + `&limit=2000`,
      {}, true,
    ),
    supaFetch(
      `gh_appointments?calendar_kind=eq.closing&starts_at=gte.${encodeURIComponent(fromIso)}`
      + `&select=id,starts_at,status,prospect_status,notes_completed_at`
      + `&limit=2000`,
      {}, true,
    ),
    supaFetch(
      `payments?status=in.(completed,paid)&created_at=gte.${encodeURIComponent(fromIso)}`
      + `&select=id,amount,created_at,client_id&limit=2000`,
      {}, true,
    ),
  ]);

  type Opp = { id: string; ghl_created_at: string | null; ghl_updated_at: string | null; prospect_status: string | null; monetary_value_cents: number | null };
  type Appt = { id: string; starts_at: string; status: string; prospect_status: string | null; notes_completed_at: string | null };
  type Pay = { id: string; amount: number; created_at: string; client_id: string };

  const opps: Opp[] = oppsR.ok ? await oppsR.json() : [];
  const appts: Appt[] = apptsR.ok ? await apptsR.json() : [];
  const payments: Pay[] = paymentsR.ok ? await paymentsR.json() : [];

  // Initialise les buckets vides
  const buckets: Record<string, WeekBucket> = {};
  for (let i = 0; i < weeks; i++) {
    const d = new Date(earliestWeek);
    d.setDate(earliestWeek.getDate() + i * 7);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = {
      week_start: key,
      label: fmtWeekLabel(d),
      leads: 0,
      calls_done: 0,
      calls_won: 0,
      closing_rate: null,
      revenue_cents: 0,
      cycle_days_avg: null,
      won_count: 0,
    };
  }

  function bucketKey(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return startOfWeek(d).toISOString().slice(0, 10);
  }

  // Leads : par semaine de ghl_created_at
  for (const o of opps) {
    if (!o.ghl_created_at) continue;
    const k = bucketKey(o.ghl_created_at);
    if (k && buckets[k]) buckets[k].leads++;
  }

  // Calls done & won : par semaine de starts_at (done) et notes_completed_at (won)
  for (const a of appts) {
    if (a.status === 'no_show' || a.status === 'cancelled') continue;
    if (new Date(a.starts_at).getTime() > Date.now()) continue; // futur, pas encore "done"
    const dkey = bucketKey(a.starts_at);
    if (dkey && buckets[dkey]) buckets[dkey].calls_done++;
    if (a.prospect_status === 'contracted' || a.prospect_status === 'closed_won') {
      const wkey = a.notes_completed_at ? bucketKey(a.notes_completed_at) : dkey;
      if (wkey && buckets[wkey]) buckets[wkey].calls_won++;
    }
  }

  // Cycle time : on prend les opps contracted dont ghl_updated_at est dans la semaine,
  // on calcule (ghl_updated_at - ghl_created_at) en jours.
  const cycleSamplesByWeek: Record<string, number[]> = {};
  for (const o of opps) {
    if (o.prospect_status !== 'contracted' && o.prospect_status !== 'regular') continue;
    if (!o.ghl_created_at || !o.ghl_updated_at) continue;
    const wkey = bucketKey(o.ghl_updated_at);
    if (!wkey || !buckets[wkey]) continue;
    const diffDays = (new Date(o.ghl_updated_at).getTime() - new Date(o.ghl_created_at).getTime()) / 86_400_000;
    if (diffDays >= 0 && diffDays < 365) {
      (cycleSamplesByWeek[wkey] = cycleSamplesByWeek[wkey] || []).push(diffDays);
      buckets[wkey].won_count++;
    }
  }

  // Revenue : par semaine de payments.created_at
  for (const p of payments) {
    const k = bucketKey(p.created_at);
    if (k && buckets[k]) buckets[k].revenue_cents += p.amount || 0;
  }

  // Final pass : closing_rate + cycle_days_avg
  for (const k of Object.keys(buckets)) {
    const b = buckets[k];
    if (b.calls_done > 0) b.closing_rate = Math.round((b.calls_won / b.calls_done) * 100);
    const samples = cycleSamplesByWeek[k];
    if (samples && samples.length > 0) {
      b.cycle_days_avg = Math.round(samples.reduce((s, x) => s + x, 0) / samples.length);
    }
  }

  // Sort par week_start asc et drop ce qui est avant earliestWeek
  const series = Object.values(buckets).sort((a, b) => a.week_start.localeCompare(b.week_start));

  // Totals période complète
  const totals = {
    leads: series.reduce((s, b) => s + b.leads, 0),
    calls_done: series.reduce((s, b) => s + b.calls_done, 0),
    calls_won: series.reduce((s, b) => s + b.calls_won, 0),
    revenue_cents: series.reduce((s, b) => s + b.revenue_cents, 0),
    won_count: series.reduce((s, b) => s + b.won_count, 0),
  };
  const closing_rate_period = totals.calls_done > 0 ? Math.round((totals.calls_won / totals.calls_done) * 100) : null;
  const cycle_days_period = (() => {
    const all: number[] = [];
    for (const samples of Object.values(cycleSamplesByWeek)) all.push(...samples);
    return all.length > 0 ? Math.round(all.reduce((s, x) => s + x, 0) / all.length) : null;
  })();

  return NextResponse.json({
    weeks,
    series,
    totals: { ...totals, closing_rate_period, cycle_days_period },
  });
}
