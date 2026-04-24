'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  city?: string;
  category?: string;
  filming_date?: string;
  publication_deadline?: string;
  paid_at?: string;
  delivered_at?: string;
  created_at: string;
  updated_at?: string;
  tags?: string[];
}

const STAGES: { key: string; label: string; color: string; description: string }[] = [
  { key: 'onboarding', label: 'Onboarding', color: '#8A7060', description: 'Lead à qualifier' },
  { key: 'script_writing', label: 'Script', color: '#FACC15', description: 'En rédaction' },
  { key: 'script_review', label: 'Relecture', color: '#F28C55', description: 'Côté client' },
  { key: 'script_validated', label: 'Validé', color: '#22C55E', description: 'Prêt à tourner' },
  { key: 'filming_scheduled', label: 'Tournage', color: '#3B82F6', description: 'Planifié' },
  { key: 'filming_done', label: 'Tourné', color: '#8B5CF6', description: 'À monter' },
  { key: 'editing', label: 'Montage', color: '#EC4899', description: 'En cours' },
  { key: 'published', label: 'Livré', color: '#22C55E', description: 'Publié' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function daysIn(c: Client): number {
  const t = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
  return Math.floor((Date.now() - t) / 86400000);
}

export default function PipelinePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error('Erreur de chargement');
        return r.json();
      })
      .then((d: Client[]) => setClients(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.business_name.toLowerCase().includes(q) ||
      c.contact_name?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const grouped = useMemo(() => {
    const g: Record<string, Client[]> = {};
    STAGES.forEach(s => { g[s.key] = []; });
    filtered.forEach(c => {
      if (g[c.status]) g[c.status].push(c);
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => daysIn(b) - daysIn(a)));
    return g;
  }, [filtered]);

  async function moveClient(c: Client, newStatus: string) {
    setMovingId(c.id);
    setOpenMenu(null);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ id: c.id, status: newStatus }),
      });
      if (r.ok) {
        setClients(prev => prev.map(x => x.id === c.id ? { ...x, status: newStatus, updated_at: new Date().toISOString() } : x));
      }
    } catch { /* */ } finally {
      setMovingId(null);
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800, fontSize: '1.75rem', color: 'var(--text)',
            margin: 0, lineHeight: 1.2,
          }}>
            Pipeline
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
            Suivi visuel — du lead à la livraison
          </p>
        </div>
        <input
          type="text"
          placeholder="Rechercher un client…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
            minWidth: 240,
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)', fontSize: '0.85rem', marginBottom: 16,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '40px 0', textAlign: 'center' }}>
          Chargement…
        </div>
      ) : (
        <div style={{
          display: 'flex',
          gap: 14,
          overflowX: 'auto',
          paddingBottom: 12,
          minHeight: 400,
        }}>
          {STAGES.map(stage => {
            const items = grouped[stage.key] || [];
            return (
              <div
                key={stage.key}
                style={{
                  flex: '0 0 280px',
                  background: 'var(--night-card)',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column',
                  maxHeight: 'calc(100vh - 200px)',
                }}
              >
                <div style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: stage.color, flexShrink: 0,
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{stage.label}</div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{stage.description}</div>
                    </div>
                  </div>
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, color: stage.color,
                    background: `${stage.color}15`, padding: '3px 8px', borderRadius: 12,
                    minWidth: 24, textAlign: 'center',
                  }}>{items.length}</div>
                </div>
                <div style={{
                  padding: 10,
                  display: 'flex', flexDirection: 'column', gap: 8,
                  overflowY: 'auto', flex: 1,
                }}>
                  {items.length === 0 ? (
                    <div style={{
                      padding: '24px 8px', textAlign: 'center',
                      color: 'var(--text-muted)', fontSize: '0.75rem',
                    }}>—</div>
                  ) : items.map(c => {
                    const days = daysIn(c);
                    const stale = days > 7;
                    return (
                      <div
                        key={c.id}
                        style={{
                          background: 'var(--night-mid)',
                          borderRadius: 10,
                          border: `1px solid ${stale ? 'rgba(239,68,68,.3)' : 'var(--border)'}`,
                          padding: '10px 12px',
                          opacity: movingId === c.id ? 0.5 : 1,
                          transition: 'opacity .15s',
                          position: 'relative',
                        }}
                      >
                        <Link href={`/dashboard/clients/${c.id}`} style={{
                          textDecoration: 'none', color: 'var(--text)',
                          display: 'block', marginBottom: 4,
                          fontSize: '0.82rem', fontWeight: 600,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {c.business_name}
                        </Link>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                          {c.contact_name}{c.city ? ` · ${c.city}` : ''}
                        </div>
                        {c.filming_date && (
                          <div style={{ fontSize: '0.68rem', color: '#3B82F6', marginBottom: 4 }}>
                            🎬 {new Date(c.filming_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </div>
                        )}
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          marginTop: 8, fontSize: '0.66rem',
                        }}>
                          <span style={{ color: stale ? 'var(--red)' : 'var(--text-muted)' }}>
                            {days === 0 ? "Aujourd'hui" : `${days} j`}
                          </span>
                          <button
                            onClick={() => setOpenMenu(openMenu === c.id ? null : c.id)}
                            style={{
                              background: 'none', border: 'none', color: 'var(--text-muted)',
                              cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                              fontSize: '0.7rem',
                            }}
                          >
                            Déplacer ▾
                          </button>
                        </div>
                        {openMenu === c.id && (
                          <div style={{
                            position: 'absolute', top: '100%', right: 8, zIndex: 50,
                            background: 'var(--night-card)', border: '1px solid var(--border-md)',
                            borderRadius: 8, padding: 4, minWidth: 160,
                            boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                            marginTop: 4,
                          }}>
                            {STAGES.filter(s => s.key !== c.status).map(s => (
                              <button
                                key={s.key}
                                onClick={() => moveClient(c, s.key)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  width: '100%', padding: '6px 10px',
                                  background: 'none', border: 'none',
                                  color: 'var(--text)', fontSize: '0.75rem',
                                  cursor: 'pointer', textAlign: 'left',
                                  borderRadius: 6,
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
