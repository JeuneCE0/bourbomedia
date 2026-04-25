'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

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

export default function FinancePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('month');

  useEffect(() => {
    Promise.all([
      fetch('/api/clients', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
      fetch('/api/payments', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
    ]).then(([c, p]) => {
      if (Array.isArray(c)) setClients(c);
      if (Array.isArray(p)) setPayments(p);
    }).finally(() => setLoading(false));
  }, []);

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

      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>Chargement…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Kpi
              emoji="💸" label={`Encaissé · ${RANGE_LABEL[range]}`} value={fmtEUR(rangeCents)} color="var(--green)"
              extra={range === 'month' && monthDelta !== null
                ? <span style={{ color: monthDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>{monthDelta >= 0 ? '+' : ''}{monthDelta}% vs M-1</span>
                : `${inRangeRevenue.length} paiement${inRangeRevenue.length > 1 ? 's' : ''}`}
            />
            <Kpi emoji="📊" label="CA cumulé" value={fmtEUR(totalRevenueAllTime)} color="var(--orange)" extra={`${allRevenue.length} paiement${allRevenue.length > 1 ? 's' : ''}`} />
            <Kpi emoji="🎯" label="Panier moyen" value={fmtEUR(avgTicket)} extra="par paiement" color="#3B82F6" />
            <Kpi emoji="⏳" label="En attente" value={unpaidClients.length.toString()} color={unpaidClients.length > 0 ? 'var(--yellow)' : 'var(--green)'} extra={unpaidClients.length > 0 ? `${fmtEUR(pipelinePotential)} potentiels` : 'Tout encaissé'} />
          </div>

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

          {/* Two cols: top clients + unpaid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, marginTop: 14 }}>
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
        </>
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
