import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/payments/audit
//   Audit complet : liste tous les paiements (table payments + clients.payment_amount
//   legacy), regroupe par source (Stripe / GHL / manuel / legacy) avec leurs
//   dates et montants. Permet de comprendre les écarts CA encaissé vs réel.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  // 1. Tous les rows de la table payments
  const pR = await supaFetch(
    'payments?select=id,client_id,amount,currency,status,description,stripe_session_id,stripe_payment_intent,invoice_number,created_at,clients(business_name,email,ghl_contact_id)'
    + '&order=created_at.desc&limit=1000',
    {}, true,
  );
  type PayRow = {
    id: string; client_id: string | null; amount: number; currency: string; status: string;
    description: string | null; stripe_session_id: string | null; stripe_payment_intent: string | null;
    invoice_number: string | null; created_at: string;
    clients: { business_name: string | null; email: string | null; ghl_contact_id: string | null } | null;
  };
  const payments: PayRow[] = pR.ok ? await pR.json() : [];

  // 2. Legacy : clients.payment_amount où il n'y a PAS de row payments correspondant
  const cR = await supaFetch(
    'clients?paid_at=not.is.null&payment_amount=not.is.null'
    + '&select=id,business_name,email,paid_at,payment_amount&limit=500',
    {}, true,
  );
  type ClientLegacyRow = { id: string; business_name: string; email: string | null; paid_at: string; payment_amount: number };
  const legacyClients: ClientLegacyRow[] = cR.ok ? await cR.json() : [];

  const clientsWithPaymentRow = new Set(payments.filter(p => p.client_id).map(p => p.client_id));

  type PaymentState = 'paid' | 'pending';
  type AuditRow = {
    source: 'stripe' | 'ghl' | 'manuel' | 'legacy_client';
    state: PaymentState;
    id: string;
    client_id: string | null;
    client_name: string | null;
    client_email: string | null;
    client_has_ghl: boolean;
    amount_eur: number;
    currency: string;
    status: string;
    description: string | null;
    invoice_number: string | null;
    payment_date: string;
    is_in_payments_table: boolean;
  };

  const rows: AuditRow[] = [];

  for (const p of payments) {
    let source: AuditRow['source'] = 'manuel';
    if (p.stripe_session_id?.startsWith('ghl_inv_')) source = 'ghl';
    else if (p.stripe_payment_intent || p.stripe_session_id) source = 'stripe';

    const state: PaymentState = (p.status === 'completed' || p.status === 'paid') ? 'paid' : 'pending';

    rows.push({
      source,
      state,
      id: p.id,
      client_id: p.client_id,
      client_name: p.clients?.business_name || null,
      client_email: p.clients?.email || null,
      client_has_ghl: !!p.clients?.ghl_contact_id,
      amount_eur: p.amount / 100,
      currency: p.currency,
      status: p.status,
      description: p.description,
      invoice_number: p.invoice_number,
      payment_date: p.created_at,
      is_in_payments_table: true,
    });
  }

  for (const c of legacyClients) {
    if (clientsWithPaymentRow.has(c.id)) continue;
    rows.push({
      source: 'legacy_client',
      state: 'paid',
      id: `legacy-${c.id}`,
      client_id: c.id,
      client_name: c.business_name,
      client_email: c.email,
      client_has_ghl: false, // legacy non joint, on suppose non lié
      amount_eur: c.payment_amount / 100,
      currency: 'eur',
      status: 'completed',
      description: 'Legacy : clients.payment_amount (pas de row payments)',
      invoice_number: null,
      payment_date: c.paid_at,
      is_in_payments_table: false,
    });
  }

  rows.sort((a, b) => b.payment_date.localeCompare(a.payment_date));

  // Aggregations
  const paidRows = rows.filter(r => r.state === 'paid');
  const pendingRows = rows.filter(r => r.state === 'pending');

  const totalsBySource = (subset: AuditRow[]) => subset.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + r.amount_eur;
    return acc;
  }, {} as Record<string, number>);

  const byMonth = (subset: AuditRow[]) => {
    const m: Record<string, { total: number; count: number; bySource: Record<string, number> }> = {};
    for (const r of subset) {
      const monthKey = r.payment_date.slice(0, 7);
      if (!m[monthKey]) m[monthKey] = { total: 0, count: 0, bySource: {} };
      m[monthKey].total += r.amount_eur;
      m[monthKey].count++;
      m[monthKey].bySource[r.source] = (m[monthKey].bySource[r.source] || 0) + r.amount_eur;
    }
    return m;
  };

  return NextResponse.json({
    summary: {
      paid_eur: paidRows.reduce((s, r) => s + r.amount_eur, 0),
      pending_eur: pendingRows.reduce((s, r) => s + r.amount_eur, 0),
      total_eur: rows.reduce((s, r) => s + r.amount_eur, 0),
      count_paid: paidRows.length,
      count_pending: pendingRows.length,
      count: rows.length,
      paid_by_source: totalsBySource(paidRows),
      pending_by_source: totalsBySource(pendingRows),
      by_month_paid: byMonth(paidRows),
      by_month_pending: byMonth(pendingRows),
    },
    rows,
  });
}
