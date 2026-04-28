'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { SkeletonCard } from '@/components/ui/Skeleton';
import LinkGhlButton from '@/components/LinkGhlButton';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  created_at: string;
  paid_at?: string;
  payment_amount?: number; // cents
  delivered_at?: string;
}

interface Payment {
  id: string;
  client_id: string;
  amount: number; // cents
  currency: string;
  status: string;
  description?: string;
  invoice_pdf_url?: string;
  receipt_url?: string;
  invoice_number?: string;
  created_at: string;
  clients?: { business_name: string; contact_name?: string };
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Script en cours',
  script_review: 'Relecture client',
  script_validated: 'Validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tournage terminé',
  editing: 'Montage',
  published: 'Publié',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

import { STANDARD_VIDEO_PRICE_TTC_CENTS } from '@/lib/pricing';

function fmtEUR(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

type Range = 'today' | 'week' | 'month' | '90d' | '365d' | 'all';
const RANGE_LABEL: Record<Range, string> = {
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  '90d': '90 j',
  '365d': '1 an',
  all: 'Tout',
};

function rangeStart(r: Range): number {
  const now = new Date();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (r === 'today') return d.getTime();
  if (r === 'week') {
    // Monday-based week
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    d.setDate(d.getDate() - (dow - 1));
    return d.getTime();
  }
  if (r === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  if (r === '90d') return Date.now() - 90 * 86400000;
  if (r === '365d') return Date.now() - 365 * 86400000;
  return 0;
}

function rangeToIsoBounds(r: Range): { from: string; to: string } {
  const startMs = r === 'all' ? new Date('2020-01-01').getTime() : rangeStart(r);
  const fromDate = new Date(startMs);
  const toDate = new Date();
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: toIso(fromDate), to: toIso(toDate) };
}

interface ClosingStatsRange {
  new_leads: number;
  calls_booked: number;
  calls_done: number;
  calls_won: number;
  calls_no_show: number;
  booking_rate: number | null;
  attendance_rate: number | null;
  closing_rate: number | null;
  new_prospects: number;
  pipeline_open_count: number;
  pipeline_value_cents: number;
  revenue_paid_cents: number;
  revenue_won_ht_cents: number;
  ads_budget_cents: number;
  provider_fees_cents: number;
  gross_profit_cents: number;
}

export default function FinancePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('month');
  const [closingStats, setClosingStats] = useState<ClosingStatsRange | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/clients', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
      fetch('/api/payments', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
    ]).then(([c, p]) => {
      if (Array.isArray(c)) setClients(c);
      if (Array.isArray(p)) setPayments(p);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const { from, to } = rangeToIsoBounds(range);
    fetch(`/api/closing-stats?from=${from}&to=${to}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setClosingStats(d));
  }, [range]);

  const now = new Date();
  const nowMs = Date.now();

  // Use payments table when available, fall back to client.payment_amount/paid_at for legacy
  const allRevenue = useMemo(() => {
    const events: { date: string; cents: number; client_id: string; client_name: string; description?: string }[] = [];
    payments.forEach(p => {
      if (p.status !== 'completed' && p.status !== 'paid') return;
      events.push({
        date: p.created_at,
        cents: p.amount,
        client_id: p.client_id,
        client_name: p.clients?.business_name || 'Client',
        description: p.description,
      });
    });
    // Add legacy client.payment_amount only if not duplicating any payment row for that client
    const clientsWithPaymentRow = new Set(payments.map(p => p.client_id));
    clients.forEach(c => {
      if (!c.paid_at || !c.payment_amount) return;
      if (clientsWithPaymentRow.has(c.id)) return;
      events.push({
        date: c.paid_at,
        cents: c.payment_amount,
        client_id: c.id,
        client_name: c.business_name,
        description: 'Paiement (legacy)',
      });
    });
    return events.sort((a, b) => b.date.localeCompare(a.date));
  }, [clients, payments]);

  // Factures en attente d'encaissement (status='pending' venant du sync GHL)
  const pendingInvoices = useMemo(() => {
    return payments
      .filter(p => p.status === 'pending')
      .map(p => ({
        date: p.created_at,
        cents: p.amount,
        client_id: p.client_id,
        client_name: p.clients?.business_name || 'Client',
        description: p.description,
        invoice_number: p.invoice_number,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [payments]);
  const pendingTotal = pendingInvoices.reduce((s, p) => s + p.cents, 0);

  // Monthly revenue for the last 12 months
  const monthly = useMemo(() => {
    const months: { key: string; label: string; cents: number; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: d.toLocaleDateString('fr-FR', { month: 'short' }), cents: 0, count: 0 });
    }
    allRevenue.forEach(r => {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = months.find(x => x.key === key);
      if (m) { m.cents += r.cents; m.count++; }
    });
    return months;
  }, [allRevenue, now]);

  const maxMonthly = Math.max(...monthly.map(m => m.cents), 1);
  const totalRevenueAllTime = allRevenue.reduce((s, r) => s + r.cents, 0);

  // Range-based KPI (today / week / month / 90d / 365d / all)
  const rangeStartMs = rangeStart(range);
  const inRangeRevenue = range === 'all' ? allRevenue : allRevenue.filter(r => new Date(r.date).getTime() >= rangeStartMs);
  const rangeCents = inRangeRevenue.reduce((s, r) => s + r.cents, 0);

  // Previous-period delta for "this month" only (other ranges are too volatile)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const thisMonthCents = allRevenue.filter(r => new Date(r.date).getTime() >= monthStart).reduce((s, r) => s + r.cents, 0);
  const lastMonthCents = allRevenue.filter(r => new Date(r.date).getTime() >= lastMonthStart && new Date(r.date).getTime() < monthStart).reduce((s, r) => s + r.cents, 0);
  const monthDelta = lastMonthCents > 0 ? Math.round(((thisMonthCents - lastMonthCents) / lastMonthCents) * 100) : null;

  // Avg ticket
  const avgTicket = allRevenue.length > 0 ? Math.round(totalRevenueAllTime / allRevenue.length) : 0;

  // Unpaid clients (no payment yet but not in onboarding only)
  const unpaidClients = clients
    .filter(c => !c.paid_at && c.status !== 'onboarding' && c.status !== 'published')
    .map(c => ({ client: c, daysSinceCreation: Math.floor((nowMs - new Date(c.created_at).getTime()) / 86400000) }))
    .sort((a, b) => b.daysSinceCreation - a.daysSinceCreation);

  // Top clients (lifetime CA)
  const clientCA: Record<string, { name: string; cents: number; count: number }> = {};
  allRevenue.forEach(r => {
    if (!clientCA[r.client_id]) clientCA[r.client_id] = { name: r.client_name, cents: 0, count: 0 };
    clientCA[r.client_id].cents += r.cents;
    clientCA[r.client_id].count++;
  });
  const topClients = Object.entries(clientCA).sort((a, b) => b[1].cents - a[1].cents).slice(0, 10);

  // Forecast: clients in pipeline who haven't paid yet — use the standard
  // 500€ HT + 8.5% TVA pricing as fallback when avgTicket is unknown.
  const pipelinePotential = unpaidClients.length * (avgTicket || STANDARD_VIDEO_PRICE_TTC_CENTS);

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800, fontSize: '1.7rem', color: 'var(--text)',
            margin: 0, lineHeight: 1.2,
          }}>
            💰 Finance
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Encaissements, factures impayées, prévisionnel — tout pour piloter le cash
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SyncButton
            label="Stripe"
            emoji="💳"
            endpoint="/api/stripe/sync?days=90"
            confirmText="Récupérer les paiements Stripe des 90 derniers jours ?\n(Les doublons sont ignorés automatiquement)"
          />
          <SyncButton
            label="GHL"
            emoji="📄"
            endpoint="/api/ghl/sync-invoices?days=365"
            confirmText="Récupérer les factures payées sur GHL des 365 derniers jours ?\n(Les doublons sont ignorés automatiquement)"
          />
          <AuditButton />
          <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--night-card)', border: '1px solid var(--border)' }}>
            {(Object.keys(RANGE_LABEL) as Range[]).map(r => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '6px 11px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: range === r ? 'var(--orange)' : 'transparent',
                color: range === r ? '#fff' : 'var(--text-muted)',
                fontSize: '0.76rem', fontWeight: 600, whiteSpace: 'nowrap',
              }}>{RANGE_LABEL[r]}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="bm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
          </div>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={6} />
        </div>
      ) : (
        <div className="bm-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* KPI cards — distinguent paiements REÇUS vs factures EN ATTENTE */}
          <div className="bm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Kpi
              emoji="💸" label={`Encaissé · ${RANGE_LABEL[range]}`} value={fmtEUR(rangeCents)} color="var(--green)"
              extra={range === 'month' && monthDelta !== null
                ? <span style={{ color: monthDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>{monthDelta >= 0 ? '+' : ''}{monthDelta}% vs M-1</span>
                : `${inRangeRevenue.length} paiement${inRangeRevenue.length > 1 ? 's' : ''} reçu${inRangeRevenue.length > 1 ? 's' : ''}`}
            />
            <Kpi
              emoji="📨"
              label="Factures en attente"
              value={fmtEUR(pendingTotal)}
              color={pendingTotal > 0 ? 'var(--yellow)' : 'var(--text-muted)'}
              extra={pendingTotal > 0 ? `${pendingInvoices.length} facture${pendingInvoices.length > 1 ? 's' : ''} non payée${pendingInvoices.length > 1 ? 's' : ''}` : 'Aucune facture impayée'}
            />
            <Kpi emoji="📊" label="CA cumulé reçu" value={fmtEUR(totalRevenueAllTime)} color="var(--orange)" extra={`${allRevenue.length} paiement${allRevenue.length > 1 ? 's' : ''}`} />
            <Kpi emoji="🎯" label="Panier moyen" value={fmtEUR(avgTicket)} extra="par paiement" color="#3B82F6" />
          </div>

          {/* Performance commerciale (auto from GHL) */}
          {closingStats && (
            <>
              <Card title={`🚶 Funnel commercial · ${RANGE_LABEL[range]}`}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <Kpi emoji="🚶" label="Nouveaux leads" value={closingStats.new_leads.toString()} color="var(--orange)" extra="entrés dans le pipeline" />
                  <Kpi emoji="📞" label="Appels bookés" value={closingStats.calls_booked.toString()} color="#3B82F6" extra={closingStats.booking_rate !== null ? `${closingStats.booking_rate}% des leads` : undefined} />
                  <Kpi emoji="✅" label="Appels réalisés" value={closingStats.calls_done.toString()} color="#A855F7" extra={closingStats.attendance_rate !== null ? `${closingStats.attendance_rate}% présence` : undefined} />
                  <Kpi emoji="🏆" label="Closings gagnés" value={closingStats.calls_won.toString()} color="var(--green)" extra={closingStats.closing_rate !== null ? `${closingStats.closing_rate}% taux closing` : undefined} />
                </div>
              </Card>

              <Card title={`💰 CA & rentabilité · ${RANGE_LABEL[range]}`}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <Kpi emoji="💸" label="CA encaissé" value={fmtEUR(closingStats.revenue_paid_cents)} color="var(--green)" />
                  <Kpi emoji="📊" label="CA généré (HT)" value={fmtEUR(closingStats.revenue_won_ht_cents)} color="var(--orange)" extra={`${closingStats.calls_won} contrat${closingStats.calls_won > 1 ? 's' : ''} signé${closingStats.calls_won > 1 ? 's' : ''}`} />
                  <Kpi emoji="🚀" label="CA à signer" value={fmtEUR(closingStats.pipeline_value_cents)} color="#3B82F6" extra={`${closingStats.pipeline_open_count} prospects actifs`} />
                  <Kpi emoji="💰" label="Budget Ads" value={fmtEUR(closingStats.ads_budget_cents)} color="var(--text-mid)" extra="pro-rata" />
                  <Kpi emoji="🛠️" label="Frais presta" value={fmtEUR(closingStats.provider_fees_cents)} color="var(--text-mid)" />
                  <Kpi emoji="📈" label="Bénéfice brut" value={fmtEUR(closingStats.gross_profit_cents)} color={closingStats.gross_profit_cents >= 0 ? 'var(--green)' : 'var(--red)'} extra="Encaissé − Ads − Presta" />
                </div>
              </Card>

              <PipelineAnalyticsCard />
            </>
          )}

          {/* Monthly chart 12 months */}
          <Card title="📈 Encaissements — 12 derniers mois">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '8px 4px' }}>
              {monthly.map(m => {
                const heightPct = (m.cents / maxMonthly) * 100;
                return (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, height: 14, whiteSpace: 'nowrap' }}>
                      {m.cents > 0 ? fmtEUR(m.cents) : '—'}
                    </div>
                    <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <div title={`${m.count} paiement${m.count > 1 ? 's' : ''}`} style={{
                        width: '70%',
                        height: `${Math.max(heightPct, m.cents > 0 ? 4 : 0)}%`,
                        background: m.cents > 0 ? 'linear-gradient(180deg, var(--orange) 0%, #C45520 100%)' : 'var(--night-mid)',
                        borderRadius: '4px 4px 0 0',
                        minHeight: m.cents > 0 ? 4 : 0,
                        transition: 'height .4s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{m.label}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Section dédiée : Factures en attente d'encaissement */}
          {pendingInvoices.length > 0 && (
            <Card title={`📨 Factures en attente d'encaissement (${pendingInvoices.length})`}>
              <div style={{
                marginBottom: 12, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.3)',
                fontSize: '0.78rem', color: 'var(--text-mid)',
              }}>
                ⚠️ Ces factures ont été émises sur GHL mais ne sont pas encore payées.
                Elles ne sont <strong>PAS</strong> comptées dans le CA encaissé.
                Total à recevoir : <strong style={{ color: 'var(--yellow)' }}>{fmtEUR(pendingTotal)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {pendingInvoices.map(p => (
                  <Link
                    key={`${p.client_id}-${p.invoice_number || p.date}`}
                    href={p.client_id ? `/dashboard/clients/${p.client_id}?tab=payments` : '/dashboard/finance'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
                      background: 'var(--night-mid)',
                      borderLeft: '3px solid var(--yellow)',
                    }}
                  >
                    <span aria-hidden style={{ fontSize: '1rem' }}>📨</span>
                    <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.client_name}
                      {p.invoice_number && (
                        <span style={{ marginLeft: 6, fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                          · {p.invoice_number}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--yellow)', whiteSpace: 'nowrap' }}>
                      {fmtEUR(p.cents)}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* Two cols: top clients + unpaid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
            <Card title="🏆 Top 10 clients (CA cumulé)">
              {topClients.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Aucun paiement enregistré</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {topClients.map(([id, c], idx) => (
                    <Link key={id} href={`/dashboard/clients/${id}?tab=payments`} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 8,
                      background: 'var(--night-mid)', textDecoration: 'none',
                    }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: idx < 3 ? 'var(--orange)' : 'var(--night-card)',
                        color: idx < 3 ? '#fff' : 'var(--text-muted)',
                        fontSize: '0.7rem', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{idx + 1}</span>
                      <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        ×{c.count}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                        {fmtEUR(c.cents)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card title="⚠️ Clients sans paiement">
              {unpaidClients.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tout est encaissé 🎉</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {unpaidClients.slice(0, 8).map(({ client, daysSinceCreation }) => {
                    const overdue = daysSinceCreation > 14;
                    return (
                      <Link key={client.id} href={`/dashboard/clients/${client.id}?tab=payments`} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 8,
                        background: overdue ? 'rgba(239,68,68,.08)' : 'var(--night-mid)',
                        border: overdue ? '1px solid rgba(239,68,68,.30)' : '1px solid transparent',
                        textDecoration: 'none',
                      }}>
                        <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {client.business_name}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {STATUS_LABELS[client.status] || client.status}
                        </span>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 700,
                          padding: '2px 8px', borderRadius: 999,
                          background: overdue ? 'rgba(239,68,68,.18)' : 'var(--night-card)',
                          color: overdue ? '#FCA5A5' : 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                        }}>
                          {overdue ? '🔴 ' : ''}{daysSinceCreation} j
                        </span>
                      </Link>
                    );
                  })}
                  {unpaidClients.length > 8 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', paddingTop: 4 }}>
                      + {unpaidClients.length - 8} autres
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Recent payments */}
          <Card title="🧾 Derniers paiements" style={{ marginTop: 14 }}>
            {allRevenue.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Aucun paiement</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {allRevenue.slice(0, 10).map((r, i) => (
                  <Link key={`${r.client_id}-${r.date}-${i}`} href={`/dashboard/clients/${r.client_id}?tab=payments`} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'var(--night-mid)', textDecoration: 'none',
                  }}>
                    <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600 }}>
                      {r.client_name}
                    </span>
                    {r.description && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flex: 1, textAlign: 'left' }}>
                        {r.description}
                      </span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                      {fmtEUR(r.cents)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ emoji, label, value, extra, color }: { emoji: string; label: string; value: string; extra?: React.ReactNode; color?: string }) {
  return (
    <div style={{
      background: 'var(--night-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden>{emoji}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: color || 'var(--text)', fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1.1 }}>
        {value}
      </div>
      {extra && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{extra}</div>}
    </div>
  );
}

function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--night-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '16px 18px', ...style,
    }}>
      <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

interface PipelineAnalytics {
  total: number;
  won_count: number;
  lost_count: number;
  in_progress_count: number;
  conversion_global: number | null;
  avg_cycle_days: number | null;
  leads_this_month: number;
  leads_last_month: number;
  trend_leads_pct: number | null;
  stage_volume: Record<string, number>;
  stage_value: Record<string, number>;
}

function PipelineAnalyticsCard() {
  const [data, setData] = useState<PipelineAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/pipeline-analytics', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  // Sort stages by volume desc
  const stages = Object.entries(data.stage_volume).sort((a, b) => b[1] - a[1]);
  const maxVolume = Math.max(...stages.map(s => s[1]), 1);

  return (
    <Card title={`📊 Analytics pipeline · all-time`}>
      {/* KPIs row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Kpi emoji="🎯" label="Total opportunités" value={data.total.toString()} color="var(--orange)" />
        <Kpi emoji="🏆" label="Gagnées" value={data.won_count.toString()} color="var(--green)" extra={data.conversion_global !== null ? `${data.conversion_global}% conv globale` : undefined} />
        <Kpi emoji="❌" label="Perdues" value={data.lost_count.toString()} color="var(--red)" />
        <Kpi emoji="🚀" label="En cours" value={data.in_progress_count.toString()} color="#3B82F6" />
        <Kpi emoji="⏱️" label="Cycle moyen" value={data.avg_cycle_days !== null ? `${data.avg_cycle_days} j` : '—'} color="var(--text-mid)" extra="lead → contracté" />
        <Kpi
          emoji="📈"
          label="Leads ce mois"
          value={data.leads_this_month.toString()}
          color={data.trend_leads_pct !== null && data.trend_leads_pct >= 0 ? 'var(--green)' : 'var(--red)'}
          extra={data.trend_leads_pct !== null ? `${data.trend_leads_pct >= 0 ? '+' : ''}${data.trend_leads_pct}% vs M-1` : `${data.leads_last_month} le mois dernier`}
        />
      </div>

      {/* Funnel volume bars */}
      <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Volume par stage
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stages.map(([stage, count]) => {
          const widthPct = (count / maxVolume) * 100;
          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 200, fontSize: '0.78rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {stage}
              </div>
              <div style={{ flex: 1, height: 22, background: 'var(--night-mid)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  width: `${widthPct}%`, height: '100%',
                  background: 'linear-gradient(90deg, var(--orange) 0%, #C45520 100%)',
                  borderRadius: 4, transition: 'width .3s ease',
                }} />
              </div>
              <div style={{ minWidth: 70, fontSize: '0.76rem', color: 'var(--text)', fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif", textAlign: 'right' }}>
                {count}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AuditButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  type AuditRow = {
    source: 'stripe' | 'ghl' | 'manuel' | 'legacy_client';
    state: 'paid' | 'pending';
    id: string; client_id: string | null; client_name: string | null; client_email: string | null;
    client_has_ghl: boolean;
    amount_eur: number; currency: string; status: string; description: string | null;
    invoice_number: string | null; payment_date: string;
  };
  type AuditData = {
    summary: {
      paid_eur: number;
      pending_eur: number;
      total_eur: number;
      count_paid: number;
      count_pending: number;
      count: number;
      paid_by_source: Record<string, number>;
      pending_by_source: Record<string, number>;
      by_month_paid: Record<string, { total: number; count: number; bySource: Record<string, number> }>;
      by_month_pending: Record<string, { total: number; count: number; bySource: Record<string, number> }>;
    };
    rows: AuditRow[];
  };
  const [data, setData] = useState<AuditData | null>(null);

  async function loadAudit() {
    setLoading(true);
    try {
      const r = await fetch('/api/payments/audit', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setData(d);
        setOpen(true);
      }
    } finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={loadAudit} disabled={loading} style={{
        padding: '8px 14px', borderRadius: 8,
        background: 'var(--night-card)', border: '1px solid var(--border-md)',
        color: 'var(--text-mid)', fontSize: '0.78rem', fontWeight: 600,
        cursor: loading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
      }}>
        {loading ? '⏳' : '🔍 Audit CA'}
      </button>

      {open && data && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)',
            backdropFilter: 'blur(3px)',
          }} />
          <div style={{
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 1001, width: 'min(820px, calc(100vw - 32px))',
            maxHeight: '85vh', overflowY: 'auto',
            background: 'var(--night-card)', borderRadius: 14,
            border: '1px solid var(--border-md)',
            boxShadow: '0 20px 60px rgba(0,0,0,.5)',
            padding: '20px',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
            }}>
              <h2 style={{
                fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
                fontSize: '1.2rem', color: 'var(--text)', margin: 0,
              }}>🔍 Audit CA — toutes sources</h2>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: '1.4rem', cursor: 'pointer', padding: 0,
              }}>×</button>
            </div>

            {/* Totals — paid vs pending */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div style={{
                padding: '14px 16px', borderRadius: 10,
                background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.3)',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  💸 Encaissé
                </div>
                <div style={{
                  fontSize: '1.6rem', fontWeight: 800, color: 'var(--green)',
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                }}>
                  {data.summary.paid_eur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {data.summary.count_paid} paiement{data.summary.count_paid > 1 ? 's' : ''} reçu{data.summary.count_paid > 1 ? 's' : ''}
                </div>
              </div>

              <div style={{
                padding: '14px 16px', borderRadius: 10,
                background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.3)',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  📨 En attente
                </div>
                <div style={{
                  fontSize: '1.6rem', fontWeight: 800, color: 'var(--yellow)',
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                }}>
                  {data.summary.pending_eur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {data.summary.count_pending} facture{data.summary.count_pending > 1 ? 's' : ''} non payée{data.summary.count_pending > 1 ? 's' : ''}
                </div>
              </div>

              <div style={{
                padding: '14px 16px', borderRadius: 10,
                background: 'var(--night-mid)', border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  💼 Total émis
                </div>
                <div style={{
                  fontSize: '1.6rem', fontWeight: 800, color: 'var(--text)',
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                }}>
                  {data.summary.total_eur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {data.summary.count} ligne{data.summary.count > 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {/* Breakdown par source — encaissé */}
            <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              💸 Encaissé par source
            </h3>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8, marginBottom: 14,
            }}>
              {Object.entries(data.summary.paid_by_source).map(([source, total]) => {
                const SOURCE_META: Record<string, { emoji: string; label: string; color: string }> = {
                  stripe: { emoji: '💳', label: 'Stripe', color: '#635BFF' },
                  ghl: { emoji: '📄', label: 'GHL', color: '#14B8A6' },
                  manuel: { emoji: '✏️', label: 'Manuel', color: 'var(--text-mid)' },
                  legacy_client: { emoji: '🗂️', label: 'Legacy', color: 'var(--text-muted)' },
                };
                const meta = SOURCE_META[source] || { emoji: '❓', label: source, color: 'var(--text-mid)' };
                return (
                  <div key={`p-${source}`} style={{
                    padding: '8px 11px', borderRadius: 8,
                    background: 'var(--night-mid)', border: `1px solid ${meta.color}40`,
                  }}>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {meta.emoji} {meta.label}
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--green)', fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                      {(total as number).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Breakdown par source — pending */}
            {Object.keys(data.summary.pending_by_source).length > 0 && (
              <>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  📨 En attente par source
                </h3>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 8, marginBottom: 14,
                }}>
                  {Object.entries(data.summary.pending_by_source).map(([source, total]) => (
                    <div key={`pending-${source}`} style={{
                      padding: '8px 11px', borderRadius: 8,
                      background: 'rgba(250,204,21,.05)', border: '1px solid rgba(250,204,21,.3)',
                    }}>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {source === 'ghl' ? '📄 GHL' : source === 'stripe' ? '💳 Stripe' : '❓ ' + source}
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--yellow)', fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                        {(total as number).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Encaissé par mois */}
            <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              💸 Encaissé par mois (date d&apos;encaissement)
            </h3>
            <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(data.summary.by_month_paid).sort((a, b) => b[0].localeCompare(a[0])).map(([month, m]) => (
                <div key={`pm-${month}`} style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr auto', alignItems: 'center', gap: 10,
                  padding: '6px 10px', borderRadius: 6,
                  background: 'var(--night-mid)', fontSize: '0.82rem',
                }}>
                  <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>{month}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{m.count} paiement{m.count > 1 ? 's' : ''}</span>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                    {m.total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                  </span>
                </div>
              ))}
              {Object.keys(data.summary.by_month_paid).length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Aucun encaissement.
                </div>
              )}
            </div>

            {/* Pending par mois (date d'émission) */}
            {Object.keys(data.summary.by_month_pending).length > 0 && (
              <>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  📨 Factures en attente par mois (date d&apos;émission)
                </h3>
                <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(data.summary.by_month_pending).sort((a, b) => b[0].localeCompare(a[0])).map(([month, m]) => (
                    <div key={`pendm-${month}`} style={{
                      display: 'grid', gridTemplateColumns: '90px 1fr auto', alignItems: 'center', gap: 10,
                      padding: '6px 10px', borderRadius: 6,
                      background: 'rgba(250,204,21,.05)', border: '1px solid rgba(250,204,21,.2)',
                      fontSize: '0.82rem',
                    }}>
                      <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>{month}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{m.count} facture{m.count > 1 ? 's' : ''}</span>
                      <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>
                        {m.total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Toutes les lignes */}
            <h3 style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-mid)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Détail ({data.rows.length} lignes)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.rows.map(r => {
                const stateColor = r.state === 'paid' ? 'var(--green)' : 'var(--yellow)';
                const stateBg = r.state === 'paid' ? 'rgba(34,197,94,.12)' : 'rgba(250,204,21,.12)';
                const needsGhlLink = r.client_id && !r.client_has_ghl;
                return (
                  <div key={r.id} style={{
                    padding: '8px 10px', borderRadius: 6,
                    background: r.state === 'pending' ? 'rgba(250,204,21,.04)' : 'var(--night-mid)',
                    border: `1px solid ${r.state === 'pending' ? 'rgba(250,204,21,.2)' : (needsGhlLink ? 'rgba(20,184,166,.3)' : 'var(--border)')}`,
                    display: 'grid', gridTemplateColumns: '60px 60px 1fr auto auto auto', gap: 10,
                    alignItems: 'center', fontSize: '0.78rem',
                  }}>
                    <span style={{
                      fontSize: '0.62rem', padding: '2px 5px', borderRadius: 4,
                      background: stateBg, color: stateColor,
                      fontWeight: 700, textTransform: 'uppercase', textAlign: 'center',
                    }}>
                      {r.state === 'paid' ? '💸 Payé' : '📨 À payer'}
                    </span>
                    <span style={{
                      fontSize: '0.62rem', padding: '2px 5px', borderRadius: 4,
                      background: 'var(--night-card)', color: 'var(--text-muted)',
                      fontWeight: 600, textTransform: 'uppercase', textAlign: 'center',
                    }}>
                      {r.source}
                    </span>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                        {r.client_name || '—'}
                        {!r.client_has_ghl && r.client_id && (
                          <span title="Pas de lien GHL" style={{ marginLeft: 6, fontSize: '0.66rem', color: '#14B8A6' }}>
                            ⚠ pas de GHL
                          </span>
                        )}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                        {r.client_email || '—'}{r.invoice_number ? ` · ${r.invoice_number}` : ''}
                      </div>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {new Date(r.payment_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </span>
                    <span style={{ color: stateColor, fontWeight: 700 }}>
                      {r.amount_eur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                    </span>
                    {needsGhlLink ? (
                      <LinkGhlButton
                        clientId={r.client_id!}
                        size="sm"
                        label="🔗 GHL"
                        onLinked={loadAudit}
                      />
                    ) : (
                      <span style={{ width: 60 }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SyncButton({ label, emoji, endpoint, confirmText }: { label: string; emoji: string; endpoint: string; confirmText: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; issues: string[] } | null>(null);

  async function sync() {
    setBusy(true); setResult(null);
    try {
      console.log('[sync] POST', endpoint);
      const r = await fetch(endpoint, { method: 'POST', headers: authHeaders() });
      let d: { message?: string; error?: string; imported?: number; issues?: string[] } = {};
      try { d = await r.json(); } catch { /* non-JSON response */ }
      console.log('[sync] response', r.status, d);
      if (r.ok) {
        setResult({
          ok: true,
          msg: d.message || `OK (${d.imported || 0} importé${(d.imported || 0) > 1 ? 's' : ''})`,
          issues: Array.isArray(d.issues) ? d.issues : [],
        });
        if ((d.imported || 0) > 0) setTimeout(() => window.location.reload(), 2000);
      } else {
        setResult({
          ok: false,
          msg: d.error || `HTTP ${r.status}`,
          issues: Array.isArray(d.issues) ? d.issues : [],
        });
      }
    } catch (e: unknown) {
      console.error('[sync] error', e);
      setResult({ ok: false, msg: 'Erreur réseau : ' + (e as Error).message, issues: [] });
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, position: 'relative' }}>
      <button onClick={sync} disabled={busy} title={confirmText} style={{
        padding: '8px 14px', borderRadius: 8,
        background: busy ? 'var(--orange)' : 'var(--night-card)',
        border: `1px solid ${busy ? 'var(--orange)' : 'var(--border-md)'}`,
        color: busy ? '#fff' : 'var(--text-mid)',
        fontSize: '0.78rem', fontWeight: 600,
        cursor: busy ? 'wait' : 'pointer',
        whiteSpace: 'nowrap', minWidth: 130,
      }}>
        {busy ? '⏳ Sync en cours…' : `${emoji} Sync ${label}`}
      </button>
      {result && (
        <div style={{
          maxWidth: 360, padding: '10px 12px', borderRadius: 8,
          background: result.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.10)',
          border: `1px solid ${result.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          fontSize: '0.74rem', color: result.ok ? '#86EFAC' : '#FCA5A5',
          lineHeight: 1.5, textAlign: 'left',
        }}>
          <div style={{ fontWeight: 600 }}>
            {result.ok ? '✓' : '✕'} {result.msg}
          </div>
          {result.issues.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-mid)', fontWeight: 500 }}>
                Voir {result.issues.length} détail{result.issues.length > 1 ? 's' : ''}
              </summary>
              <div style={{ marginTop: 6, color: 'var(--text-mid)', fontWeight: 400 }}>
                {result.issues.map((iss, i) => <div key={i} style={{ marginBottom: 3 }}>• {iss}</div>)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
