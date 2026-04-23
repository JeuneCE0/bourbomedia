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

  const totalInPipeline = clients.length || 1;

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
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

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
