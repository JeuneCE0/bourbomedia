'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SkeletonCard } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import AppointmentsToDocument from '@/components/AppointmentsToDocument';
import ProspectsToFollowUp from '@/components/ProspectsToFollowUp';

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

const ACTIVITY_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  status_changed: { label: 'Statut modifié', emoji: '🔄', color: 'var(--text-mid)' },
  script_sent_to_client: { label: 'Script envoyé', emoji: '📤', color: 'var(--orange)' },
  script_validated: { label: 'Script validé', emoji: '✅', color: 'var(--green)' },
  script_changes_requested: { label: 'Modifs demandées', emoji: '✏️', color: 'var(--yellow)' },
  video_delivered: { label: 'Vidéo livrée', emoji: '🎬', color: 'var(--green)' },
  filming_scheduled: { label: 'Tournage planifié', emoji: '📅', color: 'var(--orange)' },
  satisfaction_submitted: { label: 'Avis client reçu', emoji: '⭐', color: '#FACC15' },
  payment_received: { label: 'Paiement reçu', emoji: '💸', color: 'var(--green)' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
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
  if (days < 0) return `Il y a ${Math.abs(days)} j`;
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

interface Bucket {
  client: Client;
  reason: string;
  cta?: string;
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
  const todayKey = now.toISOString().slice(0, 10);

  // ---------- Urgency buckets ----------
  const urgentToday: Bucket[] = [];
  const next24h: Bucket[] = [];
  const thisWeek: Bucket[] = [];

  clients.forEach(c => {
    if (c.status === 'published') return;
    const lastMs = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
    const daysIdle = Math.floor((nowMs - lastMs) / 86400000);

    // Filming today / tomorrow / this week
    if (c.filming_date) {
      const days = getDaysUntil(c.filming_date);
      if (days === 0 && c.status !== 'filming_done' && c.status !== 'editing') {
        urgentToday.push({ client: c, reason: '🎬 Tournage aujourd\'hui', cta: 'Préparer' });
      } else if (days === 1 && c.status !== 'filming_done' && c.status !== 'editing') {
        next24h.push({ client: c, reason: '🎬 Tournage demain', cta: 'Confirmer' });
      } else if (days >= 2 && days <= 7 && c.status === 'filming_scheduled') {
        thisWeek.push({ client: c, reason: `🎬 Tournage ${getCountdownLabel(c.filming_date)}` });
      }
    }

    // Stuck script_review (urgent if > 7d, attention if > 3d)
    if (c.status === 'script_review') {
      if (daysIdle > 7) urgentToday.push({ client: c, reason: `⏰ Script en relecture depuis ${daysIdle} j — relancer`, cta: 'Relancer' });
      else if (daysIdle > 3) next24h.push({ client: c, reason: `📝 Script en relecture depuis ${daysIdle} j` });
    }

    // Inactivity > 14 days
    if (daysIdle > 14) {
      urgentToday.push({ client: c, reason: `💤 Aucune activité depuis ${daysIdle} j` });
    }

    // Script writing stuck > 3d
    if (c.status === 'script_writing' && daysIdle >= 3) {
      next24h.push({ client: c, reason: `✍️ Script à écrire depuis ${daysIdle} j` });
    }

    // Payment overdue (no payment but client onboarded > 7 days ago)
    if (!c.paid_at && c.status !== 'onboarding' && c.status !== 'published') {
      const sinceCreation = Math.floor((nowMs - new Date(c.created_at).getTime()) / 86400000);
      if (sinceCreation >= 14) urgentToday.push({ client: c, reason: `💰 Paiement en retard (${sinceCreation} j sans règlement)`, cta: 'Relancer' });
      else if (sinceCreation >= 7) next24h.push({ client: c, reason: `💰 Paiement en attente depuis ${sinceCreation} j` });
    }
  });

  // Dedup by client+reason
  const dedup = (arr: Bucket[]) => {
    const seen = new Set<string>();
    return arr.filter(b => {
      const key = `${b.client.id}|${b.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const urgent = dedup(urgentToday);
  const soon = dedup(next24h);
  const week = dedup(thisWeek);

  // ---------- Stats récap ----------
  const leadsToday = clients.filter(c => c.created_at?.slice(0, 10) === todayKey);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthlyRevenueCents = clients
    .filter(c => c.paid_at && new Date(c.paid_at).getTime() >= monthStart)
    .reduce((s, c) => s + (c.payment_amount || 0), 0);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const lastMonthRevenueCents = clients
    .filter(c => c.paid_at && new Date(c.paid_at).getTime() >= lastMonthStart && new Date(c.paid_at).getTime() < monthStart)
    .reduce((s, c) => s + (c.payment_amount || 0), 0);
  const revenueDelta = lastMonthRevenueCents > 0
    ? Math.round(((monthlyRevenueCents - lastMonthRevenueCents) / lastMonthRevenueCents) * 100)
    : null;
  const activeClients = clients.filter(c => c.status !== 'published').length;
  const deliveredThisMonth = clients.filter(c => c.delivered_at && new Date(c.delivered_at).getTime() >= monthStart).length;
  const pendingPayment = clients.filter(c => !c.paid_at && c.status !== 'published').length;

  // Scripts that need admin attention
  const scriptsToFinish = clients
    .filter(c => c.status === 'script_writing' || c.status === 'script_review')
    .map(c => {
      const lastMs = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
      const idleDays = Math.floor((nowMs - lastMs) / 86400000);
      return { client: c, idleDays };
    })
    .sort((a, b) => b.idleDays - a.idleDays);

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800, fontSize: '1.7rem', color: 'var(--text)',
          margin: 0, lineHeight: 1.2,
        }}>
          {getGreeting()} 👋
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
          {getFrenchDate()}
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </div>
      ) : error ? (
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)', fontSize: '0.85rem',
        }}>
          ❌ {error}
        </div>
      ) : clients.length === 0 ? (
        <div style={{
          background: 'var(--night-card)', border: '1px solid var(--border)',
          borderRadius: 14, padding: 24,
        }}>
          <EmptyState
            emoji="🚀"
            title="Bienvenue sur votre dashboard"
            description="Commencez par ajouter votre premier client pour démarrer."
            action={
              <Link href="/dashboard/clients" style={{
                display: 'inline-block', padding: '10px 18px', borderRadius: 10,
                background: 'var(--orange)', color: '#fff', textDecoration: 'none',
                fontWeight: 600, fontSize: '0.9rem',
              }}>➕ Ajouter un client</Link>
            }
          />
        </div>
      ) : (
        <div className="bm-stagger">
          {/* Daily metrics — editable: calls / ads / closing rate / gross profit */}
          <DailyMetricsCard clients={clients} />

          {/* Appels à documenter (notes post-call → bidirectionnel GHL) */}
          <AppointmentsToDocument />

          {/* Prospects à relancer (statuts En réflexion J+2 / Follow-up J+7) */}
          <ProspectsToFollowUp />

          {/* Urgency: Today */}
          <UrgencySection
            tone="red"
            emoji="🔴"
            title="Aujourd'hui"
            subtitle="À traiter en priorité"
            items={urgent}
            emptyMessage="Rien d'urgent — profitez-en !"
          />

          {/* Urgency: Next 24h */}
          <UrgencySection
            tone="orange"
            emoji="🟠"
            title="Dans les 24h"
            subtitle="À surveiller"
            items={soon}
            emptyMessage="Pas d'alerte pour demain."
          />

          {/* Urgency: This week */}
          <UrgencySection
            tone="yellow"
            emoji="🟡"
            title="Cette semaine"
            subtitle="Tournages à venir"
            items={week}
            emptyMessage="Aucun tournage planifié cette semaine."
          />

          {/* Scripts to finish */}
          <ScriptsToFinishSection items={scriptsToFinish} />

          {/* Récap */}
          <div style={{
            background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
            padding: '18px 20px', marginBottom: 18,
          }}>
            <h2 style={{
              fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-mid)',
              margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              <span aria-hidden>✅</span> Récap business
            </h2>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12,
            }}>
              <Stat emoji="🚀" label="Leads aujourd'hui" value={leadsToday.length.toString()} color="var(--orange)" />
              <Stat emoji="💸" label="Encaissé ce mois" value={`${(monthlyRevenueCents / 100).toLocaleString('fr-FR')} €`} color="var(--green)" extra={
                revenueDelta !== null
                  ? <span style={{ color: revenueDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {revenueDelta >= 0 ? '+' : ''}{revenueDelta}% vs M-1
                    </span>
                  : 'Premier mois'
              } />
              <Stat emoji="🎬" label="Vidéos livrées (mois)" value={deliveredThisMonth.toString()} color="#3B82F6" />
              <Stat emoji="👥" label="Clients actifs" value={activeClients.toString()} color="var(--orange)" />
              <Stat emoji="⏳" label="Sans paiement" value={pendingPayment.toString()} color={pendingPayment > 0 ? 'var(--yellow)' : 'var(--green)'} />
            </div>
          </div>

          {/* Activity feed */}
          {activity.length > 0 && (
            <div style={{
              background: 'var(--night-card)', borderRadius: 14,
              border: '1px solid var(--border)', padding: '18px 20px',
            }}>
              <h2 style={{
                fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-mid)',
                margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                <span aria-hidden>📈</span> Activité récente
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {activity.slice(0, 8).map(ev => {
                  const meta = ACTIVITY_LABELS[ev.type] || { label: ev.type, emoji: '•', color: 'var(--text-muted)' };
                  return (
                    <Link key={ev.id} href={`/dashboard/clients/${ev.client_id}`} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 8, textDecoration: 'none', transition: 'background .15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--night-mid)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span aria-hidden style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--night-mid)', border: `1.5px solid ${meta.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.85rem',
                      }}>{meta.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>
                          {ev.clients?.business_name || 'Client'}
                        </span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}> — {meta.label}</span>
                      </div>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {relativeTime(ev.created_at)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

const TONES: Record<'red' | 'orange' | 'yellow' | 'green', { bg: string; border: string; color: string }> = {
  red: { bg: 'rgba(239,68,68,.08)', border: 'rgba(239,68,68,.30)', color: '#FCA5A5' },
  orange: { bg: 'rgba(232,105,43,.08)', border: 'rgba(232,105,43,.30)', color: '#FFB58A' },
  yellow: { bg: 'rgba(250,204,21,.08)', border: 'rgba(250,204,21,.35)', color: '#FDE68A' },
  green: { bg: 'rgba(34,197,94,.08)', border: 'rgba(34,197,94,.30)', color: '#86EFAC' },
};

function UrgencySection({
  tone, emoji, title, subtitle, items, emptyMessage,
}: {
  tone: 'red' | 'orange' | 'yellow' | 'green';
  emoji: string;
  title: string;
  subtitle: string;
  items: Bucket[];
  emptyMessage: string;
}) {
  const t = TONES[tone];
  const isEmpty = items.length === 0;
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: `1px solid ${isEmpty ? 'var(--border)' : t.border}`,
      padding: '16px 20px', marginBottom: 14,
      opacity: isEmpty ? 0.7 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: isEmpty ? 4 : 12, gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>{emoji}</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>{title}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{subtitle}</div>
          </div>
        </div>
        {!isEmpty && (
          <span style={{
            padding: '3px 10px', borderRadius: 999,
            background: t.bg, border: `1px solid ${t.border}`, color: t.color,
            fontSize: '0.72rem', fontWeight: 700,
          }}>{items.length}</span>
        )}
      </div>
      {isEmpty ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: 30 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.slice(0, 6).map((b, i) => (
            <Link key={`${b.client.id}-${i}`} href={`/dashboard/clients/${b.client.id}`} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--night-mid)', textDecoration: 'none',
              transition: 'background .15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--night-raised)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--night-mid)'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.client.business_name}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-mid)' }}>{b.reason}</div>
              </div>
              {b.cta && (
                <span style={{
                  fontSize: '0.7rem', padding: '4px 10px', borderRadius: 999,
                  background: t.bg, border: `1px solid ${t.border}`, color: t.color,
                  fontWeight: 700, whiteSpace: 'nowrap',
                }}>{b.cta} →</span>
              )}
            </Link>
          ))}
          {items.length > 6 && (
            <Link href="/dashboard/production" style={{
              fontSize: '0.74rem', color: 'var(--orange)', textDecoration: 'none',
              textAlign: 'center', padding: '6px 0', fontWeight: 600,
            }}>
              Voir les {items.length - 6} autres →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

interface ClosingStats {
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

function DailyMetricsCard({ clients: _clients }: { clients: Client[] }) {
  const [stats, setStats] = useState<ClosingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/closing-stats', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setStats(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
      padding: '18px 20px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{
          fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-mid)',
          margin: 0, display: 'flex', alignItems: 'center', gap: 8,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          <span aria-hidden>📊</span> Aujourd&apos;hui en chiffres
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
            (auto · GHL + Stripe)
          </span>
        </h2>
        <Link href="/dashboard/settings?tab=ads" style={{
          background: 'transparent', border: '1px solid var(--border-md)', color: 'var(--text-muted)',
          borderRadius: 8, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600,
          textDecoration: 'none',
        }}>⚙️ Paramètres</Link>
      </div>

      {loading || !stats ? (
        <div style={{ height: 80, background: 'var(--night-mid)', borderRadius: 8 }} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <DailyStat emoji="🚶" label="Prospects" value={stats.new_leads.toString()} color="var(--orange)" />
          <DailyStat emoji="📞" label="Appels réservés" value={stats.calls_booked.toString()} color="#3B82F6" hint={stats.booking_rate !== null ? `${stats.booking_rate}% des prospects` : undefined} />
          <DailyStat emoji="✅" label="Appels réalisés" value={stats.calls_done.toString()} color="#A855F7" hint={stats.attendance_rate !== null ? `${stats.attendance_rate}% présence` : undefined} />
          <DailyStat emoji="🏆" label="Closings gagnés" value={stats.calls_won.toString()} color="var(--green)" hint={stats.closing_rate !== null ? `${stats.closing_rate}% taux closing` : undefined} />
          <DailyStat emoji="💸" label="Encaissé" value={`${(stats.revenue_paid_cents / 100).toLocaleString('fr-FR')} €`} color="var(--green)" />
          <DailyStat emoji="🚀" label="Prospects en cours" value={stats.pipeline_open_count.toString()} color="#3B82F6" hint={stats.pipeline_open_count > 0 ? `≈ ${(stats.pipeline_value_cents / 100).toLocaleString('fr-FR')} € à signer` : 'Pipeline vide'} />
          <DailyStat emoji="💰" label="Budget Ads" value={`${(stats.ads_budget_cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} color="var(--text-mid)" hint="pro-rata jour" />
          <DailyStat emoji="📈" label="Bénéfice brut" value={`${(stats.gross_profit_cents / 100).toLocaleString('fr-FR')} €`} color={stats.gross_profit_cents >= 0 ? 'var(--green)' : 'var(--red)'} hint="Encaissé − Ads − Presta" />
        </div>
      )}
    </div>
  );
}

function DailyStat({ emoji, label, value, color, hint }: { emoji: string; label: string; value: string; color: string; hint?: string }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: 'var(--night-mid)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span aria-hidden>{emoji}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color, fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function ScriptsToFinishSection({ items }: { items: { client: Client; idleDays: number }[] }) {
  const isEmpty = items.length === 0;
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: `1px solid ${isEmpty ? 'var(--border)' : 'rgba(232,105,43,.30)'}`,
      padding: '16px 20px', marginBottom: 14,
      opacity: isEmpty ? 0.7 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: isEmpty ? 4 : 12, gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📝</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Scripts à finaliser</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Écriture en cours ou retours client à appliquer
            </div>
          </div>
        </div>
        {!isEmpty && (
          <span style={{
            padding: '3px 10px', borderRadius: 999,
            background: 'rgba(232,105,43,.16)', border: '1px solid rgba(232,105,43,.45)',
            color: '#FFB58A', fontSize: '0.72rem', fontWeight: 700,
          }}>{items.length}</span>
        )}
      </div>
      {isEmpty ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: 30 }}>
          Aucun script en cours d&apos;écriture ou en attente de modifs.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.slice(0, 6).map(({ client, idleDays }) => {
            const isWriting = client.status === 'script_writing';
            const tone = idleDays >= 5 ? 'red' : idleDays >= 2 ? 'orange' : 'neutral';
            const toneStyle: Record<string, { bg: string; border: string; color: string }> = {
              red:     { bg: 'rgba(239,68,68,.16)',  border: 'rgba(239,68,68,.45)',  color: '#FCA5A5' },
              orange:  { bg: 'rgba(232,105,43,.16)', border: 'rgba(232,105,43,.45)', color: '#FFB58A' },
              neutral: { bg: 'var(--night-raised)',  border: 'var(--border-md)',     color: 'var(--text-mid)' },
            };
            const t = toneStyle[tone];
            return (
              <Link key={client.id} href={`/dashboard/clients/${client.id}?tab=script`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 10,
                background: 'var(--night-mid)', textDecoration: 'none',
                transition: 'background .15s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--night-raised)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--night-mid)'}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {client.business_name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-mid)' }}>
                    {isWriting ? '✍️ Script à écrire' : '✏️ Modifs à appliquer'}
                    {idleDays > 0 && <span style={{ color: 'var(--text-muted)' }}> · {idleDays} j sans bouger</span>}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.7rem', padding: '4px 10px', borderRadius: 999,
                  background: t.bg, border: `1px solid ${t.border}`, color: t.color,
                  fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                  {isWriting ? 'Écrire →' : 'Renvoyer →'}
                </span>
              </Link>
            );
          })}
          {items.length > 6 && (
            <Link href="/dashboard/scripts" style={{
              fontSize: '0.74rem', color: 'var(--orange)', textDecoration: 'none',
              textAlign: 'center', padding: '6px 0', fontWeight: 600,
            }}>
              Voir les {items.length - 6} autres scripts →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ emoji, label, value, color, extra }: {
  emoji: string; label: string; value: string; color: string; extra?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: 'var(--night-mid)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden>{emoji}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{
        fontSize: '1.3rem', fontWeight: 800, color,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1.1,
      }}>{value}</div>
      {extra && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{extra}</div>}
    </div>
  );
}
