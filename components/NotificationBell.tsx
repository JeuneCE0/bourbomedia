'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';

// Read-state + Snooze stored locally per device (inbox items are computed,
// not persisted). Read entries aged out after 30 days. Snooze entries cleared
// once their timestamp is in the past.
const READ_KEY = 'bbp_inbox_read_v1';
const SNOOZE_KEY = 'bbp_inbox_snooze_v1';
type ReadMap = Record<string, number>; // item.id → timestamp ms (when read)
type SnoozeMap = Record<string, number>; // item.id → snooze_until ms

function loadRead(): ReadMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReadMap;
    const cutoff = Date.now() - 30 * 86400_000;
    const fresh: ReadMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v >= cutoff) fresh[k] = v;
    }
    return fresh;
  } catch { return {}; }
}

function saveRead(m: ReadMap) {
  try { localStorage.setItem(READ_KEY, JSON.stringify(m)); } catch { /* */ }
}

function loadSnooze(): SnoozeMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SnoozeMap;
    const now = Date.now();
    const fresh: SnoozeMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v > now) fresh[k] = v; // garde uniquement les snooze encore actifs
    }
    return fresh;
  } catch { return {}; }
}

function saveSnooze(m: SnoozeMap) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* */ }
}

function snoozeOptions(): { label: string; ms: number; emoji: string }[] {
  const now = new Date();
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(now.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);
  const monday = new Date(now);
  const dow = monday.getDay();
  const daysToMonday = dow === 0 ? 1 : (8 - dow);
  monday.setDate(now.getDate() + daysToMonday);
  monday.setHours(8, 0, 0, 0);
  return [
    { label: '1h', emoji: '⏱️', ms: now.getTime() + 60 * 60 * 1000 },
    { label: '3h', emoji: '⏱️', ms: now.getTime() + 3 * 60 * 60 * 1000 },
    { label: 'Demain 8h', emoji: '🌅', ms: tomorrowMorning.getTime() },
    { label: 'Lundi 8h', emoji: '📅', ms: monday.getTime() },
  ];
}

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
  const [readMap, setReadMap] = useState<ReadMap>(() => loadRead());
  const [snoozeMap, setSnoozeMap] = useState<SnoozeMap>(() => loadSnooze());
  const [snoozePickerForId, setSnoozePickerForId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Tick toutes les minutes pour rafraîchir l'état snooze (item ressort du
  // dropdown automatiquement quand son délai expire)
  useEffect(() => {
    const t = setInterval(() => setSnoozeMap(loadSnooze()), 60_000);
    return () => clearInterval(t);
  }, []);

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

  // Poll 60s avec skip si onglet hidden + refresh instantané au focus retour.
  useVisibilityAwarePolling(load, 60_000);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function markRead(id: string) {
    const next = { ...readMap, [id]: Date.now() };
    setReadMap(next);
    saveRead(next);
  }
  function markAllRead() {
    const next = { ...readMap };
    for (const it of items) {
      if (!isSnoozed(it.id)) next[it.id] = Date.now();
    }
    setReadMap(next);
    saveRead(next);
  }
  function isRead(id: string): boolean { return id in readMap; }
  function isSnoozed(id: string): boolean { return (snoozeMap[id] || 0) > Date.now(); }

  function snoozeItem(id: string, untilMs: number) {
    const next = { ...snoozeMap, [id]: untilMs };
    setSnoozeMap(next);
    saveSnooze(next);
    setSnoozePickerForId(null);
  }

  // Filter : exclu read + exclu snoozed → ce qui s'affiche réellement comme
  // "à traiter" dans le badge + le dropdown.
  const activeItems = useMemo(
    () => items.filter(it => !isRead(it.id) && !isSnoozed(it.id)),
    [items, readMap, snoozeMap],
  );
  const total = activeItems.length;
  const high = activeItems.filter(it => it.priority === 'high').length;

  // Visible dans le dropdown : on montre tous (lus, snoozed inclus en bas) jusqu'à 20
  const visible = useMemo(() => {
    const active = items.filter(it => !isRead(it.id) && !isSnoozed(it.id));
    const snoozed = items.filter(it => isSnoozed(it.id));
    const read = items.filter(it => isRead(it.id) && !isSnoozed(it.id));
    return [...active, ...snoozed, ...read].slice(0, 20);
  }, [items, readMap, snoozeMap]);

  return (
    <div ref={wrapRef} style={{
      position: 'fixed',
      top: 'max(14px, calc(env(safe-area-inset-top, 0px) + 8px))',
      right: 'max(16px, env(safe-area-inset-right))',
      zIndex: 90,
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
            position: 'sticky', top: 0, background: 'var(--night-card)', zIndex: 1, gap: 8,
          }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text)' }}>
              📥 Inbox
              {total > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999,
                  background: high > 0 ? 'rgba(239,68,68,.15)' : 'var(--night-mid)',
                  color: high > 0 ? '#EF4444' : 'var(--text-muted)', fontWeight: 700,
                }}>{total} non lu{total > 1 ? 's' : ''}</span>
              )}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {total > 0 && (
                <button onClick={markAllRead} title="Tout marquer comme lu" style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                  padding: '4px 8px', borderRadius: 6,
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-mid)'; e.currentTarget.style.color = 'var(--orange)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >✓ Tout lu</button>
              )}
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.95rem', padding: 4,
              }} aria-label="Fermer">✕</button>
            </div>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>🎉</div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-mid)' }}>
                Inbox zéro
              </div>
              <div style={{ fontSize: '0.74rem', marginTop: 2 }}>Rien à traiter !</div>
            </div>
          ) : total === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>✨</div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-mid)' }}>
                Tout est lu
              </div>
              <div style={{ fontSize: '0.74rem', marginTop: 2 }}>{items.length} item{items.length > 1 ? 's' : ''} restants en historique</div>
            </div>
          ) : (
            <div style={{ padding: 6 }}>
              {visible.map(it => {
                const meta = KIND_META[it.kind];
                const read = isRead(it.id);
                const snoozed = isSnoozed(it.id);
                const snoozedUntil = snoozed ? new Date(snoozeMap[it.id]) : null;
                return (
                  <div key={it.id} style={{ position: 'relative' }}>
                    <div style={{
                      display: 'flex', gap: 4, padding: '4px 4px',
                      borderRadius: 8, transition: 'background .12s',
                      opacity: snoozed ? 0.5 : (read ? 0.55 : 1),
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Link href={it.href}
                        onClick={() => { markRead(it.id); setOpen(false); }}
                        style={{
                          flex: 1, minWidth: 0, display: 'flex', gap: 10, padding: '6px 8px',
                          textDecoration: 'none', color: 'inherit',
                        }}
                      >
                        <div style={{
                          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                          background: 'var(--night-mid)', border: `2px solid ${meta.color}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.9rem',
                          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                        }} aria-hidden>{snoozed ? '😴' : meta.emoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex', justifyContent: 'space-between', gap: 8,
                            alignItems: 'baseline',
                          }}>
                            <span style={{
                              fontSize: '0.8rem', fontWeight: read || snoozed ? 500 : 600,
                              color: read || snoozed ? 'var(--text-mid)' : 'var(--text)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              flex: 1, minWidth: 0,
                              textDecoration: read ? 'line-through' : 'none',
                            }}>
                              {!read && !snoozed && it.priority === 'high' && <span aria-hidden style={{ color: '#EF4444', marginRight: 4 }}>●</span>}
                              {it.title}
                            </span>
                            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                              {snoozedUntil
                                ? `→ ${snoozedUntil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                                : timeAgo(it.timestamp)}
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
                      {!read && !snoozed && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSnoozePickerForId(snoozePickerForId === it.id ? null : it.id); }}
                            title="Snoozer"
                            aria-label="Snoozer"
                            style={{
                              flexShrink: 0, width: 24, height: 24, borderRadius: 6,
                              background: 'transparent', border: 'none', color: 'var(--text-muted)',
                              cursor: 'pointer', fontSize: '0.85rem',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              alignSelf: 'center',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-raised)'; e.currentTarget.style.color = '#A855F7'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                          >😴</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); markRead(it.id); }}
                            title="Marquer comme lu"
                            aria-label="Marquer comme lu"
                            style={{
                              flexShrink: 0, width: 24, height: 24, borderRadius: 6,
                              background: 'transparent', border: 'none', color: 'var(--text-muted)',
                              cursor: 'pointer', fontSize: '0.75rem',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              alignSelf: 'center',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-raised)'; e.currentTarget.style.color = 'var(--green)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                          >✓</button>
                        </>
                      )}
                      {snoozed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = { ...snoozeMap };
                            delete next[it.id];
                            setSnoozeMap(next);
                            saveSnooze(next);
                          }}
                          title="Réveiller (annuler le snooze)"
                          style={{
                            flexShrink: 0, width: 24, height: 24, borderRadius: 6,
                            background: 'transparent', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', fontSize: '0.85rem',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
                          }}
                        >⏰</button>
                      )}
                    </div>

                    {/* Snooze picker pop */}
                    {snoozePickerForId === it.id && (
                      <div style={{
                        position: 'absolute', top: '100%', right: 30, zIndex: 5,
                        marginTop: 2, padding: 6, borderRadius: 10,
                        background: 'var(--night-raised)', border: '1px solid var(--border-md)',
                        boxShadow: '0 6px 20px rgba(0,0,0,.5)',
                        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130,
                      }}>
                        {snoozeOptions().map(opt => (
                          <button key={opt.label}
                            onClick={() => snoozeItem(it.id, opt.ms)}
                            style={{
                              padding: '7px 10px', borderRadius: 6, border: 'none',
                              background: 'transparent', color: 'var(--text)',
                              fontSize: '0.78rem', textAlign: 'left', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span aria-hidden>{opt.emoji}</span> {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
