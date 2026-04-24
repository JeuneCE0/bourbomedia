'use client';

import { useEffect, useState, useMemo, useCallback, CSSProperties } from 'react';
import Link from 'next/link';

interface OnboardingClient {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  onboarding_step: number;
  created_at: string;
}

const STEPS = [
  { num: 1, label: 'Compte', shortLabel: 'Compte', color: '#8A7060', description: 'Création de compte' },
  { num: 2, label: 'Contrat', shortLabel: 'Contrat', color: '#F28C55', description: 'Signature du contrat' },
  { num: 3, label: 'Paiement', shortLabel: 'Paiement', color: '#FACC15', description: 'Paiement effectué' },
  { num: 4, label: 'Appel', shortLabel: 'Appel', color: '#3B82F6', description: 'Appel de lancement' },
  { num: 5, label: 'Script', shortLabel: 'Script', color: '#8B5CF6', description: 'Script vidéo' },
  { num: 6, label: 'Tournage', shortLabel: 'Tournage', color: '#EC4899', description: 'Date de tournage' },
  { num: 7, label: 'Publication', shortLabel: 'Publi.', color: '#22C55E', description: 'Date de publication' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days < 7) return `il y a ${days}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return (name || '?')
    .split(/[\s-]+/)
    .map(w => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function OnboardingDashboardPage() {
  const [clients, setClients] = useState<OnboardingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [dragClientId, setDragClientId] = useState<string | null>(null);
  const [dragSourceStep, setDragSourceStep] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/onboarding', { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
        return r.json();
      })
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .catch(e => console.error('Erreur chargement onboarding:', e))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.business_name?.toLowerCase().includes(q) ||
      c.contact_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const byStep = useMemo(() => {
    const map: Record<number, OnboardingClient[]> = {};
    STEPS.forEach(s => { map[s.num] = []; });
    filtered.forEach(c => {
      const step = c.onboarding_step || 1;
      if (step >= 8) return; // completed, not shown in kanban
      if (!map[step]) map[step] = [];
      map[step].push(c);
    });
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const total = clients.length;
    const completed = clients.filter(c => (c.onboarding_step || 0) >= 8).length;
    const active = total - completed;
    const stuck = clients.filter(c => {
      const step = c.onboarding_step || 1;
      if (step >= 8) return false;
      const daysSinceCreation = (Date.now() - new Date(c.created_at).getTime()) / 86400000;
      return daysSinceCreation > 3 && step < 3;
    }).length;
    return { total, active, completed, stuck };
  }, [clients]);

  // --- Drag & Drop handlers ---

  const moveClient = useCallback(async (clientId: string, newStep: number) => {
    // Optimistic update: immediately move the card
    const previousClients = clients;
    setClients(prev =>
      prev.map(c => c.id === clientId ? { ...c, onboarding_step: newStep } : c)
    );

    try {
      const r = await fetch('/api/clients', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ id: clientId, onboarding_step: newStep }),
      });
      if (!r.ok) throw new Error('Erreur API');
    } catch {
      // Revert on failure
      setClients(previousClients);
      console.error('Erreur lors du déplacement du client, changement annulé.');
    }
  }, [clients]);

  function onDragStart(e: React.DragEvent, clientId: string, currentStep: number) {
    setDragClientId(clientId);
    setDragSourceStep(currentStep);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', clientId);
    e.dataTransfer.setData('application/x-step', String(currentStep));
    // Set opacity on the dragged element
    if (e.currentTarget instanceof HTMLElement) {
      requestAnimationFrame(() => {
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      });
    }
  }

  function onDragEnd(e: React.DragEvent) {
    setDragClientId(null);
    setDragSourceStep(null);
    setDropTarget(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }

  function onColumnDragOver(e: React.DragEvent, stepNum: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(stepNum);
  }

  function onColumnDragLeave() {
    setDropTarget(null);
  }

  function onColumnDrop(e: React.DragEvent, stepNum: number) {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/plain');
    if (id) {
      const c = clients.find(x => x.id === id);
      if (c && (c.onboarding_step || 1) !== stepNum) {
        moveClient(id, stepNum);
      }
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800,
          fontSize: '1.75rem',
          color: 'var(--text)',
          margin: 0,
          lineHeight: 1.3,
        }}>
          Suivi de l&apos;onboarding
        </h1>
        <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
          Pipeline de conversion des prospects en clients
        </p>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <StatBox label="Total" value={stats.total} color="var(--orange)" />
        <StatBox label="En cours" value={stats.active} color="#3B82F6" />
        <StatBox label="Termin&eacute;s" value={stats.completed} color="var(--green)" />
        <StatBox label="Bloqu&eacute;s &gt;3j" value={stats.stuck} color={stats.stuck > 0 ? 'var(--red)' : 'var(--text-muted)'} />
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
      }}>
        <input
          type="text"
          placeholder="Rechercher un client, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 240,
            padding: '10px 14px',
            background: 'var(--night-mid)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            fontSize: '0.88rem',
            outline: 'none',
          }}
        />
        <div style={{
          display: 'flex',
          gap: 2,
          background: 'var(--night-mid)',
          padding: 3,
          borderRadius: 8,
          border: '1px solid var(--border)',
        }}>
          <ViewToggle label="Kanban" active={viewMode === 'kanban'} onClick={() => setViewMode('kanban')} />
          <ViewToggle label="Liste" active={viewMode === 'list'} onClick={() => setViewMode('list')} />
        </div>
      </div>

      {loading ? (
        <div style={{
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
          padding: '60px 0',
          textAlign: 'center',
        }}>
          Chargement...
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanView
          byStep={byStep}
          dragClientId={dragClientId}
          dragSourceStep={dragSourceStep}
          dropTarget={dropTarget}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onColumnDragOver={onColumnDragOver}
          onColumnDragLeave={onColumnDragLeave}
          onColumnDrop={onColumnDrop}
        />
      ) : (
        <ListView clients={filtered} />
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: 'var(--night-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 18px',
    }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4, letterSpacing: '.2px' }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.6rem',
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

function ViewToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        border: 'none',
        background: active ? 'var(--night-raised)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        fontSize: '0.82rem',
        fontWeight: active ? 600 : 400,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all .15s',
      }}
    >
      {label}
    </button>
  );
}

interface KanbanViewProps {
  byStep: Record<number, OnboardingClient[]>;
  dragClientId: string | null;
  dragSourceStep: number | null;
  dropTarget: number | null;
  onDragStart: (e: React.DragEvent, clientId: string, currentStep: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onColumnDragOver: (e: React.DragEvent, stepNum: number) => void;
  onColumnDragLeave: () => void;
  onColumnDrop: (e: React.DragEvent, stepNum: number) => void;
}

function KanbanView({
  byStep,
  dragClientId,
  dragSourceStep,
  dropTarget,
  onDragStart,
  onDragEnd,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop,
}: KanbanViewProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${STEPS.length}, minmax(220px, 1fr))`,
      gap: 14,
      overflowX: 'auto',
      paddingBottom: 20,
    }}>
      {STEPS.map(step => {
        const list = byStep[step.num] || [];
        const isDragging = dragClientId !== null;
        const isOver = dropTarget === step.num && isDragging;
        const isSourceColumn = dragSourceStep === step.num;
        return (
          <div
            key={step.num}
            onDragOver={e => onColumnDragOver(e, step.num)}
            onDragLeave={onColumnDragLeave}
            onDrop={e => onColumnDrop(e, step.num)}
            style={{
              background: isOver && !isSourceColumn
                ? `${step.color}0D`
                : 'var(--night-mid)',
              border: '1.5px solid',
              borderColor: isOver && !isSourceColumn
                ? step.color
                : 'var(--border)',
              borderRadius: 12,
              padding: 12,
              minWidth: 220,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'border-color .15s, background .15s',
            }}
          >
            {/* Column header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px 10px',
              borderBottom: '1px solid var(--border)',
              marginBottom: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: step.color + '30',
                  color: step.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                }}>
                  {step.num}
                </div>
                <span style={{
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: 'var(--text)',
                }}>
                  {step.label}
                </span>
              </div>
              <span style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                background: 'var(--night-card)',
                padding: '2px 8px',
                borderRadius: 10,
                fontWeight: 600,
              }}>
                {list.length}
              </span>
            </div>

            {/* Cards */}
            {list.length === 0 ? (
              <div style={{
                padding: '20px 10px',
                textAlign: 'center',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                opacity: 0.5,
              }}>
                Vide
              </div>
            ) : (
              list.map(c => (
                <KanbanCard
                  key={c.id}
                  client={c}
                  color={step.color}
                  isDragging={dragClientId === c.id}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  client,
  color,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  client: OnboardingClient;
  color: string;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, clientId: string, currentStep: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const initials = getInitials(client.business_name);
  const daysSinceCreation = Math.floor((Date.now() - new Date(client.created_at).getTime()) / 86400000);
  const isStuck = daysSinceCreation > 3 && client.onboarding_step < 3;

  const cardStyle: CSSProperties = {
    background: 'var(--night-card)',
    border: '1px solid',
    borderColor: hovered ? color + '60' : 'var(--border)',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'grab',
    textDecoration: 'none',
    transition: 'all .15s ease',
    transform: hovered && !isDragging ? 'translateY(-1px)' : 'translateY(0)',
    boxShadow: hovered && !isDragging ? '0 4px 12px rgba(0,0,0,.3)' : 'none',
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      draggable
      onDragStart={e => {
        onDragStart(e, client.id, client.onboarding_step || 1);
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={cardStyle}
    >
      <Link
        href={`/dashboard/clients/${client.id}`}
        style={{ textDecoration: 'none', color: 'inherit', display: 'contents' }}
        onClick={e => {
          // Prevent navigation if we just finished dragging
          if (isDragging) e.preventDefault();
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: color + '20',
            color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.7rem',
            fontWeight: 700,
            flexShrink: 0,
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.82rem',
              color: 'var(--text)',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 2,
            }}>
              {client.business_name}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {client.contact_name}
            </div>
          </div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.7rem',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {relativeTime(client.created_at)}
          </span>
          {isStuck && (
            <span style={{
              color: 'var(--red)',
              background: 'rgba(239,68,68,.1)',
              padding: '2px 8px',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.65rem',
            }}>
              Bloqu&eacute;
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}

function ListView({ clients }: { clients: OnboardingClient[] }) {
  if (clients.length === 0) {
    return (
      <div style={{
        padding: '60px 20px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '0.9rem',
        background: 'var(--night-card)',
        borderRadius: 12,
        border: '1px solid var(--border)',
      }}>
        Aucun client en onboarding
      </div>
    );
  }
  return (
    <div style={{
      background: 'var(--night-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2.5fr 1.5fr 1fr 2fr 1fr',
        gap: 16,
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        fontWeight: 600,
        letterSpacing: '.3px',
        textTransform: 'uppercase',
      }}>
        <div>Client</div>
        <div>Contact</div>
        <div>Email</div>
        <div>&Eacute;tape</div>
        <div style={{ textAlign: 'right' }}>Cr&eacute;&eacute;</div>
      </div>
      {clients.map(c => <ListRow key={c.id} client={c} />)}
    </div>
  );
}

function ListRow({ client }: { client: OnboardingClient }) {
  const [hovered, setHovered] = useState(false);
  const step = client.onboarding_step || 1;
  const stepInfo = STEPS.find(s => s.num === step) || STEPS[0];
  const isCompleted = step >= 8;

  return (
    <Link
      href={`/dashboard/clients/${client.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '2.5fr 1.5fr 1fr 2fr 1fr',
        gap: 16,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        textDecoration: 'none',
        background: hovered ? 'var(--night-raised)' : 'transparent',
        transition: 'background .15s',
        alignItems: 'center',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        fontSize: '0.88rem',
        color: 'var(--text)',
        fontWeight: 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {client.business_name}
      </div>
      <div style={{
        fontSize: '0.82rem',
        color: 'var(--text-mid)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {client.contact_name}
      </div>
      <div style={{
        fontSize: '0.78rem',
        color: 'var(--text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {client.email}
      </div>
      <div>
        {isCompleted ? (
          <span style={{
            fontSize: '0.75rem',
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(34,197,94,.15)',
            color: 'var(--green)',
            fontWeight: 600,
          }}>
            ✓ Termin&eacute;
          </span>
        ) : (
          <StepProgressBar step={step} color={stepInfo.color} label={stepInfo.label} />
        )}
      </div>
      <div style={{
        fontSize: '0.78rem',
        color: 'var(--text-muted)',
        textAlign: 'right',
      }}>
        {relativeTime(client.created_at)}
      </div>
    </Link>
  );
}

function StepProgressBar({ step, color, label }: { step: number; color: string; label: string }) {
  const progress = ((step - 1) / 7) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: '0.75rem',
          color,
          fontWeight: 600,
        }}>
          {step}. {label}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {step}/7
        </span>
      </div>
      <div style={{
        height: 4,
        background: 'var(--night-mid)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: color,
          transition: 'width .3s',
        }} />
      </div>
    </div>
  );
}
