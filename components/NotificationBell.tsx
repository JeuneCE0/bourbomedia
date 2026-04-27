'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';

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

const KIND_META: Record<InboxItem['kind'], { emoji: string; color: string }> = {
  script:         { emoji: '📝', color: '#FACC15' },
  video_feedback: { emoji: '🎬', color: '#3B82F6' },
  appointment:    { emoji: '📅', color: 'var(--orange)' },
  payment:        { emoji: '💸', color: 'var(--green)' },
  task:           { emoji: '✅', color: '#8B5CF6' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function NotificationBell() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/inbox', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setItems(Array.isArray(d.items) ? d.items : []);
        setCounts(d.counts || null);
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const total = counts?.total || 0;
  const high = counts?.high || 0;

  const visible = useMemo(() => items.slice(0, 12), [items]);

  return (
    <div ref={wrapRef} style={{
      position: 'fixed', top: 14, right: 16, zIndex: 90,
    }}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) load(); }}
        aria-label={`${total} notification${total > 1 ? 's' : ''}`}
        style={{
          position: 'relative', width: 40, height: 40, borderRadius: 999,
          background: 'var(--night-card)', border: '1px solid var(--border)',
          color: 'var(--text)', cursor: 'pointer', fontSize: '1.05rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,.15)',
          transition: 'all .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-orange)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        <span aria-hidden style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>🔔</span>
        {total > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 999, background: high > 0 ? '#EF4444' : 'var(--orange)',
            color: '#fff', fontSize: '0.65rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--night)', lineHeight: 1,
          }}>{total > 99 ? '99+' : total}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 50, right: 0, width: 'min(380px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          background: 'var(--night-card)', borderRadius: 12,
          border: '1px solid var(--border-md)',
          boxShadow: '0 10px 40px rgba(0,0,0,.5)', zIndex: 91,
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'sticky', top: 0, background: 'var(--night-card)', zIndex: 1,
          }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text)' }}>
              📥 Inbox
              {total > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999,
                  background: high > 0 ? 'rgba(239,68,68,.15)' : 'var(--night-mid)',
                  color: high > 0 ? '#EF4444' : 'var(--text-muted)', fontWeight: 700,
                }}>{total}</span>
              )}
            </span>
            <button onClick={() => setOpen(false)} style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '0.95rem', padding: 4,
            }} aria-label="Fermer">✕</button>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>🎉</div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-mid)' }}>
                Inbox zéro
              </div>
              <div style={{ fontSize: '0.74rem', marginTop: 2 }}>Rien à traiter !</div>
            </div>
          ) : (
            <div style={{ padding: 6 }}>
              {visible.map(it => {
                const meta = KIND_META[it.kind];
                return (
                  <Link key={it.id} href={it.href} onClick={() => setOpen(false)} style={{
                    display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8,
                    textDecoration: 'none', color: 'inherit', transition: 'background .12s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: 'var(--night-mid)', border: `2px solid ${meta.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.9rem',
                      fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                    }} aria-hidden>{meta.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', gap: 8,
                        alignItems: 'baseline',
                      }}>
                        <span style={{
                          fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          flex: 1, minWidth: 0,
                        }}>
                          {it.priority === 'high' && <span aria-hidden style={{ color: '#EF4444', marginRight: 4 }}>●</span>}
                          {it.title}
                        </span>
                        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {timeAgo(it.timestamp)}
                        </span>
                      </div>
                      {(it.client_name || it.description) && (
                        <div style={{
                          fontSize: '0.72rem', color: 'var(--text-mid)', marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {it.client_name && <span style={{ color: 'var(--orange)' }}>{it.client_name}</span>}
                          {it.client_name && it.description && ' · '}
                          {it.description}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
              {items.length > visible.length && (
                <Link href="/dashboard/inbox" onClick={() => setOpen(false)} style={{
                  display: 'block', textAlign: 'center', padding: '10px',
                  fontSize: '0.76rem', color: 'var(--orange)', textDecoration: 'none',
                  borderTop: '1px solid var(--border)', fontWeight: 600,
                }}>Voir tout ({items.length})</Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
