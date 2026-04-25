'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { SkeletonCard } from '@/components/ui/Skeleton';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  ghl_contact_id: string | null;
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: string;
  starts_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  client_id: string | null;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  opportunity_name: string | null;
  pipeline_stage_name: string | null;
  opportunity_id: string | null;
}

const STAGES: { key: string; label: string; emoji: string; color: string }[] = [
  { key: 'awaiting_signature', label: 'Attente signature + paiement', emoji: '✍️', color: '#3B82F6' },
  { key: 'reflection',         label: 'En réflexion',                 emoji: '🤔', color: '#FACC15' },
  { key: 'follow_up',          label: 'Follow-up',                    emoji: '🔁', color: '#F97316' },
  { key: 'ghosting',           label: 'Ghosting',                     emoji: '👻', color: '#94A3B8' },
  { key: 'contracted',         label: 'Contracté',                    emoji: '🤝', color: '#22C55E' },
  { key: 'regular',            label: 'Client régulier',              emoji: '⭐', color: '#A855F7' },
  { key: 'closed_lost',        label: 'Perdu',                        emoji: '❌', color: '#EF4444' },
  { key: 'not_interested',     label: 'Pas intéressé',                emoji: '🚫', color: '#737373' },
];
const UNDOCUMENTED_KEY = '__undocumented__';

const STATUS_BY_KEY = STAGES.reduce<Record<string, typeof STAGES[number]>>((acc, s) => { acc[s.key] = s; return acc; }, {});

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} j`;
  if (days < 30) return `Il y a ${Math.floor(days / 7)} sem.`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function PipelinePage() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    fetch('/api/gh-appointments?recent=1', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => setAppts(d.appointments || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pipeline = closing appointments only
  const closings = useMemo(
    () => appts.filter(a => a.calendar_kind === 'closing' && a.status !== 'no_show' && a.status !== 'cancelled'),
    [appts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return closings;
    return closings.filter(a => {
      const hay = [a.opportunity_name, a.contact_name, a.contact_email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [closings, search]);

  const grouped = useMemo(() => {
    const out: Record<string, Appointment[]> = { [UNDOCUMENTED_KEY]: [] };
    STAGES.forEach(s => { out[s.key] = []; });
    filtered.forEach(a => {
      const key = a.prospect_status && out[a.prospect_status] ? a.prospect_status : UNDOCUMENTED_KEY;
      out[key].push(a);
    });
    return out;
  }, [filtered]);

  // Sort each column by recency (most recent call first)
  Object.keys(grouped).forEach(k => {
    grouped[k].sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  });

  const totalClosings = closings.length;
  const wonCount = grouped.contracted.length + grouped.regular.length;
  const winRate = totalClosings > 0 ? Math.round((wonCount / totalClosings) * 100) : null;

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: '1.7rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          }}>
            🎯 Pipeline commercial
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Mirroir de la <strong>Pipeline Bourbon Média</strong> dans GHL — synchro bidirectionnelle
          </p>
        </div>
        <div style={{
          display: 'flex', gap: 0, padding: 0, borderRadius: 10,
          background: 'var(--night-card)', border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          <Stat label="Closings" value={totalClosings.toString()} color="var(--orange)" />
          <Stat label="Gagnés" value={wonCount.toString()} color="var(--green)" />
          <Stat label="Win rate" value={winRate !== null ? `${winRate}%` : '—'} color="#3B82F6" last />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          type="text" placeholder="🔍 Rechercher un prospect / opportunité…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', maxWidth: 420, padding: '9px 14px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
          }}
        />
      </div>

      {loading ? (
        <SkeletonCard lines={6} />
      ) : closings.length === 0 ? (
        <div style={{
          background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🪧</div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Aucun closing pour l&apos;instant</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
            Lance le backfill GHL depuis <strong>⚙️ Paramètres → 🔌 Intégrations</strong> pour importer ton historique.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          alignItems: 'start',
        }}>
          {/* Undocumented column comes first if any */}
          {grouped[UNDOCUMENTED_KEY].length > 0 && (
            <Column
              emoji="📞"
              label="À documenter"
              color="#A855F7"
              items={grouped[UNDOCUMENTED_KEY]}
            />
          )}
          {STAGES.map(s => (
            <Column
              key={s.key}
              emoji={s.emoji}
              label={s.label}
              color={s.color}
              items={grouped[s.key]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Column({ emoji, label, color, items }: { emoji: string; label: string; color: string; items: Appointment[] }) {
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 10,
      border: `1px solid ${items.length > 0 ? color + '40' : 'var(--border)'}`,
      padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
      maxHeight: 'calc(100vh - 220px)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: '0.85rem' }}>{emoji}</span>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
        </div>
        <span style={{
          padding: '1px 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700,
          background: items.length > 0 ? color + '20' : 'var(--night-mid)',
          color: items.length > 0 ? color : 'var(--text-muted)',
          border: `1px solid ${items.length > 0 ? color + '40' : 'var(--border-md)'}`,
          flexShrink: 0,
        }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', padding: '8px 4px', fontStyle: 'italic' }}>
            Aucun prospect ici
          </div>
        ) : (
          items.map(a => <Card key={a.id} appt={a} />)
        )}
      </div>
    </div>
  );
}

function Card({ appt }: { appt: Appointment }) {
  return (
    <div
      title={appt.notes || ''}
      style={{
        padding: '6px 10px', borderRadius: 6,
        background: 'var(--night-mid)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        cursor: appt.notes ? 'help' : 'default',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {appt.opportunity_name || appt.contact_name || appt.contact_email || 'Sans nom'}
        </div>
      </div>
      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>
        {relativeDate(appt.starts_at)}
      </span>
    </div>
  );
}

function Stat({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      padding: '10px 18px', textAlign: 'center', minWidth: 80,
      borderRight: last ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color, fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}
