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
