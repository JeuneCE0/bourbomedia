'use client';

import { useEffect, useState } from 'react';
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

  const now = new Date();
  const nowMs = Date.now();

  // --- KPI calculations ---
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

  const nextActions: { client: Client; label: string }[] = [];
  clients.forEach(c => {
    if (c.status === 'published') return;
    if (c.status === 'script_writing') {
      const idleDays = Math.floor((nowMs - new Date(c.updated_at || c.created_at).getTime()) / 86400000);
      if (idleDays >= 2) nextActions.push({ client: c, label: `Script à finaliser (${idleDays} j)` });
    }
    if (c.filming_date) {
      const days = Math.ceil((new Date(c.filming_date).getTime() - nowMs) / 86400000);
      if (days >= 0 && days <= 1 && c.status === 'filming_scheduled') {
        nextActions.push({ client: c, label: days === 0 ? "Tournage aujourd'hui" : 'Tournage demain' });
      }
    }
    if (c.status === 'script_review') {
      const idle = Math.floor((nowMs - new Date(c.updated_at || c.created_at).getTime()) / 86400000);
      if (idle >= 5) nextActions.push({ client: c, label: `Relancer (script en attente ${idle} j)` });
    }
  });

  // --- Compact metrics ---
  const totalRevenue = clients.reduce((sum, c) => sum + (c.payment_amount || 0), 0) / 100;
  const deliveredClients = clients.filter(c => c.delivered_at);
  const avgDeliveryDays = deliveredClients.length > 0
    ? Math.round(deliveredClients.reduce((sum, c) => {
      return sum + (new Date(c.delivered_at!).getTime() - new Date(c.created_at).getTime()) / 86400000;
    }, 0) / deliveredClients.length)
    : 0;
  const stuckClients = clients.filter(c => {
    if (c.status === 'published') return false;
    const last = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
    return nowMs - last > 7 * 86400000;
  }).length;
  const statusCounts: Record<string, number> = {};
  clients.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] || 0) + 1; });
  const activeClients = clients.filter(c => c.status !== 'published').length;

  // --- Needs attention ---
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
  needsAttention.sort((a, b) => (a.urgency === 'high' ? 0 : 1) - (b.urgency === 'high' ? 0 : 1));

  // --- Monthly chart data ---
  const months: { key: string; label: string; revenue: number; delivered: number; created: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: d.toLocaleDateString('fr-FR', { month: 'short' }), revenue: 0, delivered: 0, created: 0 });
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

  // --- Upcoming filming ---
  const upcomingFilming = clients
    .filter(c => c.filming_date && new Date(c.filming_date) >= new Date())
    .sort((a, b) => new Date(a.filming_date!).getTime() - new Date(b.filming_date!).getTime())
    .slice(0, 5);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800, fontSize: '1.6rem', color: 'var(--text)',
          margin: 0, lineHeight: 1.3,
        }}>
          Bonjour !
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
          {getFrenchDate()}
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '40px 0', textAlign: 'center' }}>
          Chargement...
        </div>
      ) : error ? (
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)', fontSize: '0.85rem',
        }}>
          {error}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12, marginBottom: 20,
          }}>
            <KpiCard title="Leads du jour" value={leadsToday.length.toString()} accent="var(--orange)" icon="◎">
              {leadsToday.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Aucun nouveau lead</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {leadsToday.slice(0, 2).map(c => (
                    <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{
                      fontSize: '0.75rem', color: 'var(--text-mid)', textDecoration: 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.business_name}
                    </Link>
                  ))}
                  {leadsToday.length > 2 && (
                    <Link href="/dashboard/clients" style={{ fontSize: '0.7rem', color: 'var(--orange)', textDecoration: 'none' }}>
                      +{leadsToday.length - 2} autres
                    </Link>
                  )}
                </div>
              )}
            </KpiCard>

            <KpiCard title="Encaissé ce mois" value={`${(monthlyRevenueCents / 100).toLocaleString('fr-FR')} €`} accent="var(--green)" icon="€">
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {revenueDelta === null ? 'Premier mois' : revenueDelta > 0 ? (
                  <span style={{ color: 'var(--green)' }}>+{revenueDelta}% vs M-1</span>
                ) : revenueDelta < 0 ? (
                  <span style={{ color: 'var(--red)' }}>{revenueDelta}% vs M-1</span>
                ) : '= mois dernier'}
              </span>
            </KpiCard>

            <KpiCard title="En attente" value={pendingPayment.length.toString()} accent="var(--yellow)" icon="⏳">
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {pendingPayment.length === 0 ? 'Tout encaissé' : `${pendingPayment.length} sans paiement`}
              </span>
            </KpiCard>

            <KpiCard
              title="Prochaine action"
              value={nextActions.length === 0 ? '—' : nextActions.length.toString()}
              accent={nextActions.length > 0 ? 'var(--red)' : 'var(--green)'}
              icon="!"
            >
              {nextActions.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tout est sous contrôle</span>
              ) : (
                <Link href={`/dashboard/clients/${nextActions[0].client.id}`} style={{
                  fontSize: '0.75rem', color: 'var(--text-mid)', textDecoration: 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                }}>
                  {nextActions[0].client.business_name} — {nextActions[0].label}
                </Link>
              )}
            </KpiCard>
          </div>

          {/* Compact metrics strip */}
          <div style={{
            display: 'flex', gap: 0,
            background: 'var(--night-card)', borderRadius: 12,
            border: '1px solid var(--border)',
            marginBottom: 20, overflow: 'hidden',
          }}>
            <MetricCell label="Clients actifs" value={activeClients.toString()} color="var(--orange)" />
            <MetricCell label="Revenus totaux" value={`${totalRevenue.toLocaleString('fr-FR')} €`} color="var(--green)" />
            <MetricCell label="Délai moyen" value={avgDeliveryDays > 0 ? `${avgDeliveryDays} j` : '—'} color="#3B82F6" />
            <MetricCell label="Bloqués" value={stuckClients.toString()} color={stuckClients > 0 ? 'var(--red)' : 'var(--green)'} last />
          </div>

          {/* Needs attention */}
          {needsAttention.length > 0 && (
            <div style={{
              background: 'var(--night-card)', borderRadius: 12,
              border: '1px solid var(--border-orange)',
              padding: '16px 20px', marginBottom: 20,
            }}>
              <div style={{
                fontSize: '0.82rem', fontWeight: 600, color: 'var(--orange)',
                marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>⚠</span> À traiter — {needsAttention.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {needsAttention.slice(0, 4).map(a => (
                  <Link key={a.client.id} href={`/dashboard/clients/${a.client.id}`} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--night-mid)', textDecoration: 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.client.business_name}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{a.reason}</div>
                    </div>
                    <span style={{
                      fontSize: '0.65rem', padding: '2px 8px', borderRadius: 20,
                      background: a.urgency === 'high' ? 'rgba(239,68,68,.12)' : 'rgba(250,204,21,.1)',
                      color: a.urgency === 'high' ? 'var(--red)' : 'var(--yellow)',
                      fontWeight: 600, whiteSpace: 'nowrap',
                    }}>{a.urgency === 'high' ? 'Urgent' : 'À voir'}</span>
                  </Link>
                ))}
                {needsAttention.length > 4 && (
                  <Link href="/dashboard/pipeline" style={{
                    fontSize: '0.72rem', color: 'var(--orange)', textDecoration: 'none',
                    textAlign: 'center', padding: '6px 0',
                  }}>
                    Voir les {needsAttention.length - 4} autres →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Two-column: Chart + Filming */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 16, marginBottom: 20,
          }}>
            {/* Monthly chart */}
            <div style={{
              background: 'var(--night-card)', borderRadius: 12,
              border: '1px solid var(--border)', padding: '18px 20px',
            }}>
              <h2 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-mid)', margin: '0 0 16px' }}>
                Performance — 6 mois
              </h2>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120, padding: '0 2px' }}>
                {months.map(m => {
                  const heightPct = (m.revenue / maxRevenue) * 100;
                  return (
                    <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {m.revenue > 0 ? `${m.revenue.toLocaleString('fr-FR')} €` : '—'}
                      </div>
                      <div style={{ width: '100%', height: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <div style={{
                          width: '65%',
                          height: `${Math.max(heightPct, m.revenue > 0 ? 4 : 0)}%`,
                          background: m.revenue > 0 ? 'linear-gradient(180deg, var(--orange) 0%, #C45520 100%)' : 'var(--night-mid)',
                          borderRadius: '3px 3px 0 0',
                          minHeight: m.revenue > 0 ? 4 : 0,
                          transition: 'height .4s ease',
                        }} />
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{m.label}</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'flex', gap: 4 }}>
                        <span title="Livrées">🎬{m.delivered}</span>
                        <span title="Nouveaux">+{m.created}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Upcoming filming */}
            <div style={{
              background: 'var(--night-card)', borderRadius: 12,
              border: '1px solid var(--border)', padding: '18px 20px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h2 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-mid)', margin: 0 }}>
                  Prochains tournages
                </h2>
                <Link href="/dashboard/scripts" style={{
                  fontSize: '0.72rem', color: 'var(--orange)', textDecoration: 'none', fontWeight: 500,
                }}>Tout voir →</Link>
              </div>
              {upcomingFilming.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  Aucun tournage planifié.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {upcomingFilming.map(c => {
                    const countdown = getCountdownLabel(c.filming_date!);
                    const daysUntil = getDaysUntil(c.filming_date!);
                    const isUrgent = daysUntil <= 3;
                    return (
                      <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 12px', borderRadius: 8,
                        background: 'var(--night-mid)', textDecoration: 'none',
                        transition: 'background .15s',
                      }}>
                        <div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text)', fontWeight: 500 }}>{c.business_name}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {new Date(c.filming_date!).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </div>
                        </div>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600,
                          color: isUrgent ? 'var(--orange)' : 'var(--text-mid)',
                          background: isUrgent ? 'rgba(232,105,43,.1)' : 'transparent',
                          padding: isUrgent ? '2px 8px' : '2px 0', borderRadius: 16,
                        }}>{countdown}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Activity feed */}
          {activity.length > 0 && (
            <div style={{
              background: 'var(--night-card)', borderRadius: 12,
              border: '1px solid var(--border)', padding: '18px 20px',
            }}>
              <h2 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-mid)', margin: '0 0 12px' }}>
                Activité récente
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {activity.slice(0, 8).map(ev => {
                  const meta = ACTIVITY_LABELS[ev.type] || { label: ev.type, icon: '•', color: 'var(--text-muted)' };
                  return (
                    <Link key={ev.id} href={`/dashboard/clients/${ev.client_id}`} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px',
                      borderRadius: 6, textDecoration: 'none', transition: 'background .15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--night-mid)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--night-mid)', border: `1.5px solid ${meta.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', color: meta.color,
                      }}>{meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text)' }}>
                          {ev.clients?.business_name || 'Client'}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}> — {meta.label}</span>
                      </div>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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

/* ---------- Sub-components ---------- */

function KpiCard({ title, value, accent, icon, children }: {
  title: string; value: string; accent: string; icon: string; children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 12,
      border: '1px solid var(--border)', padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{title}</div>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: `${accent}12`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.8rem', fontWeight: 700,
        }}>{icon}</div>
      </div>
      <div style={{
        fontSize: '1.5rem', fontWeight: 800, color: accent,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
      }}>{value}</div>
      <div>{children}</div>
    </div>
  );
}

function MetricCell({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px',
      borderRight: last ? 'none' : '1px solid var(--border)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.15rem', fontWeight: 700, color,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
      }}>{value}</div>
    </div>
  );
}
