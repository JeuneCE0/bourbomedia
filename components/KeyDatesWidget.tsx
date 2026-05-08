'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';

interface KeyDateItem {
  kind: 'closing_call' | 'onboarding_call' | 'tournage' | 'delivery_eta' | 'publication';
  label: string;
  emoji: string;
  color: string;
  date: string;
  client_id: string | null;
  client_name: string;
  contact_name: string | null;
  href: string;
  extra?: string;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

// Groupe : aujourd'hui | demain | cette semaine | plus tard.
type Bucket = 'today' | 'tomorrow' | 'week' | 'later';

function bucketOf(iso: string): Bucket {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfterTomorrow = new Date(startTomorrow); startDayAfterTomorrow.setDate(startDayAfterTomorrow.getDate() + 1);
  const startNextWeek = new Date(startToday); startNextWeek.setDate(startNextWeek.getDate() + 7);

  const t = d.getTime();
  if (t < startTomorrow.getTime()) return 'today';
  if (t < startDayAfterTomorrow.getTime()) return 'tomorrow';
  if (t < startNextWeek.getTime()) return 'week';
  return 'later';
}

const BUCKET_META: Record<Bucket, { label: string; color: string }> = {
  today:    { label: "Aujourd'hui",     color: 'var(--orange)' },
  tomorrow: { label: 'Demain',          color: '#FACC15' },
  week:     { label: 'Cette semaine',   color: '#14B8A6' },
  later:    { label: 'Les semaines à venir', color: 'var(--text-muted)' },
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function KeyDatesWidget() {
  const [items, setItems] = useState<KeyDateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Persist état collapsed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('bbm_keydates_collapsed');
      if (saved === '1') setCollapsed(true);
    } catch { /* */ }
  }, []);
  function toggle() {
    setCollapsed(v => {
      const next = !v;
      try { window.localStorage.setItem('bbm_keydates_collapsed', next ? '1' : '0'); } catch { /* */ }
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/key-dates?days=14', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setItems(Array.isArray(d.items) ? d.items : []);
      }
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibilityAwarePolling(load, 60_000);

  if (loading) return null;
  if (items.length === 0) return null;

  // Group par bucket
  const groups: Record<Bucket, KeyDateItem[]> = { today: [], tomorrow: [], week: [], later: [] };
  for (const it of items) groups[bucketOf(it.date)].push(it);
  const buckets: Bucket[] = ['today', 'tomorrow', 'week', 'later'];
  const todayCount = groups.today.length;

  return (
    <div style={{
      background: 'var(--night-card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '14px 16px',
      marginBottom: 14,
    }}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: 0, background: 'transparent', border: 'none',
          color: 'inherit', cursor: 'pointer', fontFamily: 'inherit',
          marginBottom: collapsed ? 0 : 12,
        }}
      >
        <span aria-hidden style={{ fontSize: '1.2rem' }}>📌</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{
            fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)',
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}>
            Échéances clés ({items.length})
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Tournages, onboarding, montages, publications — 14 prochains jours
            {todayCount > 0 && <span style={{ color: 'var(--orange)', fontWeight: 700 }}> · {todayCount} aujourd&apos;hui</span>}
          </div>
        </div>
        <span aria-hidden style={{
          display: 'inline-block', fontSize: 11, color: 'var(--text-muted)',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform .2s ease',
        }}>▼</span>
      </button>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {buckets.map(bucket => {
            const list = groups[bucket];
            if (list.length === 0) return null;
            const bMeta = BUCKET_META[bucket];
            return (
              <div key={bucket}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                  fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: bMeta.color, fontWeight: 700,
                }}>
                  <span>{bMeta.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {list.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {list.map((it, i) => (
                    <Link
                      key={`${it.kind}-${it.client_id || 'na'}-${it.date}-${i}`}
                      href={it.href}
                      style={{
                        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                        gap: 10, alignItems: 'center',
                        padding: '8px 10px', borderRadius: 8,
                        background: 'var(--night-mid)', border: '1px solid var(--border)',
                        textDecoration: 'none', color: 'inherit',
                        transition: 'transform .08s ease, border-color .12s ease',
                      }}
                    >
                      <span aria-hidden style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: `${it.color}22`, border: `1px solid ${it.color}66`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, flexShrink: 0,
                        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                      }}>{it.emoji}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
                            {it.client_name}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: it.color, fontWeight: 600 }}>
                            {it.label}
                          </span>
                        </div>
                        <div style={{
                          fontSize: '0.7rem', color: 'var(--text-muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {it.contact_name && <span>{it.contact_name}</span>}
                          {it.extra && <span>{it.contact_name ? ' · ' : ''}{it.extra}</span>}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.74rem', color: 'var(--text)',
                        fontWeight: 600, whiteSpace: 'nowrap',
                      }}>{fmtDateTime(it.date)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
