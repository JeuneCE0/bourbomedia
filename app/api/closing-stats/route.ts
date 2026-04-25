import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { getSetting, adsBudgetForRange } from '@/lib/app-settings';
import { STANDARD_VIDEO_PRICE_HT_CENTS } from '@/lib/pricing';

// GET /api/closing-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns auto-computed metrics for the period:
//   - calls_booked   : count of closing appointments created in [from, to]
//   - calls_done     : count of closing appointments whose starts_at is in
//                      [from, to], have already started, and weren't no-show/cancelled
//   - calls_won      : count of closing appointments with prospect_status='closed_won'
//                      and notes_completed_at in [from, to]
//   - closing_rate   : calls_won / calls_done (0 if no calls done)
//   - new_prospects  : unique contacts (by email) booking their first call in [from, to]
//   - revenue_paid   : sum of clients.payment_amount where paid_at in [from, to]
//   - revenue_won_ht : calls_won × 500€ HT (forecast based on standard price)
//   - ads_budget     : pro-rata of monthly ads budget for the range
//   - provider_fees  : sum of clients.provider_fees with created_at in [from, to]
//   - gross_profit   : revenue_paid − ads_budget − provider_fees
//
// Defaults: from = today 00:00, to = today 23:59:59 (= "today" view)

function dayBounds(date: Date): { from: string; to: string } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const from = d.toISOString();
  d.setHours(23, 59, 59, 999);
  const to = d.toISOString();
  return { from, to };
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const url = req.nextUrl;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  let fromIso: string;
  let toIso: string;
  if (fromParam && toParam) {
    fromIso = new Date(`${fromParam}T00:00:00`).toISOString();
    toIso = new Date(`${toParam}T23:59:59.999`).toISOString();
  } else {
    const b = dayBounds(new Date());
    fromIso = b.from;
    toIso = b.to;
  }

  const enc = (s: string) => encodeURIComponent(s);
  const nowIso = new Date().toISOString();

  // Run lookups in parallel
  const [bookedRes, allClosingsRes, clientsRes, settingsAds, leadsRes, pipelineSnapshotRes] = await Promise.all([
    // Calls booked (created in range, closing only)
    supaFetch(
      `gh_appointments?calendar_kind=eq.closing`
      + `&created_at=gte.${enc(fromIso)}&created_at=lte.${enc(toIso)}`
      + `&select=id,contact_email,created_at`,
      {}, true,
    ),
    // All closings whose starts_at falls in range — used for done & won counts
    supaFetch(
      `gh_appointments?calendar_kind=eq.closing`
      + `&starts_at=gte.${enc(fromIso)}&starts_at=lte.${enc(toIso)}`
      + `&select=id,starts_at,status,prospect_status,notes_completed_at,contact_email`,
      {}, true,
    ),
    // Clients paid in range + provider fees in range
    supaFetch(
      `clients?paid_at=gte.${enc(fromIso)}&paid_at=lte.${enc(toIso)}`
      + `&select=id,payment_amount,provider_fees`,
      {}, true,
    ),
    getSetting('ads_budget_monthly_cents'),
    // New leads in period (opportunities created in the pipeline during [from, to])
    supaFetch(
      `gh_opportunities?ghl_created_at=gte.${enc(fromIso)}&ghl_created_at=lte.${enc(toIso)}`
      + `&select=id,monetary_value_cents,prospect_status`,
      {}, true,
    ),
    // Pipeline snapshot (for value of currently-open opportunities)
    supaFetch(
      `gh_opportunities?prospect_status=in.(reflection,follow_up,awaiting_signature)`
      + `&select=id,monetary_value_cents,prospect_status`,
      {}, true,
    ),
  ]);

  const booked = bookedRes.ok ? await bookedRes.json() : [];
  const closings = allClosingsRes.ok ? await allClosingsRes.json() : [];
  const clients = clientsRes.ok ? await clientsRes.json() : [];

  const calls_booked = booked.length;
  const calls_done = closings.filter((c: { starts_at: string; status: string }) =>
    new Date(c.starts_at).getTime() <= Date.parse(nowIso)
    && c.status !== 'no_show' && c.status !== 'cancelled'
  ).length;
  const calls_no_show = closings.filter((c: { status: string }) => c.status === 'no_show').length;
  const calls_cancelled = closings.filter((c: { status: string }) => c.status === 'cancelled').length;

  // Won = appointments where the prospect signed a contract (contracted) — measured
  // by notes_completed_at because admin documents that after the call. We also accept
  // 'closed_won' for legacy data and 'awaiting_signature' as a leading indicator.
  const wonRes = await supaFetch(
    `gh_appointments?calendar_kind=eq.closing`
    + `&prospect_status=in.(contracted,closed_won)`
    + `&notes_completed_at=gte.${enc(fromIso)}&notes_completed_at=lte.${enc(toIso)}`
    + `&select=id,contact_email`,
    {}, true,
  );
  const won = wonRes.ok ? await wonRes.json() : [];
  const calls_won = won.length;

  const closing_rate = calls_done > 0 ? Math.round((calls_won / calls_done) * 100) : null;

  // Unique new prospects (first time we see this email in any closing)
  const allTimeRes = await supaFetch(
    `gh_appointments?calendar_kind=eq.closing&created_at=lt.${enc(fromIso)}`
    + `&select=contact_email`,
    {}, true,
  );
  const beforeContacts = new Set<string>(
    (allTimeRes.ok ? await allTimeRes.json() : [])
      .map((r: { contact_email: string | null }) => (r.contact_email || '').toLowerCase().trim())
      .filter(Boolean)
  );
  const newProspectEmails = new Set<string>();
  for (const b of booked as { contact_email: string | null }[]) {
    const e = (b.contact_email || '').toLowerCase().trim();
    if (e && !beforeContacts.has(e)) newProspectEmails.add(e);
  }
  const new_prospects = newProspectEmails.size;

  // Revenue + provider fees from clients
  interface PF { amount_cents: number; created_at: string }
  const revenue_paid_cents = clients.reduce(
    (s: number, c: { payment_amount?: number }) => s + (c.payment_amount || 0),
    0,
  );
  const provider_fees_cents = clients.reduce(
    (s: number, c: { provider_fees?: PF[] }) => {
      const fees = c.provider_fees || [];
      return s + fees
        .filter(f => f.created_at >= fromIso.slice(0, 10) && f.created_at <= toIso.slice(0, 10))
        .reduce((ss, f) => ss + (f.amount_cents || 0), 0);
    },
    0,
  );

  const ads_budget_cents = adsBudgetForRange(settingsAds, fromIso, toIso);
  const revenue_won_ht_cents = calls_won * STANDARD_VIDEO_PRICE_HT_CENTS;
  const gross_profit_cents = revenue_paid_cents - ads_budget_cents - provider_fees_cents;

  // ── New funnel metrics from gh_opportunities ────────────────────────────
  interface OppRow { id: string; monetary_value_cents: number | null; prospect_status: string | null }
  const leads: OppRow[] = leadsRes.ok ? await leadsRes.json() : [];
  const pipelineSnapshot: OppRow[] = pipelineSnapshotRes.ok ? await pipelineSnapshotRes.json() : [];

  // new_leads = total opportunities created in [from, to] (regardless of stage)
  const new_leads = leads.length;
  // booking_rate = closings_booked / new_leads — % de leads qui ont réservé un appel
  const booking_rate = new_leads > 0 ? Math.round((calls_booked / new_leads) * 100) : null;
  // attendance_rate = calls_done / calls_booked — % de RDV honorés (vs no_show/cancelled)
  const attendance_rate = calls_booked > 0 ? Math.round((calls_done / calls_booked) * 100) : null;

  // Pipeline value : somme des monetary_value des opportunités encore actives
  // (réflexion / follow_up / awaiting_signature). Fallback : 500€ HT × count.
  const pipeline_open_count = pipelineSnapshot.length;
  const pipeline_value_cents = pipelineSnapshot.reduce(
    (s, o) => s + (o.monetary_value_cents || STANDARD_VIDEO_PRICE_HT_CENTS),
    0,
  );

  return NextResponse.json({
    range: { from: fromIso, to: toIso },
    // Funnel
    new_leads,
    calls_booked,
    calls_done,
    calls_won,
    calls_no_show,
    calls_cancelled,
    booking_rate,
    attendance_rate,
    closing_rate,
    new_prospects,
    // Pipeline (snapshot, pas borné par la période)
    pipeline_open_count,
    pipeline_value_cents,
    // CA
    revenue_paid_cents,
    revenue_won_ht_cents,
    ads_budget_cents,
    provider_fees_cents,
    gross_profit_cents,
  });
}
