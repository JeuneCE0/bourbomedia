'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  email?: string;
  phone?: string;
  city?: string;
  category?: string;
  status: string;
  filming_date?: string;
  publication_deadline?: string;
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

const AVATAR_COLORS = [
  '#E8692B', '#3B82F6', '#8B5CF6', '#22C55E',
  '#EC4899', '#FACC15', '#F28C55', '#6366F1',
  '#14B8A6', '#F43F5E', '#8A7060', '#0EA5E9',
];

const STEPS = Object.keys(STATUS_LABELS);

type SortOption = 'created_desc' | 'created_asc' | 'alpha_asc' | 'alpha_desc' | 'status';
type ViewMode = 'list' | 'grid';

const SORT_LABELS: Record<SortOption, string> = {
  created_desc: 'Plus récent',
  created_asc: 'Plus ancien',
  alpha_asc: 'A → Z',
  alpha_desc: 'Z → A',
  status: 'Statut',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function getInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `Il y a ${months} mois`;
  }
  const years = Math.floor(diffDays / 365);
  return `Il y a ${years} an${years > 1 ? 's' : ''}`;
}

const cssVars = {
  '--card-border': 'var(--border)',
  '--card-border-hover': 'var(--border-orange)',
  '--card-bg': 'var(--night-card)',
  '--card-bg-hover': 'var(--night-card-hover)',
  '--card-shadow': '0 2px 8px rgba(0,0,0,.15)',
  '--card-shadow-hover': '0 8px 24px rgba(232,105,43,.12), 0 4px 12px rgba(0,0,0,.2)',
  '--form-anim-duration': '350ms',
  '--transition-fast': '150ms',
  '--transition-med': '250ms',
} as React.CSSProperties;

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formMounted, setFormMounted] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('created_desc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [form, setForm] = useState({ business_name: '', contact_name: '', email: '', phone: '', city: '', category: '' });
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function loadClients() {
    fetch('/api/clients', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadClients(); }, []);

  // Animate form slide
  useEffect(() => {
    if (showForm) {
      setFormMounted(true);
    } else {
      const timeout = setTimeout(() => setFormMounted(false), 350);
      return () => clearTimeout(timeout);
    }
  }, [showForm]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/clients', { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) });
      if (r.ok) {
        setShowForm(false);
        setForm({ business_name: '', contact_name: '', email: '', phone: '', city: '', category: '' });
        loadClients();
      }
    } finally { setSaving(false); }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: clients.length };
    for (const c of clients) {
      counts[c.status] = (counts[c.status] || 0) + 1;
    }
    return counts;
  }, [clients]);

  const filtered = useMemo(() => {
    let result = clients.filter(c => {
      if (filter !== 'all' && c.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return c.business_name.toLowerCase().includes(q) || c.contact_name.toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q);
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      switch (sort) {
        case 'created_desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'created_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'alpha_asc':
          return a.business_name.localeCompare(b.business_name, 'fr');
        case 'alpha_desc':
          return b.business_name.localeCompare(a.business_name, 'fr');
        case 'status':
          return STEPS.indexOf(a.status) - STEPS.indexOf(b.status);
        default:
          return 0;
      }
    });

    return result;
  }, [clients, filter, search, sort]);

  return (
    <div style={{ ...cssVars, padding: 'clamp(16px, 3vw, 32px)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', margin: 0,
          }}>
            Clients
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {clients.length} client{clients.length !== 1 ? 's' : ''} au total
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{
          padding: '10px 20px', borderRadius: 10, background: 'var(--orange)', color: '#fff',
          border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'background var(--transition-fast)',
          boxShadow: '0 2px 8px rgba(232,105,43,.25)',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(255,255,255,.2)', fontSize: '0.85rem', lineHeight: 1,
            transform: showForm ? 'rotate(45deg)' : 'rotate(0deg)',
            transition: 'transform var(--transition-med)',
          }}>+</span>
          Nouveau client
        </button>
      </div>

      {/* Create form - slide down panel */}
      {formMounted && (
        <div style={{
          overflow: 'hidden',
          maxHeight: showForm ? 500 : 0,
          opacity: showForm ? 1 : 0,
          marginBottom: showForm ? 24 : 0,
          transition: `max-height var(--form-anim-duration) cubic-bezier(0.4, 0, 0.2, 1),
                       opacity var(--form-anim-duration) cubic-bezier(0.4, 0, 0.2, 1),
                       margin-bottom var(--form-anim-duration) cubic-bezier(0.4, 0, 0.2, 1)`,
        }}>
          <form ref={formRef} onSubmit={handleCreate} style={{
            background: 'var(--night-card)', borderRadius: 16,
            border: '1px solid var(--border-orange)',
            padding: 'clamp(16px, 3vw, 28px)',
            boxShadow: '0 4px 20px rgba(232,105,43,.08)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(232,105,43,.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: '0.85rem', color: 'var(--orange)',
              }}>+</div>
              <span style={{
                fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)',
              }}>Nouveau client</span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
              gap: 16, marginBottom: 24,
            }}>
              {([
                ['business_name', 'Nom du commerce *', 'Boulangerie Dupont...'],
                ['contact_name', 'Nom du contact *', 'Jean Dupont...'],
                ['email', 'Email', 'contact@exemple.fr...'],
                ['phone', 'Téléphone', '06 12 34 56 78...'],
                ['city', 'Ville', 'Lyon...'],
                ['category', 'Catégorie', 'Restaurant, Hôtel...'],
              ] as const).map(([key, label, placeholder]) => (
                <label key={key} style={{ display: 'block' }}>
                  <span style={{
                    display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)',
                    marginBottom: 6, fontWeight: 500, letterSpacing: '0.02em',
                  }}>{label}</span>
                  <input
                    value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
                    required={key === 'business_name' || key === 'contact_name'}
                    placeholder={placeholder}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10,
                      background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                      color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                      transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
                      outline: 'none',
                    }}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'var(--orange)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(232,105,43,.12)';
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'var(--border-md)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </label>
              ))}
            </div>

            <div style={{
              display: 'flex', gap: 10, justifyContent: 'flex-end',
              borderTop: '1px solid var(--border)', paddingTop: 20,
            }}>
              <button type="button" onClick={() => setShowForm(false)} style={{
                padding: '10px 20px', borderRadius: 10, background: 'transparent',
                border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
                transition: 'all var(--transition-fast)',
              }}>Annuler</button>
              <button type="submit" disabled={saving} style={{
                padding: '10px 24px', borderRadius: 10, background: 'var(--orange)',
                color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer',
                fontSize: '0.82rem', opacity: saving ? 0.7 : 1,
                boxShadow: '0 2px 8px rgba(232,105,43,.25)',
                transition: 'all var(--transition-fast)',
              }}>{saving ? 'Création...' : 'Créer le client'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Search + Filters + Sort + View toggle */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24,
      }}>
        {/* Top row: search, sort, view toggle */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {/* Search with icon */}
          <div style={{
            position: 'relative', flex: '1 1 200px', maxWidth: 320, minWidth: 160,
          }}>
            <svg style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              width: 15, height: 15, opacity: 0.4, pointerEvents: 'none',
            }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              placeholder="Rechercher un client..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '9px 12px 9px 36px', borderRadius: 10,
                background: 'var(--night-card)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.82rem', boxSizing: 'border-box',
                outline: 'none', transition: 'border-color var(--transition-fast)',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--orange)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = ''; }}
            />
          </div>

          {/* Sort dropdown */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortOption)}
            style={{
              padding: '9px 14px', borderRadius: 10,
              background: 'var(--night-card)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.78rem', cursor: 'pointer',
              outline: 'none', appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A7060' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              paddingRight: 32, minWidth: 120,
            }}
          >
            {Object.entries(SORT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          {/* View toggle */}
          <div style={{
            display: 'flex', borderRadius: 10, overflow: 'hidden',
            border: '1px solid var(--border-md)',
          }}>
            <button
              onClick={() => setViewMode('list')}
              title="Vue liste"
              style={{
                padding: '8px 12px', border: 'none', cursor: 'pointer',
                background: viewMode === 'list' ? 'var(--orange)' : 'var(--night-card)',
                color: viewMode === 'list' ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--transition-fast)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="Vue grille"
              style={{
                padding: '8px 12px', border: 'none', cursor: 'pointer',
                background: viewMode === 'grid' ? 'var(--orange)' : 'var(--night-card)',
                color: viewMode === 'grid' ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--transition-fast)',
                borderLeft: '1px solid var(--border-md)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter pills - horizontally scrollable */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
        }}>
          <FilterBtn
            label="Tous"
            count={statusCounts.all || 0}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <FilterBtn
              key={key}
              label={label}
              count={statusCounts[key] || 0}
              active={filter === key}
              onClick={() => setFilter(key)}
              color={STATUS_COLORS[key]}
            />
          ))}
        </div>
      </div>

      {/* Client list / grid */}
      {loading ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 60, gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid var(--border-md)', borderTopColor: 'var(--orange)',
            animation: 'spin 0.8s linear infinite',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement des clients...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 'clamp(40px, 8vw, 80px) 20px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}>
          {/* Empty state illustration */}
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'var(--night-card)', border: '2px dashed var(--border-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 8,
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <p style={{
              color: 'var(--text)', fontSize: '1rem', fontWeight: 600, margin: '0 0 6px',
            }}>
              {search || filter !== 'all' ? 'Aucun client trouvé' : 'Pas encore de clients'}
            </p>
            <p style={{
              color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0, maxWidth: 300,
              lineHeight: 1.5,
            }}>
              {search
                ? `Aucun résultat pour "${search}". Essayez un autre terme de recherche.`
                : filter !== 'all'
                  ? `Aucun client avec le statut "${STATUS_LABELS[filter]}".`
                  : 'Cliquez sur "Nouveau client" pour ajouter votre premier client et commencer.'}
            </p>
          </div>
          {!search && filter === 'all' && (
            <button onClick={() => setShowForm(true)} style={{
              marginTop: 8, padding: '10px 24px', borderRadius: 10,
              background: 'var(--orange)', color: '#fff', border: 'none',
              fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(232,105,43,.25)',
            }}>+ Ajouter un client</button>
          )}
        </div>
      ) : (
        <div style={viewMode === 'grid' ? {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
          gap: 16,
        } : {
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {filtered.map(client => {
            const isHovered = hoveredCard === client.id;
            const avatarColor = getAvatarColor(client.business_name);
            const currentStepIdx = STEPS.indexOf(client.status);

            return (
              <Link
                key={client.id}
                href={`/dashboard/clients/${client.id}`}
                onMouseEnter={() => setHoveredCard(client.id)}
                onMouseLeave={() => setHoveredCard(null)}
                style={{
                  display: 'block', textDecoration: 'none',
                  background: isHovered ? 'var(--card-bg-hover)' : 'var(--card-bg)',
                  borderRadius: 14,
                  border: `1px solid ${isHovered ? 'var(--card-border-hover)' : 'var(--card-border)'}`,
                  padding: viewMode === 'grid' ? '20px' : '16px 20px',
                  transition: `all var(--transition-med) cubic-bezier(0.4, 0, 0.2, 1)`,
                  transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                  boxShadow: isHovered
                    ? 'var(--card-shadow-hover)'
                    : 'var(--card-shadow)',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 14,
                  gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: `${avatarColor}20`,
                      border: `2px solid ${avatarColor}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.95rem', fontWeight: 700, color: avatarColor,
                      flexShrink: 0,
                      transition: 'transform var(--transition-fast)',
                      transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                    }}>
                      {getInitial(client.business_name)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{client.business_name}</div>
                      <div style={{
                        fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {client.contact_name}
                        {client.city ? ` — ${client.city}` : ''}
                        {client.category ? ` · ${client.category}` : ''}
                      </div>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span style={{
                    fontSize: '0.72rem', padding: '5px 14px', borderRadius: 20,
                    background: STATUS_COLORS[client.status] + '18',
                    color: STATUS_COLORS[client.status], fontWeight: 600,
                    whiteSpace: 'nowrap', flexShrink: 0,
                    border: `1px solid ${STATUS_COLORS[client.status]}30`,
                    letterSpacing: '0.01em',
                  }}>{STATUS_LABELS[client.status]}</span>
                </div>

                {/* Stepper with dots */}
                <div style={{
                  display: 'flex', gap: 3, alignItems: 'center',
                  padding: '0 2px',
                }}>
                  {STEPS.map((step, i) => {
                    const done = i <= currentStepIdx;
                    const isCurrent = i === currentStepIdx;
                    return (
                      <div key={step} style={{
                        display: 'flex', alignItems: 'center', flex: 1, gap: 3,
                      }}>
                        {/* Dot */}
                        <div style={{
                          width: isCurrent ? 10 : 7,
                          height: isCurrent ? 10 : 7,
                          borderRadius: '50%',
                          background: done ? STATUS_COLORS[step] : 'var(--border-md)',
                          flexShrink: 0,
                          transition: 'all var(--transition-med)',
                          boxShadow: isCurrent ? `0 0 6px ${STATUS_COLORS[step]}50` : 'none',
                        }} title={STATUS_LABELS[step]} />
                        {/* Connecting line (skip last) */}
                        {i < STEPS.length - 1 && (
                          <div style={{
                            flex: 1, height: 2, borderRadius: 1,
                            background: done && i < currentStepIdx
                              ? STATUS_COLORS[step]
                              : 'var(--border-md)',
                            transition: 'background var(--transition-med)',
                          }} />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Bottom row: filming date + last updated */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 10, gap: 8, flexWrap: 'wrap',
                }}>
                  {client.filming_date ? (
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                      <span style={{ opacity: 0.7 }}>Tournage :</span>{' '}
                      {new Date(client.filming_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                  ) : <div />}
                  <div style={{
                    fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.6,
                    fontStyle: 'italic',
                  }}>
                    {relativeDate(client.created_at)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterBtn({ label, count, active, onClick, color }: {
  label: string; count: number; active: boolean; onClick: () => void; color?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
        fontSize: '0.74rem', fontWeight: active ? 600 : 400,
        background: active
          ? (color ? color + '20' : 'rgba(232,105,43,.15)')
          : hovered
            ? 'var(--night-raised)'
            : 'var(--night-mid)',
        color: active ? (color || 'var(--orange)') : 'var(--text-muted)',
        transition: 'all 150ms',
        display: 'flex', alignItems: 'center', gap: 6,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {color && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: color,
          display: 'inline-block', opacity: active ? 1 : 0.5,
        }} />
      )}
      {label}
      <span style={{
        fontSize: '0.65rem',
        background: active
          ? (color ? color + '30' : 'rgba(232,105,43,.2)')
          : 'rgba(255,255,255,.06)',
        padding: '1px 6px', borderRadius: 10,
        color: active ? (color || 'var(--orange)') : 'var(--text-muted)',
        fontWeight: 500, minWidth: 18, textAlign: 'center',
      }}>{count}</span>
    </button>
  );
}
