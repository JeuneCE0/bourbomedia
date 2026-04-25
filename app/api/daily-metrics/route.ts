import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// Daily business metrics — ads spend, calls booked, calls closed.
// One row per day in `daily_metrics` (PK on `date`).

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const date = req.nextUrl.searchParams.get('date');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  let path = 'daily_metrics?select=*&order=date.desc';
  if (date) path = `daily_metrics?date=eq.${date}&select=*`;
  else if (from && to) path = `daily_metrics?date=gte.${from}&date=lte.${to}&select=*&order=date.desc`;
  else path += '&limit=120';

  const r = await supaFetch(path, {}, true);
  if (!r.ok) return NextResponse.json([]); // graceful fallback if table missing
  const data = await r.json();
  if (date) return NextResponse.json(data[0] || null);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    const date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date YYYY-MM-DD requise' }, { status: 400 });

    const fields: Record<string, unknown> = {
      date,
      ads_budget_cents: Math.max(0, Math.round(Number(body.ads_budget_cents || 0))),
      calls_booked: Math.max(0, Math.round(Number(body.calls_booked || 0))),
      calls_closed: Math.max(0, Math.round(Number(body.calls_closed || 0))),
      notes: body.notes ? String(body.notes).slice(0, 1000) : null,
      updated_at: new Date().toISOString(),
    };

    // Upsert via PostgREST `on_conflict=date`
    const r = await supaFetch('daily_metrics?on_conflict=date', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(fields),
    }, true);
    if (!r.ok) {
      const text = await r.text();
      const isMissing = /relation|PGRST205|Could not find the table|does not exist|schema cache/i.test(text);
      return NextResponse.json({
        error: isMissing ? 'Migration 012 non appliquée — exécutez-la sur Supabase.' : (text || 'Erreur'),
        migration_missing: isMissing,
      }, { status: isMissing ? 503 : (r.status || 500) });
    }
    const data = await r.json();
    return NextResponse.json(data[0] || data);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
