'use client';

import { useEffect, useState, CSSProperties } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  city?: string;
  category?: string;
  created_at: string;
  updated_at?: string;
  filming_date?: string;
  paid_at?: string;
  payment_amount?: number;
  delivered_at?: string;
  tags?: string[];
}

interface ActivityItem {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  actor: string;
  created_at: string;
  clients?: { business_name: string };
  client_id: string;
}

const ACTIVITY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  status_changed: { label: 'Statut modifié', icon: '→', color: 'var(--text-mid)' },
  script_sent_to_client: { label: 'Script envoyé', icon: '✉', color: 'var(--orange)' },
  script_validated: { label: 'Script validé', icon: '✓', color: 'var(--green)' },
  script_changes_requested: { label: 'Modifications demandées', icon: '✎', color: 'var(--yellow)' },
  video_delivered: { label: 'Vidéo livrée', icon: '🎬', color: 'var(--green)' },
  filming_scheduled: { label: 'Tournage planifié', icon: '📅', color: 'var(--orange)' },
  satisfaction_submitted: { label: 'Avis client reçu', icon: '⭐', color: '#FACC15' },
  payment_received: { label: 'Paiement reçu', icon: '💳', color: 'var(--green)' },
};

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

const STAT_ICONS: Record<string, string> = {
  total: '◉',
  scripts: '✎',
  validated: '✓',
  filming: '▶',
  published: '★',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function getFrenchDate(): string {
  const now = new Date();
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getCountdownLabel(dateStr: string): string {
  const days = getDaysUntil(dateStr);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  return `dans ${days} jour${days > 1 ? 's' : ''}`;
}

function getInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .map(w => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function DashboardPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur de chargement');
        return r.json();
      })
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    fetch('/api/activity?limit=15', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setActivity(d); })
      .catch(() => {});
  }, []);

  // Monthly aggregates: revenue + delivered videos per month, last 6 months
  const months: { key: string; label: string; revenue: number; delivered: number; created: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      key,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }),
      revenue: 0, delivered: 0, created: 0,
    });
  }
  clients.forEach(c => {
    if (c.paid_at && c.payment_amount) {
      const d = new Date(c.paid_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = months.find(x => x.key === key);
      if (m) m.revenue += c.payment_amount / 100;
    }
    if (c.delivered_at) {
      const d = new Date(c.delivered_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = months.find(x => x.key === key);
      if (m) m.delivered += 1;
    }
    const created = new Date(c.created_at);
    const ckey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    const cm = months.find(x => x.key === ckey);
    if (cm) cm.created += 1;
  });
  const maxRevenue = Math.max(...months.map(m => m.revenue), 1);

  const statusCounts: Record<string, number> = {};
  clients.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] || 0) + 1; });

  const upcomingFilming = clients
    .filter(c => c.filming_date && new Date(c.filming_date) >= new Date())
    .sort((a, b) => new Date(a.filming_date!).getTime() - new Date(b.filming_date!).getTime())
    .slice(0, 5);

  const totalInPipeline = clients.length || 1;

  // --- Advanced stats ---
  const nowMs = Date.now();
  const last30 = clients.filter(c => nowMs - new Date(c.created_at).getTime() < 30 * 86400000);
  const last30Delivered = last30.filter(c => c.delivered_at).length;
  const conversionRate = last30.length > 0 ? Math.round((last30Delivered / last30.length) * 100) : 0;

  // --- KPI top cards ---
  const todayKey = new Date().toISOString().slice(0, 10);
  const leadsToday = clients.filter(c => c.created_at?.slice(0, 10) === todayKey);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthlyRevenueCents = clients
    .filter(c => c.paid_at && new Date(c.paid_at).getTime() >= monthStart)
    .reduce((s, c) => s + (c.payment_amount || 0), 0);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const lastMonthEnd = monthStart;
  const lastMonthRevenueCents = clients
    .filter(c => c.paid_at && new Date(c.paid_at).getTime() >= lastMonthStart && new Date(c.paid_at).getTime() < lastMonthEnd)
    .reduce((s, c) => s + (c.payment_amount || 0), 0);
  const revenueDelta = lastMonthRevenueCents > 0
    ? Math.round(((monthlyRevenueCents - lastMonthRevenueCents) / lastMonthRevenueCents) * 100)
    : null;

  const pendingPayment = clients.filter(c => !c.paid_at && c.status !== 'published');

  // Next action: takes the most urgent thing to do today
  const nextActions: { client: Client; label: string; type: 'script' | 'filming' | 'recontact' }[] = [];
  clients.forEach(c => {
    if (c.status === 'published') return;
    if (c.status === 'script_writing') {
      const idleDays = Math.floor((nowMs - new Date(c.updated_at || c.created_at).getTime()) / 86400000);
      if (idleDays >= 2) nextActions.push({ client: c, label: `Script à finaliser (${idleDays} j)`, type: 'script' });
    }
    if (c.filming_date) {
      const days = Math.ceil((new Date(c.filming_date).getTime() - nowMs) / 86400000);
      if (days >= 0 && days <= 1 && c.status === 'filming_scheduled') {
        nextActions.push({ client: c, label: days === 0 ? "Tournage aujourd'hui" : 'Tournage demain', type: 'filming' });
      }
    }
    if (c.status === 'script_review') {
      const idle = Math.floor((nowMs - new Date(c.updated_at || c.created_at).getTime()) / 86400000);
      if (idle >= 5) nextActions.push({ client: c, label: `Relancer (script en attente ${idle} j)`, type: 'recontact' });
    }
  });
  nextActions.sort((a, b) => (a.type === 'filming' ? 0 : 1) - (b.type === 'filming' ? 0 : 1));

  const totalRevenue = clients.reduce((sum, c) => sum + (c.payment_amount || 0), 0) / 100; // cents → €
  const last30Revenue = last30.reduce((sum, c) => sum + (c.payment_amount || 0), 0) / 100;

  // Avg time from creation to delivery (days)
  const deliveredClients = clients.filter(c => c.delivered_at);
  const avgDeliveryDays = deliveredClients.length > 0
    ? Math.round(deliveredClients.reduce((sum, c) => {
      const days = (new Date(c.delivered_at!).getTime() - new Date(c.created_at).getTime()) / 86400000;
      return sum + days;
    }, 0) / deliveredClients.length)
    : 0;

  // Stuck clients: in same status > 7 days
  const stuckClients = clients.filter(c => {
    if (c.status === 'published') return false;
    const last = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
    return nowMs - last > 7 * 86400000;
  }).length;

  // Needs attention: combines stuck + upcoming filming + script_review (waiting on us)
  const needsAttention: { client: Client; reason: string; urgency: 'high' | 'medium' }[] = [];
  clients.forEach(c => {
    if (c.status === 'published') return;
    const lastMs = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
    const daysIdle = Math.floor((nowMs - lastMs) / 86400000);
    if (c.status === 'script_review' && daysIdle > 3) {
      needsAttention.push({ client: c, reason: `Script en relecture depuis ${daysIdle} j`, urgency: daysIdle > 7 ? 'high' : 'medium' });
    } else if (daysIdle > 14) {
      needsAttention.push({ client: c, reason: `Aucune activité depuis ${daysIdle} j`, urgency: 'high' });
    } else if (c.filming_date) {
      const d = new Date(c.filming_date);
      const daysToFilming = Math.ceil((d.getTime() - nowMs) / 86400000);
      if (daysToFilming >= 0 && daysToFilming <= 2 && c.status !== 'filming_done' && c.status !== 'editing') {
        needsAttention.push({ client: c, reason: daysToFilming === 0 ? "Tournage aujourd'hui" : daysToFilming === 1 ? 'Tournage demain' : `Tournage dans ${daysToFilming} j`, urgency: 'high' });
      }
    }
  });
  // Sort: high urgency first
  needsAttention.sort((a, b) => (a.urgency === 'high' ? 0 : 1) - (b.urgency === 'high' ? 0 : 1));

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Welcome header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800,
          fontSize: '1.75rem',
          color: 'var(--text)',
          margin: 0,
          lineHeight: 1.3,
        }}>
          Bonjour !
        </h1>
        <p style={{
          fontSize: '0.95rem',
          color: 'var(--text-muted)',
          margin: '6px 0 0 0',
          fontWeight: 400,
        }}>
          {getFrenchDate()}
        </p>
      </div>

      {loading ? (
        <div style={{
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
          padding: '40px 0',
          textAlign: 'center',
        }}>
          Chargement...
        </div>
      ) : error ? (
        <div style={{
          padding: '14px 18px',
          borderRadius: 10,
          background: 'rgba(239,68,68,.08)',
          border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      ) : (
        <>
          {/* KPI Top Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
            marginBottom: 28,
          }}>
            {/* Leads du jour */}
            <KpiCard
              title="Leads du jour"
              value={leadsToday.length.toString()}
              accent="var(--orange)"
              icon="◎"
              cta={leadsToday.length > 0 ? 'Voir →' : undefined}
              ctaHref="/dashboard/clients"
            >
              {leadsToday.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Aucun nouveau lead aujourd&apos;hui</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {leadsToday.slice(0, 3).map(c => (
                    <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{
                      fontSize: '0.78rem', color: 'var(--text-mid)', textDecoration: 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      • {c.business_name}
                    </Link>
                  ))}
                </div>
              )}
            </KpiCard>

            {/* Encaissé ce mois */}
            <KpiCard
              title="Encaissé ce mois"
              value={`${(monthlyRevenueCents / 100).toLocaleString('fr-FR')} €`}
              accent="var(--green)"
              icon="€"
            >
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {revenueDelta === null ? (
                  'Premier mois actif'
                ) : revenueDelta > 0 ? (
                  <span style={{ color: 'var(--green)' }}>↑ +{revenueDelta}% vs mois dernier</span>
                ) : revenueDelta < 0 ? (
                  <span style={{ color: 'var(--red)' }}>↓ {revenueDelta}% vs mois dernier</span>
                ) : (
                  '= mois dernier'
                )}
              </div>
            </KpiCard>

            {/* En attente de paiement */}
            <KpiCard
              title="En attente"
              value={pendingPayment.length.toString()}
              accent="var(--yellow)"
              icon="⏳"
              cta={pendingPayment.length > 0 ? 'Voir →' : undefined}
              ctaHref="/dashboard/clients?paid=unpaid"
            >
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {pendingPayment.length === 0 ? 'Tout est encaissé' : `${pendingPayment.length} client${pendingPayment.length > 1 ? 's' : ''} sans paiement enregistré`}
              </div>
            </KpiCard>

            {/* Prochaine action */}
            <KpiCard
              title="Prochaine action"
              value={nextActions.length === 0 ? 'RAS' : nextActions.length.toString()}
              accent={nextActions.length > 0 ? 'var(--red)' : 'var(--green)'}
              icon="!"
              cta={nextActions.length > 0 ? 'Voir tout →' : undefined}
              ctaHref="/dashboard/tasks"
            >
              {nextActions.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tout est sous contrôle ✓</div>
              ) : (
                <Link href={`/dashboard/clients/${nextActions[0].client.id}`} style={{
                  fontSize: '0.78rem', color: 'var(--text)', fontWeight: 500, textDecoration: 'none',
                  display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {nextActions[0].client.business_name}
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>{nextActions[0].label}</div>
                </Link>
              )}
            </KpiCard>
          </div>

          {/* Stats cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 14,
            marginBottom: 28,
          }}>
            <StatCard
              icon={STAT_ICONS.total}
              label="Total clients"
              value={clients.length}
              color="var(--orange)"
            />
            <StatCard
              icon={STAT_ICONS.scripts}
              label="Scripts en cours"
              value={(statusCounts.script_writing || 0) + (statusCounts.script_review || 0)}
              color="var(--yellow)"
            />
            <StatCard
              icon={STAT_ICONS.validated}
              label="Scripts validés"
              value={statusCounts.script_validated || 0}
              color="var(--green)"
            />
            <StatCard
              icon={STAT_ICONS.filming}
              label="Tournages planifiés"
              value={statusCounts.filming_scheduled || 0}
              color="#3B82F6"
            />
            <StatCard
              icon={STAT_ICONS.published}
              label="Publiés"
              value={statusCounts.published || 0}
              color="var(--green)"
            />
          </div>

          {/* Advanced performance stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 28,
          }}>
            <PerfCard
              label="Revenus totaux"
              value={`${totalRevenue.toLocaleString('fr-FR')} €`}
              sub={last30Revenue > 0 ? `+${last30Revenue.toLocaleString('fr-FR')} € ces 30 j` : '—'}
              color="var(--green)"
            />
            <PerfCard
              label="Taux de livraison (30 j)"
              value={`${conversionRate}%`}
              sub={`${last30Delivered} sur ${last30.length} clients`}
              color="var(--orange)"
            />
            <PerfCard
              label="Délai moyen de livraison"
              value={avgDeliveryDays > 0 ? `${avgDeliveryDays} j` : '—'}
              sub={deliveredClients.length > 0 ? `sur ${deliveredClients.length} vidéos livrées` : 'Aucune livraison'}
              color="#3B82F6"
            />
            <PerfCard
              label="Clients bloqués"
              value={`${stuckClients}`}
              sub={stuckClients > 0 ? 'sans activité > 7 j' : 'Tout roule !'}
              color={stuckClients > 0 ? 'var(--red)' : 'var(--green)'}
            />
          </div>

          {/* Needs attention */}
          {needsAttention.length > 0 && (
            <div style={{
              background: 'var(--night-card)',
              borderRadius: 12,
              border: '1px solid var(--border-orange)',
              padding: '20px 24px',
              marginBottom: 24,
            }}>
              <h2 style={{
                fontSize: '0.95rem', fontWeight: 600,
                color: 'var(--orange)', margin: '0 0 14px 0',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>⚠</span> À traiter — {needsAttention.length}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {needsAttention.slice(0, 5).map(a => (
                  <Link key={a.client.id} href={`/dashboard/clients/${a.client.id}`} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
                    padding: '10px 14px', borderRadius: 10,
                    background: 'var(--night-mid)', textDecoration: 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.client.business_name}
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{a.reason}</div>
                    </div>
                    <span style={{
                      fontSize: '0.7rem', padding: '3px 10px', borderRadius: 20,
                      background: a.urgency === 'high' ? 'rgba(239,68,68,.15)' : 'rgba(250,204,21,.12)',
                      color: a.urgency === 'high' ? 'var(--red)' : 'var(--yellow)',
                      fontWeight: 600, whiteSpace: 'nowrap',
                    }}>{a.urgency === 'high' ? 'Urgent' : 'À voir'}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Pipeline overview */}
          <div style={{
            background: 'var(--night-card)',
            borderRadius: 12,
            border: '1px solid var(--border)',
            padding: '20px 24px',
            marginBottom: 24,
          }}>
            <h2 style={{
              fontSize: '0.95rem',
              fontWeight: 600,
              marginBottom: 18,
              color: 'var(--text-mid)',
              margin: '0 0 18px 0',
            }}>
              Pipeline
            </h2>

            {/* Pipeline bar */}
            <div style={{
              display: 'flex',
              gap: 3,
              height: 28,
              borderRadius: 8,
              overflow: 'hidden',
              marginBottom: 16,
              background: 'var(--night-mid)',
            }}>
              {Object.entries(STATUS_LABELS).map(([key]) => {
                const count = statusCounts[key] || 0;
                const pct = clients.length > 0 ? Math.round((count / totalInPipeline) * 100) : 0;
                if (count === 0) return null;
                return (
                  <div key={key} style={{
                    flex: count,
                    background: STATUS_COLORS[key],
                    minWidth: count ? 28 : 0,
                    transition: 'flex .4s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}>
                    {pct >= 8 && (
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        color: '#000',
                        opacity: 0.7,
                        letterSpacing: '-0.02em',
                      }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pipeline legend */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 22px',
            }}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <div key={key} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                }}>
                  <div style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: STATUS_COLORS[key],
                    flexShrink: 0,
                  }} />
                  <span>{label}</span>
                  <span style={{
                    fontWeight: 600,
                    color: statusCounts[key] ? 'var(--text-mid)' : 'var(--text-muted)',
                  }}>
                    {statusCounts[key] || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly performance chart */}
          <div style={{
            background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            padding: '20px 24px', marginBottom: 24,
          }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-mid)', margin: '0 0 18px' }}>
              Performance — 6 derniers mois
            </h2>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140, padding: '0 4px' }}>
              {months.map(m => {
                const heightPct = (m.revenue / maxRevenue) * 100;
                return (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {m.revenue > 0 ? `${m.revenue.toLocaleString('fr-FR')} €` : '—'}
                    </div>
                    <div style={{
                      width: '100%', height: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    }}>
                      <div style={{
                        width: '70%', height: `${Math.max(heightPct, m.revenue > 0 ? 4 : 0)}%`,
                        background: m.revenue > 0 ? 'linear-gradient(180deg, var(--orange) 0%, #C45520 100%)' : 'var(--night-mid)',
                        borderRadius: '4px 4px 0 0', minHeight: m.revenue > 0 ? 4 : 0,
                        transition: 'height .4s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{m.label}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
                      <span title="Vidéos livrées">🎬 {m.delivered}</span>
                      <span title="Nouveaux clients">＋ {m.created}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom two-column layout */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 20,
          }}>
            {/* Upcoming filming */}
            <div style={{
              background: 'var(--night-card)',
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: '20px 24px',
            }}>
              <h2 style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                color: 'var(--text-mid)',
                margin: '0 0 16px 0',
              }}>
                Prochains tournages
              </h2>
              {upcomingFilming.length === 0 ? (
                <div style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}>
                  Aucun tournage planifié prochainement.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {upcomingFilming.map(c => (
                    <FilmingRow key={c.id} client={c} />
                  ))}
                </div>
              )}
            </div>

            {/* Recent clients */}
            <div style={{
              background: 'var(--night-card)',
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: '20px 24px',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}>
                <h2 style={{
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: 'var(--text-mid)',
                  margin: 0,
                }}>
                  Derniers clients
                </h2>
                <Link href="/dashboard/clients" style={{
                  fontSize: '0.8rem',
                  color: 'var(--orange)',
                  textDecoration: 'none',
                  fontWeight: 500,
                  transition: 'opacity .2s',
                }}>
                  Voir tout →
                </Link>
              </div>

              {clients.length === 0 ? (
                <div style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                }}>
                  <div style={{
                    fontSize: '2rem',
                    marginBottom: 12,
                    opacity: 0.3,
                  }}>
                    ◎
                  </div>
                  <p style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    margin: '0 0 16px 0',
                    lineHeight: 1.5,
                  }}>
                    Aucun client pour le moment.
                    <br />
                    Commencez par en créer un !
                  </p>
                  <Link href="/dashboard/clients" style={{
                    display: 'inline-block',
                    fontSize: '0.82rem',
                    color: 'var(--orange)',
                    textDecoration: 'none',
                    fontWeight: 600,
                    padding: '8px 18px',
                    borderRadius: 8,
                    border: '1px solid var(--border-orange)',
                    background: 'rgba(232,105,43,.08)',
                    transition: 'background .2s',
                  }}>
                    + Créer un client
                  </Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {clients.slice(0, 5).map(c => (
                    <ClientRow key={c.id} client={c} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Global activity feed */}
          {activity.length > 0 && (
            <div style={{
              background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
              padding: '20px 24px', marginTop: 24,
            }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-mid)', margin: '0 0 16px' }}>
                Activité récente
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activity.slice(0, 12).map(ev => {
                  const meta = ACTIVITY_LABELS[ev.type] || { label: ev.type, icon: '•', color: 'var(--text-muted)' };
                  return (
                    <Link key={ev.id} href={`/dashboard/clients/${ev.client_id}`} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px',
                      borderRadius: 8, textDecoration: 'none', transition: 'background .15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--night-mid)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--night-mid)', border: `2px solid ${meta.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.78rem', color: meta.color,
                      }}>{meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text)' }}>{ev.clients?.business_name || 'Client'}</span>
                          <span style={{ color: 'var(--text-muted)' }}> — {meta.label}</span>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {relativeTime(ev.created_at)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 30) return `Il y a ${days} j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/* ---------- Sub-components ---------- */

function KpiCard({ title, value, accent, icon, cta, ctaHref, children }: {
  title: string;
  value: string;
  accent: string;
  icon: string;
  cta?: string;
  ctaHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--night-card)',
      borderRadius: 12,
      border: '1px solid var(--border)',
      padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 12,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{title}</div>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: `${accent}15`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.85rem', fontWeight: 700,
        }}>{icon}</div>
      </div>
      <div style={{
        fontSize: '1.75rem', fontWeight: 800, color: accent,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
      }}>{value}</div>
      <div style={{ flex: 1 }}>{children}</div>
      {cta && ctaHref && (
        <Link href={ctaHref} style={{
          fontSize: '0.74rem', color: accent, textDecoration: 'none', fontWeight: 600,
        }}>{cta}</Link>
      )}
    </div>
  );
}

function PerfCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{
      background: 'var(--night-card)',
      borderRadius: 12,
      border: '1px solid var(--border)',
      padding: '16px 20px',
    }}>
      <div style={{
        fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500,
        letterSpacing: '0.02em', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontSize: '1.5rem', fontWeight: 700, color,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1, marginBottom: 6,
      }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  const [hovered, setHovered] = useState(false);

  const cardStyle: CSSProperties = {
    background: 'var(--night-card)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    padding: '18px 22px',
    transition: 'transform .2s ease, border-color .2s ease, background .2s ease',
    transform: hovered ? 'scale(1.03)' : 'scale(1)',
    borderColor: hovered ? 'var(--border-md)' : 'var(--border)',
    cursor: 'default',
  };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: '1rem',
          color,
          opacity: 0.7,
          lineHeight: 1,
        }}>
          {icon}
        </span>
        <span style={{
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          fontWeight: 500,
          letterSpacing: '0.01em',
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: '1.75rem',
        fontWeight: 800,
        color,
        fontFamily: "'Bricolage Grotesque', sans-serif",
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

function FilmingRow({ client }: { client: Client }) {
  const [hovered, setHovered] = useState(false);
  const countdown = getCountdownLabel(client.filming_date!);
  const daysUntil = getDaysUntil(client.filming_date!);
  const isUrgent = daysUntil <= 3;

  return (
    <Link
      href={`/dashboard/clients/${client.id}`}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 14px',
        borderRadius: 10,
        background: hovered ? 'var(--night-raised)' : 'var(--night-mid)',
        textDecoration: 'none',
        transition: 'background .2s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>
          {client.business_name}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {new Date(client.filming_date!).toLocaleDateString('fr-FR', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })}
        </span>
      </div>
      <span style={{
        fontSize: '0.75rem',
        fontWeight: 600,
        color: isUrgent ? 'var(--orange)' : 'var(--text-mid)',
        background: isUrgent ? 'rgba(232,105,43,.1)' : 'transparent',
        padding: isUrgent ? '3px 10px' : '3px 0',
        borderRadius: 20,
        whiteSpace: 'nowrap',
      }}>
        {countdown}
      </span>
    </Link>
  );
}

function ClientRow({ client }: { client: Client }) {
  const [hovered, setHovered] = useState(false);
  const initials = getInitials(client.business_name);
  const statusColor = STATUS_COLORS[client.status] || 'var(--text-muted)';

  return (
    <Link
      href={`/dashboard/clients/${client.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        background: hovered ? 'var(--night-raised)' : 'var(--night-mid)',
        textDecoration: 'none',
        transition: 'background .2s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: statusColor + '20',
        color: statusColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        flexShrink: 0,
        fontFamily: "'Bricolage Grotesque', sans-serif",
      }}>
        {initials}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.85rem',
          color: 'var(--text)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {client.business_name}
        </div>
        <div style={{
          fontSize: '0.73rem',
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {client.contact_name}{client.city ? ` — ${client.city}` : ''}
        </div>
      </div>

      {/* Status badge */}
      <span style={{
        fontSize: '0.68rem',
        padding: '4px 10px',
        borderRadius: 20,
        background: statusColor + '18',
        color: statusColor,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {STATUS_LABELS[client.status]}
      </span>
    </Link>
  );
}
