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
    'payments?select=id,client_id,amount,currency,status,description,stripe_session_id,stripe_payment_intent,invoice_number,created_at,clients(business_name,email)'
    + '&order=created_at.desc&limit=1000',
    {}, true,
  );
  type PayRow = {
    id: string; client_id: string | null; amount: number; currency: string; status: string;
    description: string | null; stripe_session_id: string | null; stripe_payment_intent: string | null;
    invoice_number: string | null; created_at: string;
    clients: { business_name: string | null; email: string | null } | null;
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

  type AuditRow = {
    source: 'stripe' | 'ghl' | 'manuel' | 'legacy_client';
    id: string;
    client_id: string | null;
    client_name: string | null;
    client_email: string | null;
    amount_eur: number;
    currency: string;
    status: string;
    description: string | null;
    invoice_number: string | null;
    payment_date: string;       // date affichée dans les filtres
    is_in_payments_table: boolean;
  };

  const rows: AuditRow[] = [];

  for (const p of payments) {
    let source: AuditRow['source'] = 'manuel';
    if (p.stripe_session_id?.startsWith('ghl_inv_')) source = 'ghl';
    else if (p.stripe_payment_intent || p.stripe_session_id) source = 'stripe';

    rows.push({
      source,
      id: p.id,
      client_id: p.client_id,
      client_name: p.clients?.business_name || null,
      client_email: p.clients?.email || null,
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
    if (clientsWithPaymentRow.has(c.id)) continue; // déjà couvert par un row payments
    rows.push({
      source: 'legacy_client',
      id: `legacy-${c.id}`,
      client_id: c.id,
      client_name: c.business_name,
      client_email: c.email,
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
  const totalsBySource = rows.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + r.amount_eur;
    return acc;
  }, {} as Record<string, number>);

  // By month
  const byMonth: Record<string, { total: number; count: number; bySource: Record<string, number> }> = {};
  for (const r of rows) {
    const monthKey = r.payment_date.slice(0, 7); // 'YYYY-MM'
    if (!byMonth[monthKey]) byMonth[monthKey] = { total: 0, count: 0, bySource: {} };
    byMonth[monthKey].total += r.amount_eur;
    byMonth[monthKey].count++;
    byMonth[monthKey].bySource[r.source] = (byMonth[monthKey].bySource[r.source] || 0) + r.amount_eur;
  }

  return NextResponse.json({
    summary: {
      total_eur: rows.reduce((s, r) => s + r.amount_eur, 0),
      count: rows.length,
      by_source: totalsBySource,
      by_month: byMonth,
    },
    rows,
  });
}
