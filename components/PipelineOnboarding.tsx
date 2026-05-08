'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { SkeletonCard } from '@/components/ui/Skeleton';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  email?: string;
  phone?: string;
  status: string;
  city?: string;
  category?: string;
  filming_date?: string;
  publication_deadline?: string;
  paid_at?: string;
  payment_amount?: number;
  delivered_at?: string;
  created_at: string;
  updated_at?: string;
  tags?: string[];
  // Flags qui découpent le bucket "onboarding" en sous-étapes virtuelles
  // côté pipeline (Compte / Contrat signé / Paiement reçu).
  contract_signed_at?: string | null;
  onboarding_call_booked?: boolean | null;
  onboarding_call_date?: string | null;
}

// Le pipeline expose désormais les 3 micro-étapes de l'onboarding (Compte
// créé, Contrat signé, Paiement reçu) en plus de l'Appel onboarding et
// des étapes post-script. Côté DB, ces 3 micro-étapes partagent le même
// status='onboarding' — on les distingue via les flags contract_signed_at
// + paid_at + onboarding_call_booked. Les clés `onboarding:*` sont des
// stages virtuels uniquement côté UI ; deriveStage(client) → clé virtuelle,
// stageKeyToFields(key) → patch DB à appliquer pour matcher la stage cible.
const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'onboarding:account',  label: 'Compte créé',     color: '#8A7060' },
  { key: 'onboarding:contract', label: 'Contrat signé',   color: '#F28C55' },
  { key: 'onboarding:payment',  label: 'Paiement reçu',   color: '#FACC15' },
  { key: 'onboarding_call',     label: 'Appel onboarding', color: '#14B8A6' },
  { key: 'script_writing',      label: 'Script',          color: '#FACC15' },
  { key: 'script_review',       label: 'Relecture',       color: '#F28C55' },
  { key: 'script_validated',    label: 'Validé',          color: '#22C55E' },
  { key: 'filming_scheduled',   label: 'Tournage',        color: '#3B82F6' },
  { key: 'filming_done',        label: 'Tourné',          color: '#8B5CF6' },
  { key: 'editing',             label: 'Montage',         color: '#EC4899' },
  { key: 'video_review',        label: 'Vidéo à valider', color: '#F97316' },
  { key: 'publication_pending', label: 'Date publi',      color: '#FB923C' },
  { key: 'published',           label: 'Publié',          color: '#22C55E' },
];

// Mappe un client vers sa colonne virtuelle dans le pipeline.
// Pour status='onboarding' : déduit la sous-étape via les flags.
// Pour les autres status : 1:1 avec la clé.
function deriveStage(c: Client): string {
  if (c.status === 'onboarding') {
    if (!c.contract_signed_at) return 'onboarding:account';
    if (!c.paid_at) return 'onboarding:contract';
    if (!c.onboarding_call_booked) return 'onboarding:payment';
    // Tous les flags sont posés mais le status n'a pas avancé — cas edge,
    // on les laisse dans la dernière colonne onboarding pour visibilité.
    return 'onboarding:payment';
  }
  return c.status;
}

// Le patch DB à appliquer quand l'admin drag un client vers une stage cible.
// Pour les stages virtuelles 'onboarding:*' on touche uniquement les flags
// (status reste 'onboarding'). Pour les autres on patch le status.
function stageKeyToFields(key: string): Record<string, unknown> {
  switch (key) {
    case 'onboarding:account':
      return {
        status: 'onboarding',
        contract_signed_at: null,
        paid_at: null,
        onboarding_call_booked: false,
        onboarding_call_date: null,
      };
    case 'onboarding:contract':
      return {
        status: 'onboarding',
        contract_signed_at: new Date().toISOString(),
        paid_at: null,
        onboarding_call_booked: false,
        onboarding_call_date: null,
      };
    case 'onboarding:payment':
      return {
        status: 'onboarding',
        contract_signed_at: new Date().toISOString(),
        paid_at: new Date().toISOString(),
        onboarding_call_booked: false,
        onboarding_call_date: null,
      };
    case 'onboarding_call':
      return {
        status: 'onboarding_call',
        contract_signed_at: new Date().toISOString(),
        paid_at: new Date().toISOString(),
        onboarding_call_booked: true,
      };
    default:
      return { status: key };
  }
}

type CardField = 'contact' | 'city' | 'category' | 'email' | 'phone' | 'filming_date' | 'payment' | 'tags' | 'days';

const FIELD_OPTIONS: { key: CardField; label: string }[] = [
  { key: 'contact', label: 'Contact' },
  { key: 'city', label: 'Ville' },
  { key: 'category', label: 'Catégorie' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'filming_date', label: 'Date tournage' },
  { key: 'payment', label: 'Paiement' },
  { key: 'tags', label: 'Tags' },
  { key: 'days', label: 'Jours dans étape' },
];

const DEFAULT_FIELDS: CardField[] = ['contact', 'city', 'filming_date', 'days'];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function daysIn(c: Client): number {
  const t = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
  return Math.floor((Date.now() - t) / 86400000);
}

export default function PipelineOnboarding() {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [visibleFields, setVisibleFields] = useState<CardField[]>(DEFAULT_FIELDS);
  const [showSettings, setShowSettings] = useState(false);
  const [dragClientId, setDragClientId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pipeline_fields');
      if (saved) setVisibleFields(JSON.parse(saved));
      const savedView = localStorage.getItem('pipeline_view');
      if (savedView === 'list' || savedView === 'kanban') setView(savedView);
    } catch { /* */ }
  }, []);

  const loadClients = useCallback(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error('Erreur de chargement');
        return r.json();
      })
      .then((d: Client[]) => setClients(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  // Refresh auto : (1) au retour sur l'onglet (visibilitychange) pour
  // capturer les modifs faites depuis un autre device/onglet, (2) sur
  // l'event 'bbm-clients-changed' qu'on dispatche localement quand un
  // client vient d'être créé ou modifié — ça évite le "il faut F5" que
  // l'admin remontait après l'ajout manuel d'un client.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadClients();
    };
    const onChanged = () => loadClients();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('bbm-clients-changed', onChanged);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('bbm-clients-changed', onChanged);
    };
  }, [loadClients]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
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
      const key = deriveStage(c);
      if (g[key]) g[key].push(c);
    });
    Object.values(g).forEach(arr => arr.sort((a, b) => daysIn(b) - daysIn(a)));
    return g;
  }, [filtered]);

  const moveClient = useCallback(async (clientId: string, newStageKey: string) => {
    const client = clients.find(x => x.id === clientId);
    const stage = STAGES.find(s => s.key === newStageKey);
    const fields = stageKeyToFields(newStageKey);
    setMovingId(clientId);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: clientId, ...fields }),
      });
      if (r.ok) {
        // Patch local en miroir des fields envoyés pour rester en cohérence
        // avec deriveStage() — ne pas patcher uniquement status sinon les
        // micro-étapes onboarding partagent toutes le même status='onboarding'
        // et la carte resterait dans la même colonne après le drop.
        setClients(prev => prev.map(x => x.id === clientId
          ? { ...x, ...fields, updated_at: new Date().toISOString() } as Client
          : x,
        ));
        if (client && stage) {
          toast.success(`${client.business_name} → ${stage.label}`, { emoji: '🎯' });
        }
      } else {
        toast.error("Le déplacement n'a pas pu être enregistré.");
      }
    } catch {
      toast.error("Le déplacement n'a pas pu être enregistré.");
    } finally {
      setMovingId(null);
    }
  }, [clients, toast]);

  function toggleField(f: CardField) {
    setVisibleFields(prev => {
      const next = prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f];
      localStorage.setItem('pipeline_fields', JSON.stringify(next));
      return next;
    });
  }

  function toggleView(v: 'kanban' | 'list') {
    setView(v);
    localStorage.setItem('pipeline_view', v);
  }

  // Drag handlers
  function onDragStart(e: React.DragEvent, clientId: string) {
    setDragClientId(clientId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', clientId);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
    }
  }

  function onDragEnd(e: React.DragEvent) {
    setDragClientId(null);
    setDropTarget(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }

  function onDragOver(e: React.DragEvent, stageKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(stageKey);
  }

  function onDragLeave() {
    setDropTarget(null);
  }

  function onDrop(e: React.DragEvent, stageKey: string) {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/plain');
    if (id && id !== stageKey) {
      const c = clients.find(x => x.id === id);
      // Compare avec la stage dérivée (pas le status nu) pour gérer les
      // 3 micro-étapes 'onboarding:*' qui partagent toutes status='onboarding'.
      if (c && deriveStage(c) !== stageKey) moveClient(id, stageKey);
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Toolbar — search + view toggle (header KPIs sont dans le tab container) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--night-card)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.8rem', outline: 'none', minWidth: 180,
            }}
          />
          {/* View toggle */}
          <div style={{
            display: 'flex', borderRadius: 8, overflow: 'hidden',
            border: '1px solid var(--border-md)',
          }}>
            {(['kanban', 'list'] as const).map(v => (
              <button key={v} onClick={() => toggleView(v)} style={{
                padding: '7px 12px', border: 'none', cursor: 'pointer',
                background: view === v ? 'var(--orange)' : 'var(--night-card)',
                color: view === v ? '#000' : 'var(--text-muted)',
                fontSize: '0.75rem', fontWeight: 600,
              }}>
                {v === 'kanban' ? '▤ Kanban' : '☰ Liste'}
              </button>
            ))}
          </div>
          {/* Création fiche depuis prospect GHL */}
          <CreateFromProspectButton />

          {/* Settings */}
          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowSettings(!showSettings)} style={{
              padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-md)',
              background: showSettings ? 'var(--orange)' : 'var(--night-card)',
              color: showSettings ? '#000' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
            }}>
              ⚙ Affichage
            </button>
            {showSettings && (
              <div style={{
                position: 'absolute', top: '110%', right: 0, zIndex: 50,
                background: 'var(--night-card)', border: '1px solid var(--border-md)',
                borderRadius: 10, padding: 12, minWidth: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,.4)',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Champs visibles
                </div>
                {FIELD_OPTIONS.map(f => (
                  <label key={f.key} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 0', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text)',
                  }}>
                    <input
                      type="checkbox"
                      checked={visibleFields.includes(f.key)}
                      onChange={() => toggleField(f.key)}
                      style={{ accentColor: 'var(--orange)' }}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 10,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)', fontSize: '0.82rem', marginBottom: 14,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ minWidth: 240, flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SkeletonCard lines={2} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={2} />
            </div>
          ))}
        </div>
      ) : view === 'kanban' ? (
        /* KANBAN VIEW */
        <div style={{
          display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, minHeight: 400,
        }}>
          {STAGES.map(stage => {
            const items = grouped[stage.key] || [];
            const isOver = dropTarget === stage.key && dragClientId !== null;
            return (
              <div
                key={stage.key}
                onDragOver={e => onDragOver(e, stage.key)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, stage.key)}
                style={{
                  flex: '0 0 260px',
                  background: isOver ? `${stage.color}08` : 'var(--night-card)',
                  borderRadius: 12,
                  border: `1.5px solid ${isOver ? stage.color : 'var(--border)'}`,
                  display: 'flex', flexDirection: 'column',
                  maxHeight: 'calc(100vh - 200px)',
                  transition: 'border-color .15s, background .15s',
                }}
              >
                {/* Column header */}
                <div style={{
                  padding: '12px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: stage.color }} />
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)' }}>{stage.label}</span>
                  </div>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, color: stage.color,
                    background: `${stage.color}15`, padding: '2px 7px', borderRadius: 10,
                  }}>{items.length}</span>
                </div>
                {/* Cards */}
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1 }}>
                  {items.length === 0 ? (
                    <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>—</div>
                  ) : items.map(c => (
                    <PipelineCard
                      key={c.id}
                      client={c}
                      fields={visibleFields}
                      moving={movingId === c.id}
                      dragging={dragClientId === c.id}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onMove={moveClient}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STAGES.map(stage => {
            const items = grouped[stage.key] || [];
            if (items.length === 0) return null;
            return (
              <div key={stage.key} style={{ marginBottom: 8 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '0 4px',
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: stage.color }} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>{stage.label}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({items.length})</span>
                </div>
                {items.map(c => {
                  const days = daysIn(c);
                  return (
                    <Link key={c.id} href={`/dashboard/clients/${c.id}`} style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
                      background: 'var(--night-card)', borderRadius: 8, border: '1px solid var(--border)',
                      textDecoration: 'none', marginBottom: 4,
                    }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.business_name}
                      </span>
                      {visibleFields.includes('contact') && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 100 }}>{c.contact_name}</span>
                      )}
                      {visibleFields.includes('city') && c.city && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 80 }}>{c.city}</span>
                      )}
                      {visibleFields.includes('filming_date') && c.filming_date && (
                        <span style={{ fontSize: '0.7rem', color: '#3B82F6', minWidth: 70 }}>
                          {new Date(c.filming_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {visibleFields.includes('days') && (
                        <span style={{ fontSize: '0.66rem', color: days > 7 ? 'var(--red)' : 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>
                          {days} j
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>›</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Card component */
function PipelineCard({
  client: c, fields, moving, dragging, onDragStart, onDragEnd, onMove,
}: {
  client: Client;
  fields: CardField[];
  moving: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onMove: (clientId: string, newStatus: string) => void;
}) {
  const days = daysIn(c);
  const stale = days > 7;
  const [menuOpen, setMenuOpen] = useState(false);
  const stage = STAGES.find(s => s.key === deriveStage(c));

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, c.id)}
      onDragEnd={onDragEnd}
      onClick={e => {
        // Make the whole card act as a link to the client detail. Don't trigger
        // when the click happened inside an interactive child (move menu, etc.).
        const target = e.target as HTMLElement;
        if (target.closest('button, a, [data-no-card-click]')) return;
        if (typeof window !== 'undefined') window.location.href = `/dashboard/clients/${c.id}`;
      }}
      style={{
        background: 'var(--night-mid)',
        borderRadius: 8,
        border: `1px solid ${stale ? 'rgba(239,68,68,.25)' : 'var(--border)'}`,
        padding: '9px 11px',
        opacity: moving ? 0.4 : dragging ? 0.5 : 1,
        cursor: 'grab',
        transition: 'opacity .15s, box-shadow .15s, background .15s',
        position: 'relative',
      }}
      onMouseEnter={e => { if (!dragging) e.currentTarget.style.background = 'var(--night-raised)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
    >
      {/* Stage pastille — visible au coup d'œil même quand on scrolle dans une colonne */}
      {stage && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 7px', borderRadius: 999, marginBottom: 5,
          background: stage.color + '20', border: `1px solid ${stage.color}40`,
          color: stage.color, fontSize: '0.6rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: stage.color }} />
          {stage.label}
        </div>
      )}
      <Link href={`/dashboard/clients/${c.id}`} style={{
        textDecoration: 'none', color: 'var(--text)',
        display: 'block', marginBottom: 3,
        fontSize: '0.82rem', fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {c.business_name}
      </Link>

      {fields.includes('contact') && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          {c.contact_name}{fields.includes('city') && c.city ? ` · ${c.city}` : ''}
        </div>
      )}
      {!fields.includes('contact') && fields.includes('city') && c.city && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{c.city}</div>
      )}
      {fields.includes('category') && c.category && (
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', opacity: 0.8 }}>{c.category}</div>
      )}
      {fields.includes('email') && c.email && (
        <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
      )}
      {fields.includes('phone') && c.phone && (
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{c.phone}</div>
      )}
      {fields.includes('filming_date') && c.filming_date && (
        <div style={{ fontSize: '0.66rem', color: '#3B82F6', marginTop: 3 }}>
          🎬 {new Date(c.filming_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
        </div>
      )}
      {fields.includes('payment') && (
        <div style={{ fontSize: '0.66rem', color: c.paid_at ? 'var(--green)' : 'var(--text-muted)', marginTop: 2 }}>
          {c.paid_at
            ? `✓ ${c.payment_amount ? (c.payment_amount / 100).toLocaleString('fr-FR') + ' €' : 'Payé'}`
            : 'Non payé'}
        </div>
      )}
      {fields.includes('tags') && c.tags && c.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
          {c.tags.slice(0, 3).map(t => (
            <span key={t} style={{
              fontSize: '0.6rem', padding: '1px 5px', borderRadius: 6,
              background: 'rgba(232,105,43,.1)', color: 'var(--orange)',
            }}>#{t}</span>
          ))}
        </div>
      )}
      {fields.includes('days') && (
        <div style={{ fontSize: '0.62rem', color: stale ? 'var(--red)' : 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
          {days === 0 ? "Aujourd'hui" : `${days} j`}
        </div>
      )}

      {/* Move-to button — explicit alternative to drag-and-drop */}
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', position: 'relative' }}
      >
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
          style={{
            width: '100%', padding: '4px 8px', borderRadius: 6,
            background: menuOpen ? 'var(--orange)' : 'transparent',
            color: menuOpen ? '#fff' : 'var(--text-muted)',
            border: '1px solid var(--border-md)',
            cursor: 'pointer', fontSize: '0.66rem', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          }}
        >
          <span>↗ Déplacer vers</span>
          <span style={{ fontSize: '0.66rem' }}>{menuOpen ? '×' : '▾'}</span>
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            marginTop: 4, padding: 4, borderRadius: 8,
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,.5)',
            display: 'flex', flexDirection: 'column', gap: 1,
            maxHeight: 280, overflowY: 'auto',
          }}>
            {STAGES.filter(s => s.key !== deriveStage(c)).map(stage => (
              <button
                key={stage.key}
                type="button"
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onMove(c.id, stage.key); }}
                style={{
                  textAlign: 'left', padding: '6px 8px', borderRadius: 4,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: '0.74rem', color: 'var(--text)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--night-mid)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{stage.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Bouton "+ Depuis prospect" : crée une fiche client en production
   à partir d'une opportunité GHL existante (pipeline commercial) qui
   n'a pas encore de client_id lié. Évite la double saisie : l'admin
   pick le prospect, choisit l'étape de départ, on crée la fiche.    */

interface OppMini {
  id: string;
  ghl_opportunity_id: string;
  client_id: string | null;
  name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  pipeline_stage_name: string | null;
  monetary_value_cents: number | null;
  ghl_updated_at: string | null;
}

const PROD_STEP_OPTIONS = [
  { num: 1, label: 'Compte créé' },
  { num: 2, label: 'Contrat à signer' },
  { num: 3, label: 'Paiement à régler' },
  { num: 4, label: 'Appel onboarding à booker' },
  { num: 5, label: 'Script en écriture' },
  { num: 6, label: 'Tournage à booker' },
  { num: 7, label: 'Publication à planifier' },
];

function CreateFromProspectButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [opps, setOpps] = useState<OppMini[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null);
  const [step, setStep] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadOpps = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/gh-opportunities', { headers: authHeaders() });
      if (!r.ok) throw new Error('fetch failed');
      const d = await r.json();
      const list: OppMini[] = (d.opportunities || []).filter((o: OppMini) => !o.client_id);
      list.sort((a, b) => (b.ghl_updated_at || '').localeCompare(a.ghl_updated_at || ''));
      setOpps(list);
    } catch {
      setError('Impossible de charger les prospects.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Force un sync GHL → DB (pull fresh + enrichi email/phone) puis recharge.
  // Sert quand un prospect existe côté GHL mais pas dans le picker car la
  // mirror locale est en retard ou a contact_email=null.
  const syncFromGhl = useCallback(async () => {
    setSyncing(true);
    setError('');
    try {
      await fetch('/api/admin/ghl-sync-opps', { method: 'POST', headers: authHeaders() });
      await loadOpps();
    } catch {
      setError('Sync GHL en échec.');
    } finally {
      setSyncing(false);
    }
  }, [loadOpps]);

  useEffect(() => {
    if (!open) return;
    // Sync + load au mount pour garantir qu'on a les derniers prospects GHL
    void syncFromGhl();
  }, [open, syncFromGhl]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return opps;
    return opps.filter(o => {
      const hay = [o.name, o.contact_name, o.contact_email, o.pipeline_stage_name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [opps, search]);

  async function submit() {
    if (!selectedOppId) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/clients/from-ghl-opportunity', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ opportunity_id: selectedOppId, onboarding_step: step }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Création impossible.');
        return;
      }
      const businessName = d?.client?.business_name || 'Client';
      toast.success(`${businessName} ajouté en production`, { emoji: '🚀' });
      // Refresh la kanban via l'event que loadClients écoute
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('bbm-clients-changed'));
      }
      setOpen(false);
      setSelectedOppId(null);
      setSearch('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '7px 12px', borderRadius: 8,
          background: 'var(--orange)', border: 'none', color: '#fff',
          cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700,
          boxShadow: '0 4px 14px rgba(232,105,43,.30)',
        }}
      >+ Ajouter</button>

      {open && (
        <div
          onClick={() => { if (!submitting) setOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(540px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
              background: 'var(--night-card)', borderRadius: 14,
              border: '1px solid var(--border-md)', boxShadow: '0 12px 40px rgba(0,0,0,.5)',
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{
                margin: 0, fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: '1rem', fontWeight: 700, color: 'var(--text)',
              }}>🚀 Créer une fiche depuis un prospect GHL</h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Reprend les infos GHL et bascule directement à l&apos;étape choisie.
                Seuls les prospects sans fiche client en production sont listés.
              </p>
            </div>

            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <input
                  type="text"
                  placeholder="🔍 Filtrer par nom / email / stage…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={syncFromGhl}
                  disabled={syncing || loading}
                  title="Re-pull les prospects depuis GHL (utile si un prospect créé à l'instant n'apparaît pas)"
                  style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text-mid)', cursor: syncing ? 'wait' : 'pointer',
                    fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                    opacity: syncing ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >{syncing ? '⏳' : '🔄 Sync GHL'}</button>
              </div>
              <div style={{
                flex: 1, minHeight: 200, maxHeight: 320, overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 4,
                background: 'var(--night-mid)', borderRadius: 8,
                border: '1px solid var(--border)', padding: 6,
              }}>
                {loading ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    ⏳ Chargement…
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                    {search ? 'Aucun prospect ne correspond à la recherche.' : 'Tous les prospects ont déjà une fiche en production.'}
                  </div>
                ) : (
                  filtered.map(o => {
                    const isSelected = selectedOppId === o.id;
                    return (
                      <button
                        key={o.id}
                        onClick={() => setSelectedOppId(o.id)}
                        style={{
                          textAlign: 'left', padding: '8px 10px', borderRadius: 6,
                          background: isSelected ? 'rgba(232,105,43,.14)' : 'transparent',
                          border: isSelected ? '1px solid rgba(232,105,43,.50)' : '1px solid transparent',
                          cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
                          display: 'flex', flexDirection: 'column', gap: 2,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {o.name || o.contact_name || 'Sans nom'}
                          </span>
                          {o.pipeline_stage_name && (
                            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {o.pipeline_stage_name}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {[o.contact_name, o.contact_email].filter(Boolean).join(' · ') || '—'}
                          {o.monetary_value_cents ? ` · ${(o.monetary_value_cents / 100).toLocaleString('fr-FR')} €` : ''}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                  Étape de départ
                </span>
                <select
                  value={step}
                  onChange={e => setStep(parseInt(e.target.value, 10))}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit',
                  }}
                >
                  {PROD_STEP_OPTIONS.map(o => (
                    <option key={o.num} value={o.num}>Étape {o.num} — {o.label}</option>
                  ))}
                </select>
              </label>

              {error && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(239,68,68,.08)', borderLeft: '3px solid var(--red)',
                  fontSize: '0.74rem', color: '#fca5a5',
                }}>{error}</div>
              )}
            </div>

            <div style={{
              padding: '12px 18px', borderTop: '1px solid var(--border)',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                onClick={() => { setOpen(false); setSelectedOppId(null); setError(''); }}
                disabled={submitting}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  background: 'transparent', border: '1px solid var(--border-md)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                }}
              >Annuler</button>
              <button
                onClick={submit}
                disabled={submitting || !selectedOppId}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  background: 'var(--orange)', border: 'none', color: '#fff',
                  cursor: !selectedOppId || submitting ? 'not-allowed' : 'pointer',
                  fontSize: '0.82rem', fontWeight: 700, fontFamily: 'inherit',
                  opacity: !selectedOppId || submitting ? 0.5 : 1,
                }}
              >{submitting ? '⏳ Création…' : '✓ Créer la fiche'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
