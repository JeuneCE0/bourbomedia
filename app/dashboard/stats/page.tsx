'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  status: string;
  category?: string;
  city?: string;
  created_at: string;
  updated_at?: string;
  paid_at?: string;
  payment_amount?: number;
  filming_date?: string;
  delivered_at?: string;
}

interface Satisfaction {
  client_id: string;
  rating: number;
  comment?: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture script',
  script_review: 'Relecture client',
  script_validated: 'Script validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tournage terminé',
  editing: 'Montage',
  published: 'Publié',
};

const STATUS_ORDER = ['onboarding', 'script_writing', 'script_review', 'script_validated', 'filming_scheduled', 'filming_done', 'editing', 'published'];

const STATUS_COLORS: Record<string, string> = {
  onboarding: '#8A7060',
  script_writing: '#FACC15',
  script_review: '#F28C55',
  script_validated: '#22C55E',
  filming_scheduled: '#3B82F6',
  filming_done: '#8B5CF6',
  editing: '#EC4899',
  published: '#22C55E',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

type Range = '30d' | '90d' | '180d' | '365d' | 'all';

const RANGE_DAYS: Record<Range, number> = { '30d': 30, '90d': 90, '180d': 180, '365d': 365, all: 99999 };

export default function StatsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [satisfaction, setSatisfaction] = useState<Satisfaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('90d');

  useEffect(() => {
    Promise.all([
      fetch('/api/clients', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
      fetch('/api/satisfaction', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
    ]).then(([c, s]) => {
      if (Array.isArray(c)) setClients(c);
      if (Array.isArray(s)) setSatisfaction(s);
    }).finally(() => setLoading(false));
  }, []);

  const cutoffMs = useMemo(() => Date.now() - RANGE_DAYS[range] * 86400000, [range]);
  const inRange = useMemo(() => clients.filter(c => new Date(c.created_at).getTime() >= cutoffMs), [clients, cutoffMs]);

  // KPIs
  const totalClients = clients.length;
  const newClientsInRange = inRange.length;
  const deliveredInRange = inRange.filter(c => c.delivered_at).length;
  const conversionRate = newClientsInRange > 0 ? Math.round((deliveredInRange / newClientsInRange) * 100) : 0;

  // Time-to-delivery (clients livrés dans la période)
  const deliveredClients = clients.filter(c => c.delivered_at && new Date(c.delivered_at).getTime() >= cutoffMs);
  const avgDeliveryDays = deliveredClients.length > 0
    ? Math.round(deliveredClients.reduce((sum, c) => sum + (new Date(c.delivered_at!).getTime() - new Date(c.created_at).getTime()) / 86400000, 0) / deliveredClients.length)
    : 0;
  const fastestDelivery = deliveredClients.length > 0
    ? Math.round(Math.min(...deliveredClients.map(c => (new Date(c.delivered_at!).getTime() - new Date(c.created_at).getTime()) / 86400000)))
    : 0;
  const slowestDelivery = deliveredClients.length > 0
    ? Math.round(Math.max(...deliveredClients.map(c => (new Date(c.delivered_at!).getTime() - new Date(c.created_at).getTime()) / 86400000)))
    : 0;

  // NPS / satisfaction in range
  const ratingsInRange = satisfaction.filter(s => new Date(s.created_at).getTime() >= cutoffMs);
  const avgRating = ratingsInRange.length > 0 ? (ratingsInRange.reduce((s, r) => s + r.rating, 0) / ratingsInRange.length) : 0;
  const promoters = ratingsInRange.filter(r => r.rating >= 5).length;
  const detractors = ratingsInRange.filter(r => r.rating <= 3).length;
  const npsLike = ratingsInRange.length > 0 ? Math.round(((promoters - detractors) / ratingsInRange.length) * 100) : 0;

  // Funnel par statut (snapshot aujourd'hui)
  const funnelCounts: Record<string, number> = {};
  STATUS_ORDER.forEach(s => { funnelCounts[s] = 0; });
  clients.forEach(c => { if (funnelCounts[c.status] !== undefined) funnelCounts[c.status]++; });
  const maxFunnel = Math.max(...Object.values(funnelCounts), 1);

  // Top categories
  const categoryCounts: Record<string, number> = {};
  inRange.forEach(c => { const k = c.category || 'Non renseigné'; categoryCounts[k] = (categoryCounts[k] || 0) + 1; });
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Top cities
  const cityCounts: Record<string, number> = {};
  inRange.forEach(c => { const k = c.city || 'Non renseignée'; cityCounts[k] = (cityCounts[k] || 0) + 1; });
  const topCities = Object.entries(cityCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Heatmap activity (clients créés par jour, last 90j)
  const heatmapDays = 90;
  const dayCounts: Record<string, number> = {};
  for (let i = 0; i < heatmapDays; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dayCounts[d.toISOString().slice(0, 10)] = 0;
  }
  clients.forEach(c => {
    const k = c.created_at.slice(0, 10);
    if (dayCounts[k] !== undefined) dayCounts[k]++;
  });
  const heatmapMax = Math.max(...Object.values(dayCounts), 1);

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800, fontSize: '1.7rem', color: 'var(--text)',
            margin: 0, lineHeight: 1.2,
          }}>
            📊 Stats
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Performance, conversion, satisfaction client — tout pour piloter le studio
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--night-card)', border: '1px solid var(--border)' }}>
          {(Object.keys(RANGE_DAYS) as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)} style={{
              padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: range === r ? 'var(--orange)' : 'transparent',
              color: range === r ? '#fff' : 'var(--text-muted)',
              fontSize: '0.78rem', fontWeight: 600,
            }}>
              {r === 'all' ? 'Tout' : r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>Chargement…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Kpi emoji="👥" label="Total clients" value={totalClients.toString()} extra={`+${newClientsInRange} sur la période`} />
            <Kpi emoji="🎬" label="Vidéos livrées" value={deliveredInRange.toString()} extra={conversionRate > 0 ? `${conversionRate}% des nouveaux` : '—'} color="var(--green)" />
            <Kpi emoji="⏱️" label="Délai moyen" value={avgDeliveryDays > 0 ? `${avgDeliveryDays} j` : '—'} extra={deliveredClients.length > 0 ? `${fastestDelivery}j → ${slowestDelivery}j` : 'Aucune livraison'} color="#3B82F6" />
            <Kpi emoji="⭐" label="Note moyenne" value={avgRating > 0 ? `${avgRating.toFixed(1)}/5` : '—'} extra={`${ratingsInRange.length} avis`} color="#FACC15" />
            <Kpi emoji="📈" label="Score NPS-like" value={ratingsInRange.length > 0 ? `${npsLike > 0 ? '+' : ''}${npsLike}` : '—'} extra={`${promoters} fans · ${detractors} détracteurs`} color={npsLike >= 50 ? 'var(--green)' : npsLike >= 0 ? 'var(--yellow)' : 'var(--red)'} />
          </div>

          {/* Funnel */}
          <Card title="🔻 Funnel de production (snapshot actuel)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {STATUS_ORDER.map(s => {
                const count = funnelCounts[s];
                const pct = (count / maxFunnel) * 100;
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 160, fontSize: '0.78rem', color: 'var(--text-mid)', flexShrink: 0 }}>
                      {STATUS_LABELS[s]}
                    </span>
                    <div style={{ flex: 1, height: 22, background: 'var(--night-mid)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        background: STATUS_COLORS[s],
                        transition: 'width .4s ease',
                        borderRadius: 6,
                      }} />
                    </div>
                    <span style={{ width: 40, textAlign: 'right', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Acquisition / ROI publicité */}
          <div style={{ marginTop: 14 }}>
            <AcquisitionRoiCard range={range} />
          </div>

          {/* Évolutions hebdomadaires */}
          <div style={{ marginTop: 14 }}>
            <EvolutionCharts />
          </div>

          {/* Two cols: top categories + cities */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 14 }}>
            <Card title="🏷️ Top catégories">
              <SimpleBarList items={topCategories} color="var(--orange)" />
            </Card>
            <Card title="📍 Top villes">
              <SimpleBarList items={topCities} color="#3B82F6" />
            </Card>
          </div>

          {/* Activity heatmap */}
          <Card title="🔥 Activité (90 derniers jours)" style={{ marginTop: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(45, 1fr)', gap: 2 }}>
              {Object.entries(dayCounts).reverse().map(([date, count]) => {
                const opacity = count === 0 ? 0.05 : Math.min(0.2 + (count / heatmapMax) * 0.8, 1);
                return (
                  <div
                    key={date}
                    title={`${new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} : ${count} client${count > 1 ? 's' : ''}`}
                    style={{
                      aspectRatio: '1', borderRadius: 2,
                      background: `rgba(232,105,43,${opacity})`,
                      cursor: count > 0 ? 'help' : 'default',
                    }}
                  />
                );
              })}
            </div>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Moins
              {[0.05, 0.25, 0.5, 0.75, 1].map(o => (
                <span key={o} style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(232,105,43,${o})` }} />
              ))}
              Plus
            </div>
          </Card>

          {/* Recent ratings */}
          {ratingsInRange.length > 0 && (
            <Card title="💬 Derniers avis" style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ratingsInRange.slice(0, 5).map((s) => {
                  const client = clients.find(c => c.id === s.client_id);
                  return (
                    <div key={s.client_id + s.created_at} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'var(--night-mid)', display: 'flex', gap: 10, alignItems: 'flex-start',
                    }}>
                      <span style={{ fontSize: '1rem' }}>{'⭐'.repeat(s.rating)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {client && (
                          <Link href={`/dashboard/clients/${client.id}`} style={{
                            fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', textDecoration: 'none',
                          }}>{client.business_name}</Link>
                        )}
                        {s.comment && (
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-mid)', margin: '4px 0 0', lineHeight: 1.4 }}>
                            « {s.comment} »
                          </p>
                        )}
                      </div>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(s.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ emoji, label, value, extra, color }: { emoji: string; label: string; value: string; extra?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--night-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden>{emoji}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: color || 'var(--text)', fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1.1 }}>
        {value}
      </div>
      {extra && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{extra}</div>}
    </div>
  );
}

function Card({ title, children, style, action }: { title: string; children: React.ReactNode; style?: React.CSSProperties; action?: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--night-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '16px 18px', ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-mid)', margin: 0, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function SimpleBarList({ items, color }: { items: [string, number][]; color: string }) {
  if (items.length === 0) return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Aucune donnée</div>;
  const max = Math.max(...items.map(i => i[1]), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(([key, count]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 130, fontSize: '0.78rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {key}
          </span>
          <div style={{ flex: 1, height: 18, background: 'var(--night-mid)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: color, borderRadius: 4 }} />
          </div>
          <span style={{ width: 30, textAlign: 'right', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)' }}>{count}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────── Évolutions hebdomadaires (closing, leads, CA, cycle) ─────────── */

interface EvolutionWeek {
  week_start: string;
  label: string;
  leads: number;
  calls_done: number;
  calls_won: number;
  closing_rate: number | null;
  revenue_cents: number;
  cycle_days_avg: number | null;
  won_count: number;
}

interface EvolutionData {
  weeks: number;
  series: EvolutionWeek[];
  totals: {
    leads: number;
    calls_done: number;
    calls_won: number;
    revenue_cents: number;
    won_count: number;
    closing_rate_period: number | null;
    cycle_days_period: number | null;
  };
}

function EvolutionCharts() {
  const [weeks, setWeeks] = useState<8 | 12 | 24>(12);
  const [data, setData] = useState<EvolutionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats/evolution?weeks=${weeks}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [weeks]);

  if (loading || !data) {
    return (
      <Card title="📈 Évolution hebdomadaire">
        <div style={{ height: 100, background: 'var(--night-mid)', borderRadius: 8 }} />
      </Card>
    );
  }

  return (
    <Card
      title="📈 Évolution hebdomadaire"
      style={{}}
      action={(
        <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 7, background: 'var(--night-mid)', border: '1px solid var(--border)' }}>
          {([8, 12, 24] as const).map(w => (
            <button key={w} onClick={() => setWeeks(w)} style={{
              padding: '3px 9px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: weeks === w ? 'var(--orange)' : 'transparent',
              color: weeks === w ? '#fff' : 'var(--text-muted)',
              fontSize: '0.7rem', fontWeight: 600,
            }}>{w} sem.</button>
          ))}
        </div>
      )}
    >
      {/* Totals période */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10,
        marginBottom: 18, padding: '10px 12px', borderRadius: 8,
        background: 'var(--night-mid)', border: '1px solid var(--border)',
      }}>
        <Mini label="Leads" value={data.totals.leads.toString()} color="var(--orange)" />
        <Mini label="Appels réalisés" value={data.totals.calls_done.toString()} color="#3B82F6" />
        <Mini label="Closings gagnés" value={data.totals.calls_won.toString()} color="var(--green)" />
        <Mini label="Closing rate" value={data.totals.closing_rate_period !== null ? `${data.totals.closing_rate_period}%` : '—'} color="#A855F7" />
        <Mini label="Cycle moyen" value={data.totals.cycle_days_period !== null ? `${data.totals.cycle_days_period} j` : '—'} color="#14B8A6" />
        <Mini label="CA encaissé" value={`${(data.totals.revenue_cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} color="var(--green)" />
      </div>

      {/* Chart 1 — Closing rate weekly */}
      <ChartSubtitle emoji="🏆" title="Taux de closing (closings gagnés / appels réalisés)" />
      <LineChart
        points={data.series.map(b => ({ label: b.label, value: b.closing_rate, secondary: `${b.calls_won}/${b.calls_done}` }))}
        unit="%"
        color="var(--orange)"
        max={100}
      />

      {/* Chart 2 — Leads + won bar dual */}
      <ChartSubtitle emoji="🚶" title="Nouveaux leads & contrats signés" />
      <DualBars
        weeks={data.series}
      />

      {/* Chart 3 — Cycle time */}
      <ChartSubtitle emoji="⏱️" title="Cycle commercial moyen (lead → contracté)" />
      <LineChart
        points={data.series.map(b => ({ label: b.label, value: b.cycle_days_avg, secondary: b.won_count > 0 ? `${b.won_count} signé${b.won_count > 1 ? 's' : ''}` : '' }))}
        unit="j"
        color="#14B8A6"
      />

      {/* Chart 4 — Revenue weekly */}
      <ChartSubtitle emoji="💸" title="CA encaissé hebdomadaire" />
      <LineChart
        points={data.series.map(b => ({ label: b.label, value: b.revenue_cents > 0 ? Math.round(b.revenue_cents / 100) : null, secondary: b.revenue_cents > 0 ? `${(b.revenue_cents / 100).toLocaleString('fr-FR')} €` : '' }))}
        unit="€"
        color="var(--green)"
      />
    </Card>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px 6px' }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 800, color, fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function ChartSubtitle({ emoji, title }: { emoji: string; title: string }) {
  return (
    <h4 style={{
      fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-mid)',
      margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span aria-hidden>{emoji}</span> {title}
    </h4>
  );
}

interface ChartPoint { label: string; value: number | null; secondary?: string }

function LineChart({ points, unit, color, max: forcedMax }: { points: ChartPoint[]; unit: string; color: string; max?: number }) {
  const validPoints = points.filter(p => p.value !== null);
  if (validPoints.length === 0) {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 8, background: 'var(--night-mid)',
        fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center',
      }}>Pas de données sur la période.</div>
    );
  }
  const max = forcedMax ?? Math.max(...validPoints.map(p => p.value!), 1);
  const w = 100 / Math.max(points.length - 1, 1);
  const polyline = points.map((p, i) => {
    if (p.value === null) return null;
    const x = i * w;
    const y = 100 - (p.value / max) * 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(' ');

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ position: 'relative', height: 130, padding: '6px 0' }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          {/* Gridlines */}
          {[25, 50, 75].map(y => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--border)" strokeWidth="0.3" />
          ))}
          {/* Line */}
          <polyline
            points={polyline}
            fill="none"
            stroke={color}
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
          />
          {/* Points */}
          {points.map((p, i) => {
            if (p.value === null) return null;
            const x = i * w;
            const y = 100 - (p.value / max) * 100;
            return <circle key={i} cx={x} cy={y} r="0.9" fill={color} />;
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-muted)', padding: '0 4px' }}>
        {points.map((p, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }} title={p.secondary ? `${p.value !== null ? p.value + unit : '—'} · ${p.secondary}` : `${p.value !== null ? p.value + unit : '—'}`}>
            {/* Affiche un label sur ~6 ticks pour éviter l'encombrement */}
            {i % Math.ceil(points.length / 8) === 0 ? p.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function DualBars({ weeks }: { weeks: EvolutionWeek[] }) {
  const max = Math.max(...weeks.map(w => Math.max(w.leads, w.calls_won)), 1);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 2,
        height: 130, padding: '8px 4px',
        borderBottom: '1px solid var(--border)',
      }}>
        {weeks.map((w, i) => {
          const leadsH = (w.leads / max) * 100;
          const wonH = (w.calls_won / max) * 100;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}
              title={`${w.label} · ${w.leads} leads · ${w.calls_won} signés`}
            >
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, width: '100%', height: '100%' }}>
                <div style={{
                  flex: 1, height: `${Math.max(leadsH, w.leads > 0 ? 4 : 0)}%`,
                  background: w.leads > 0 ? 'rgba(232,105,43,.7)' : 'transparent',
                  borderRadius: '2px 2px 0 0',
                  transition: 'height .4s ease',
                }} />
                <div style={{
                  flex: 1, height: `${Math.max(wonH, w.calls_won > 0 ? 4 : 0)}%`,
                  background: w.calls_won > 0 ? 'var(--green)' : 'transparent',
                  borderRadius: '2px 2px 0 0',
                  transition: 'height .4s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-muted)', padding: '4px 4px 0' }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            {i % Math.ceil(weeks.length / 8) === 0 ? w.label : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(232,105,43,.7)', borderRadius: 2, marginRight: 5 }} />Leads entrants</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--green)', borderRadius: 2, marginRight: 5 }} />Contrats signés</span>
      </div>
    </div>
  );
}

/* ─────────── Acquisition / ROI publicité ───────────
   Calcule 4 métriques business à partir de :
   - /api/closing-stats (CA encaissé, leads, RDV honorés, closings, budget Ads pro-rata)
   - app_settings.ads_budget_monthly_cents (édité inline ici, source de vérité partagée
     avec /dashboard/settings et /dashboard/finance)

   Formules :
     ROAS              = revenue_paid_cents / ads_budget_cents          (×, "—" si 0 € dépensé)
     Coût / prospect   = ads_budget_cents   / new_leads                 (€, "—" si 0 lead)
     Coût / RDV        = ads_budget_cents   / calls_done                (€, "—" si 0 RDV)
     Coût / closing    = ads_budget_cents   / calls_won                 (€, "—" si 0 closing)
   ─────────────────────────────────────────────────── */

interface ClosingStatsLite {
  new_leads: number;
  calls_done: number;
  calls_won: number;
  revenue_paid_cents: number;
  ads_budget_cents: number;
}

function rangeToBounds(r: Range): { from: string; to: string } {
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  if (r === 'all') return { from: '2020-01-01', to: toIso(today) };
  const from = new Date(today.getTime() - RANGE_DAYS[r] * 86400000);
  return { from: toIso(from), to: toIso(today) };
}

function fmtEUR(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

function AcquisitionRoiCard({ range }: { range: Range }) {
  const [stats, setStats] = useState<ClosingStatsLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthlyBudget, setMonthlyBudget] = useState<string>(''); // €, string pour le contrôle de l'input
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  // Fetch closing-stats pour la période
  useEffect(() => {
    const { from, to } = rangeToBounds(range);
    setLoading(true);
    fetch(`/api/closing-stats?from=${from}&to=${to}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setStats(d))
      .finally(() => setLoading(false));
  }, [range]);

  // Fetch budget mensuel courant (source de vérité partagée avec /dashboard/settings)
  useEffect(() => {
    fetch('/api/app-settings', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          const eur = ((d.ads_budget_monthly_cents || 0) / 100).toString();
          setMonthlyBudget(eur);
          setBudgetInput(eur);
        }
      });
  }, []);

  async function saveBudget() {
    const cents = Math.round(parseFloat(budgetInput || '0') * 100);
    if (Number.isNaN(cents) || cents < 0) return;
    setSaving(true);
    try {
      const r = await fetch('/api/app-settings', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ ads_budget_monthly_cents: cents }),
      });
      if (r.ok) {
        setMonthlyBudget((cents / 100).toString());
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 2000);
        // Re-fetch closing-stats pour récupérer le nouveau budget pro-rata
        const { from, to } = rangeToBounds(range);
        const sR = await fetch(`/api/closing-stats?from=${from}&to=${to}`, { headers: authHeaders() });
        if (sR.ok) setStats(await sR.json());
      }
    } finally {
      setSaving(false);
    }
  }

  const adsCents = stats?.ads_budget_cents ?? 0;
  const revCents = stats?.revenue_paid_cents ?? 0;
  const leads = stats?.new_leads ?? 0;
  const callsDone = stats?.calls_done ?? 0;
  const callsWon = stats?.calls_won ?? 0;

  // Tous les indicateurs gèrent explicitement les divisions par 0 → "—"
  const roas = adsCents > 0 ? revCents / adsCents : null;
  const cpl = adsCents > 0 && leads > 0 ? Math.round(adsCents / leads) : null;
  const cpa = adsCents > 0 && callsDone > 0 ? Math.round(adsCents / callsDone) : null;
  const cpc = adsCents > 0 && callsWon > 0 ? Math.round(adsCents / callsWon) : null;

  const roasLabel = roas === null ? '—' : `${roas.toFixed(2)}×`;
  const roasColor = roas === null
    ? 'var(--text-muted)'
    : roas >= 3 ? 'var(--green)'
    : roas >= 1 ? 'var(--yellow)'
    : 'var(--red)';

  const dirty = budgetInput !== monthlyBudget;
  const budgetIsZero = !monthlyBudget || parseFloat(monthlyBudget) === 0;

  return (
    <Card title="🎯 Acquisition & ROI publicitaire">
      {/* Bandeau d'édition du budget mensuel — synchronisé avec /dashboard/settings */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end',
        padding: '12px 14px', borderRadius: 8, marginBottom: 14,
        background: 'var(--night-mid)', border: '1px solid var(--border)',
      }}>
        <label style={{ flex: '1 1 200px' }}>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            Budget publicitaire mensuel (€)
          </span>
          <input
            type="number" step="1" min="0"
            value={budgetInput}
            onChange={e => setBudgetInput(e.target.value)}
            placeholder="Ex: 3000"
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              background: 'var(--night-card)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.95rem', outline: 'none', fontFamily: 'inherit',
            }}
          />
        </label>
        <button
          onClick={saveBudget}
          disabled={saving || !dirty}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none', cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            background: dirty ? 'var(--orange)' : 'var(--night-card)',
            color: dirty ? '#fff' : 'var(--text-muted)',
            fontSize: '0.82rem', fontWeight: 700,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Sauvegarde…' : savedHint ? 'Sauvegardé ✓' : 'Enregistrer'}
        </button>
        <div style={{ flex: '1 1 100%', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Saisi manuellement (Meta Ads / Google Ads / autre). Le système calcule un pro-rata par jour et l&apos;applique à la période sélectionnée.
          Sur la période : <strong style={{ color: 'var(--text-mid)' }}>{loading ? '…' : fmtEUR(adsCents)}</strong> de dépenses pub estimées.
          {budgetIsZero && (
            <span style={{ color: 'var(--yellow)', marginLeft: 6 }}>
              ⚠️ Saisis ton budget pour activer les calculs ROAS / coût par étape.
            </span>
          )}
        </div>
      </div>

      {/* 4 KPI cards — formules ci-dessus en commentaire */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Kpi
          emoji="📈"
          label="ROAS"
          value={loading ? '…' : roasLabel}
          color={roasColor}
          extra={roas !== null
            ? `${fmtEUR(revCents)} / ${fmtEUR(adsCents)}`
            : 'Revenu ÷ dépenses pub'}
        />
        <Kpi
          emoji="🚶"
          label="Coût par prospect"
          value={loading ? '…' : (cpl !== null ? fmtEUR(cpl) : '—')}
          color={cpl !== null ? 'var(--orange)' : 'var(--text-muted)'}
          extra={cpl !== null ? `${leads} prospect${leads > 1 ? 's' : ''} sur la période` : 'Dépenses pub ÷ prospects'}
        />
        <Kpi
          emoji="📞"
          label="Coût par RDV"
          value={loading ? '…' : (cpa !== null ? fmtEUR(cpa) : '—')}
          color={cpa !== null ? '#3B82F6' : 'var(--text-muted)'}
          extra={cpa !== null ? `${callsDone} RDV honoré${callsDone > 1 ? 's' : ''}` : 'Dépenses pub ÷ RDV honorés'}
        />
        <Kpi
          emoji="🏆"
          label="Coût par closing"
          value={loading ? '…' : (cpc !== null ? fmtEUR(cpc) : '—')}
          color={cpc !== null ? 'var(--green)' : 'var(--text-muted)'}
          extra={cpc !== null ? `${callsWon} closing${callsWon > 1 ? 's' : ''} signé${callsWon > 1 ? 's' : ''}` : 'Dépenses pub ÷ closings gagnés'}
        />
      </div>
    </Card>
  );
}
