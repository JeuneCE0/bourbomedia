import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/funnel-cohorts?months=6
// Cohort analytics : pour chaque mois on regarde les clients qui ont signup
// (signup_completed), puis on suit leur progression dans le funnel.
// Exemple : "Cohorte avril 2026 — 12 signups, dont 10 ont signé le contrat
// (83%), 8 ont payé (67%)…". Permet de comparer les taux mois par mois et
// de spotter une dégradation.

const STAGES = [
  'signup_completed',
  'contract_signed',
  'payment_completed',
  'call_booked',
  'script_validated',
  'filming_booked',
  'video_delivered',
  'video_validated',
  'project_published',
];

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const monthsParam = Math.min(12, Math.max(1, Number(req.nextUrl.searchParams.get('months') || '6')));
    const since = new Date();
    since.setMonth(since.getMonth() - monthsParam + 1);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    const r = await supaFetch(
      `funnel_events?event=in.(${STAGES.join(',')})&created_at=gte.${encodeURIComponent(sinceIso)}&select=event,client_id,client_token_prefix,created_at&limit=20000`,
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const rows: Array<{ event: string; client_id: string | null; client_token_prefix: string | null; created_at: string }> = await r.json();

    // Étape 1 : pour chaque client, on extrait son mois de signup et on note
    // quels stages il a atteint. Identité = client_id || token_prefix.
    const clientCohort = new Map<string, string>();         // id → "YYYY-MM"
    const clientStages = new Map<string, Set<string>>();    // id → set<event>

    for (const row of rows) {
      const id = row.client_id || row.client_token_prefix;
      if (!id) continue;
      if (!clientStages.has(id)) clientStages.set(id, new Set());
      clientStages.get(id)!.add(row.event);
      if (row.event === 'signup_completed' && !clientCohort.has(id)) {
        const month = row.created_at.slice(0, 7);
        clientCohort.set(id, month);
      }
    }

    // Étape 2 : groupement par cohorte. On ignore les clients sans cohorte
    // (events orphelins sans signup_completed dans la fenêtre).
    const cohortBuckets = new Map<string, { total: number; reached: Record<string, number> }>();
    for (const [id, month] of clientCohort) {
      if (!cohortBuckets.has(month)) {
        cohortBuckets.set(month, { total: 0, reached: Object.fromEntries(STAGES.map(s => [s, 0])) });
      }
      const bucket = cohortBuckets.get(month)!;
      bucket.total += 1;
      const reached = clientStages.get(id) || new Set();
      for (const stage of STAGES) {
        if (reached.has(stage)) bucket.reached[stage] += 1;
      }
    }

    const cohorts = Array.from(cohortBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        total_signups: b.total,
        reached: b.reached,
        rates: Object.fromEntries(
          STAGES.map(s => [s, b.total > 0 ? Math.round((b.reached[s] / b.total) * 100) : 0]),
        ),
      }));

    return NextResponse.json({
      months: monthsParam,
      since: sinceIso,
      stages: STAGES,
      cohorts,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
