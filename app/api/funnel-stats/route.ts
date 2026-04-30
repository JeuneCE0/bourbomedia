import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/funnel-stats?since=YYYY-MM-DD
// Retourne un agrégat des events du funnel onboarding pour la période.
// Permet d'afficher les taux de conversion stage-par-stage et identifier
// où les prospects décrochent.

const FUNNEL_ORDER = [
  'onboarding_landed',
  'signup_completed',
  'contract_signed',
  'payment_completed',
  'call_booked',
  'script_proposed',
  'script_validated',
  'filming_booked',
  'video_delivered',
  'video_validated',
  'publication_booked',
  'project_published',
];

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const since = req.nextUrl.searchParams.get('since')
      || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    // On lit les events de la période, on agrège côté Node (volume modeste,
    // pas besoin de matérialiser une vue Postgres pour l'instant).
    const r = await supaFetch(
      `funnel_events?created_at=gte.${encodeURIComponent(since)}&select=event,client_id,client_token_prefix,created_at&limit=10000`,
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const rows: Array<{ event: string; client_id: string | null; client_token_prefix: string | null }> = await r.json();

    // Compteur d'events par type (events comptent dédupliqués par client).
    const uniqueByEvent = new Map<string, Set<string>>();
    for (const row of rows) {
      // Identité du sujet : client_id si dispo, sinon token_prefix.
      // Sans aucun des deux on skip (event anonyme = pas exploitable pour
      // calculer un taux de conversion par client unique).
      const id = row.client_id || row.client_token_prefix;
      if (!id) continue;
      if (!uniqueByEvent.has(row.event)) uniqueByEvent.set(row.event, new Set());
      uniqueByEvent.get(row.event)!.add(id);
    }

    const stages = FUNNEL_ORDER.map(event => ({
      event,
      uniqueClients: uniqueByEvent.get(event)?.size || 0,
    }));

    // Taux de conversion stage[i] → stage[i+1] (en % parmi les clients
    // qui ont atteint stage[i]).
    const conversions = stages.map((s, i) => {
      const next = stages[i + 1];
      if (!next) return null;
      const rate = s.uniqueClients > 0 ? Math.round((next.uniqueClients / s.uniqueClients) * 100) : 0;
      const dropoff = s.uniqueClients - next.uniqueClients;
      return { from: s.event, to: next.event, rate, dropoff };
    }).filter(Boolean);

    return NextResponse.json({
      since,
      totalEvents: rows.length,
      stages,
      conversions,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
