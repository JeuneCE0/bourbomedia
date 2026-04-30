'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';

interface InboxItem {
  id: string;
  kind: 'script' | 'video_feedback' | 'appointment' | 'payment' | 'task';
  client_id: string | null;
  client_name: string | null;
  title: string;
  description?: string;
  timestamp: string;
  href: string;
  priority: 'high' | 'normal';
}

interface InboxCounts {
  total: number;
  high: number;
  by_kind: Record<InboxItem['kind'], number>;
}

const KIND_META: Record<InboxItem['kind'], { emoji: string; label: string; color: string }> = {
  script:         { emoji: '📝', label: 'Scripts à valider',     color: '#FACC15' },
  video_feedback: { emoji: '🎬', label: 'Retours vidéo',         color: '#3B82F6' },
  appointment:    { emoji: '📅', label: 'RDV à documenter',      color: 'var(--orange)' },
  payment:        { emoji: '💸', label: 'Paiements en attente',  color: 'var(--green)' },
  task:           { emoji: '✅', label: 'Tâches dues',           color: '#8B5CF6' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | InboxItem['kind']>('all');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/inbox', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setItems(Array.isArray(d.items) ? d.items : []);
        setCounts(d.counts || null);
      }
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh tous les 30s + refresh instantané au retour du tab.
  // Skip pendant que l'onglet est caché — cf. useVisibilityAwarePolling.
  useVisibilityAwarePolling(load, 30_000);

  const filtered = useMemo(
    () => items.filter(it => filter === 'all' || it.kind === filter),
    [items, filter],
  );

  return (
    <div style={{ padding: '24px 28px 40px', maxWidth: 880, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
          fontSize: '1.6rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          📥 Inbox
          {counts && counts.total > 0 && (
            <span style={{
              fontSize: '0.7rem', padding: '3px 10px', borderRadius: 999,
              background: counts.high > 0 ? 'rgba(239,68,68,.15)' : 'var(--night-mid)',
              color: counts.high > 0 ? '#EF4444' : 'var(--text-muted)', fontWeight: 700,
            }}>{counts.total} action{counts.total > 1 ? 's' : ''}</span>
          )}
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Tout ce qui demande ton attention en un seul endroit
        </p>
      </header>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} emoji="🌐" label="Tout" count={counts?.total} />
        {(Object.keys(KIND_META) as InboxItem['kind'][]).map(k => (
          <FilterPill
            key={k}
            active={filter === k}
            onClick={() => setFilter(k)}
            emoji={KIND_META[k].emoji}
            label={KIND_META[k].label}
            count={counts?.by_kind[k]}
          />
        ))}
      </div>

      {/* List */}
      {loading && items.length === 0 ? (
        <div className="bm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '32px 20px', borderRadius: 12, textAlign: 'center',
          background: 'var(--night-card)', border: '1px dashed var(--border-md)',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-mid)' }}>
            Inbox zéro — rien à traiter !
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(it => {
            const meta = KIND_META[it.kind];
            return (
              <Link key={it.id} href={it.href} style={{
                display: 'flex', gap: 14, padding: '14px 16px',
                background: 'var(--night-card)', borderRadius: 12,
                border: `1px solid ${it.priority === 'high' ? 'rgba(239,68,68,.4)' : 'var(--border)'}`,
                textDecoration: 'none', color: 'inherit',
                transition: 'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-orange)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = it.priority === 'high' ? 'rgba(239,68,68,.4)' : 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: 'var(--night-mid)', border: `2px solid ${meta.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.1rem',
                  fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                }} aria-hidden>{meta.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                    alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 2,
                  }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>
                      {it.priority === 'high' && (
                        <span aria-hidden style={{ color: '#EF4444', marginRight: 4 }}>●</span>
                      )}
                      {it.title}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {timeAgo(it.timestamp)}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-mid)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {it.client_name && (
                      <span style={{ color: 'var(--orange)', fontWeight: 500 }}>{it.client_name}</span>
                    )}
                    {it.description && (
                      <span style={{ color: 'var(--text-muted)' }}>· {it.description}</span>
                    )}
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

function FilterPill({
  active, onClick, emoji, label, count,
}: { active: boolean; onClick: () => void; emoji: string; label: string; count?: number }) {
  const showCount = typeof count === 'number' && count > 0;
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999,
      background: active ? 'rgba(232,105,43,.15)' : 'var(--night-card)',
      border: `1px solid ${active ? 'rgba(232,105,43,.4)' : 'var(--border)'}`,
      color: active ? 'var(--orange)' : 'var(--text-muted)',
      fontSize: '0.76rem', fontWeight: active ? 600 : 500, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span aria-hidden>{emoji}</span>
      {label}
      {showCount && (
        <span style={{
          fontSize: '0.65rem', padding: '1px 7px', borderRadius: 999,
          background: active ? 'rgba(232,105,43,.25)' : 'var(--night-mid)',
          color: active ? 'var(--orange)' : 'var(--text-mid)', fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}
