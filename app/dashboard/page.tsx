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
  filming_date?: string;
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

export default function DashboardPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .finally(() => setLoading(false));
  }, []);

  const statusCounts: Record<string, number> = {};
  clients.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] || 0) + 1; });

  const upcomingFilming = clients
    .filter(c => c.filming_date && new Date(c.filming_date) >= new Date())
    .sort((a, b) => new Date(a.filming_date!).getTime() - new Date(b.filming_date!).getTime())
    .slice(0, 5);

  return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.5rem', marginBottom: 24 }}>
        Tableau de bord
      </h1>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
      ) : (
        <>
          {/* Stats cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
            <StatCard label="Total clients" value={clients.length} color="var(--orange)" />
            <StatCard label="Scripts en cours" value={(statusCounts.script_writing || 0) + (statusCounts.script_review || 0)} color="var(--yellow)" />
            <StatCard label="Scripts validés" value={statusCounts.script_validated || 0} color="var(--green)" />
            <StatCard label="Tournages planifiés" value={statusCounts.filming_scheduled || 0} color="#3B82F6" />
            <StatCard label="Publiés" value={statusCounts.published || 0} color="var(--green)" />
          </div>

          {/* Pipeline overview */}
          <div style={{
            background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            padding: 20, marginBottom: 24,
          }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 16, color: 'var(--text-mid)' }}>Pipeline</h2>
            <div style={{ display: 'flex', gap: 4, height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
              {Object.entries(STATUS_LABELS).map(([key]) => (
                <div key={key} style={{
                  flex: statusCounts[key] || 0,
                  background: STATUS_COLORS[key],
                  minWidth: statusCounts[key] ? 4 : 0,
                  transition: 'flex .3s',
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[key] }} />
                  {label}: {statusCounts[key] || 0}
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming filming */}
          {upcomingFilming.length > 0 && (
            <div style={{
              background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
              padding: 20, marginBottom: 24,
            }}>
              <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 16, color: 'var(--text-mid)' }}>Prochains tournages</h2>
              {upcomingFilming.map(c => (
                <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                  background: 'var(--night-mid)', textDecoration: 'none',
                }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{c.business_name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--orange)' }}>
                    {new Date(c.filming_date!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Recent clients */}
          <div style={{
            background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-mid)' }}>Derniers clients</h2>
              <Link href="/dashboard/clients" style={{
                fontSize: '0.8rem', color: 'var(--orange)', textDecoration: 'none',
              }}>Voir tout →</Link>
            </div>
            {clients.slice(0, 5).map(c => (
              <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                background: 'var(--night-mid)', textDecoration: 'none',
              }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{c.business_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.contact_name} — {c.city}</div>
                </div>
                <span style={{
                  fontSize: '0.7rem', padding: '3px 8px', borderRadius: 20,
                  background: STATUS_COLORS[c.status] + '20',
                  color: STATUS_COLORS[c.status],
                  fontWeight: 500,
                }}>{STATUS_LABELS[c.status]}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
      padding: '16px 20px',
    }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color, fontFamily: "'Bricolage Grotesque', sans-serif" }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
}
