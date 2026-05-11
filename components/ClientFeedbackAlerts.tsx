'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';
import { useCollapsiblePref } from '@/lib/use-collapsible';

interface Alert {
  kind: 'global_changes' | 'annotations';
  client_id: string;
  business_name: string;
  contact_name: string | null;
  timestamp: string;
  href: string;
  comment?: string | null;
  annotations_count?: number;
  annotations_preview?: { time: number; text: string }[];
  video_title?: string | null;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days < 7) return `il y a ${days}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtTimecode(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function ClientFeedbackAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const { collapsed, toggle } = useCollapsiblePref('bbm_feedback_alerts_collapsed', false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/client-video-feedback', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setAlerts(Array.isArray(d.alerts) ? d.alerts : []);
      }
    } catch { /* tolerate */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibilityAwarePolling(load, 15_000);

  if (loading || alerts.length === 0) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(249,115,22,.12), rgba(232,105,43,.06))',
      border: '1px solid rgba(249,115,22,.45)',
      borderRadius: 14,
      padding: '14px 16px',
      marginBottom: 14,
      boxShadow: '0 4px 18px rgba(249,115,22,.10)',
    }}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: collapsed ? 0 : 12, padding: 0, flexWrap: 'wrap',
          background: 'transparent', border: 'none', color: 'inherit',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span aria-hidden style={{ fontSize: '1.3rem' }}>✏️</span>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#FFB58A', fontFamily: "'Bricolage Grotesque', sans-serif" }}>
            Retours clients à traiter ({alerts.length})
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Modifications demandées sur des vidéos livrées
          </div>
        </div>
        <span aria-hidden style={{
          display: 'inline-block', fontSize: 11, color: 'var(--text-muted)',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform .2s ease',
        }}>▼</span>
      </button>

      {!collapsed && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {alerts.map((a, i) => (
          <Link
            key={`${a.kind}-${a.client_id}-${i}`}
            href={a.href}
            style={{
              display: 'block',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--night-card)',
              border: '1px solid rgba(249,115,22,.30)',
              textDecoration: 'none',
              transition: 'transform .12s ease, border-color .12s ease',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
              marginBottom: a.comment || a.annotations_preview?.length ? 6 : 0,
            }}>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>
                {a.business_name}
              </span>
              {a.contact_name && (
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  · {a.contact_name}
                </span>
              )}
              <span style={{
                marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}>{relativeTime(a.timestamp)}</span>
            </div>

            {a.kind === 'global_changes' && a.comment && (
              <div style={{
                padding: '8px 10px', borderRadius: 6,
                background: 'rgba(249,115,22,.06)',
                borderLeft: '2px solid #F97316',
                fontSize: '0.78rem', color: 'var(--text-mid)',
                lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                marginTop: 4,
              }}>
                « {a.comment.length > 280 ? a.comment.slice(0, 280) + '…' : a.comment} »
              </div>
            )}

            {a.kind === 'global_changes' && !a.comment && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-mid)', fontStyle: 'italic' }}>
                Modifications demandées sans commentaire — ouvrir la fiche pour détails.
              </div>
            )}

            {a.kind === 'annotations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: '0.74rem', color: '#FFB58A', fontWeight: 600 }}>
                  📌 {a.annotations_count} annotation{(a.annotations_count || 0) > 1 ? 's' : ''} sur {a.video_title || 'la vidéo livrée'}
                </div>
                {(a.annotations_preview || []).map((p, j) => (
                  <div key={j} style={{
                    fontSize: '0.74rem', color: 'var(--text-mid)',
                    padding: '4px 8px', borderRadius: 4,
                    background: 'rgba(249,115,22,.04)',
                    lineHeight: 1.4,
                  }}>
                    <span style={{ color: '#FFB58A', fontWeight: 600, fontFamily: 'monospace' }}>
                      {fmtTimecode(p.time)}
                    </span>{' '}
                    {p.text.length > 140 ? p.text.slice(0, 140) + '…' : p.text}
                  </div>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
      )}
    </div>
  );
}
