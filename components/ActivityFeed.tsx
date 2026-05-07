'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';

interface FeedEvent {
  event: string;
  source: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  client_id: string | null;
  client_token_prefix: string | null;
  clients: { business_name?: string; contact_name?: string } | null;
}

const EVENT_META: Record<string, { emoji: string; verb: string; color: string }> = {
  onboarding_landed:        { emoji: '👋', verb: 'a visité l\'onboarding',           color: 'var(--text-muted)' },
  signup_completed:         { emoji: '📝', verb: 'vient de s\'inscrire',             color: '#8A7060' },
  contract_signed:          { emoji: '✍️', verb: 'a signé son contrat',              color: '#F28C55' },
  payment_completed:        { emoji: '💳', verb: 'a payé son acompte',               color: '#FACC15' },
  call_booked:              { emoji: '📞', verb: 'a réservé son appel onboarding',   color: '#14B8A6' },
  script_proposed:          { emoji: '📜', verb: 'a reçu son script',                color: '#FACC15' },
  script_changes_requested: { emoji: '🖍️', verb: 'a demandé des modifs sur le script', color: '#F97316' },
  script_validated:         { emoji: '✅', verb: 'a validé son script',              color: '#22C55E' },
  filming_booked:           { emoji: '🎬', verb: 'a réservé son tournage',           color: '#3B82F6' },
  video_delivered:          { emoji: '📹', verb: 'a reçu sa vidéo',                  color: '#8B5CF6' },
  video_validated:          { emoji: '👍', verb: 'a validé sa vidéo',                color: '#22C55E' },
  video_changes_requested:  { emoji: '✏️', verb: 'a demandé des modifs sur le montage', color: '#F97316' },
  publication_booked:       { emoji: '🗓️', verb: 'a choisi sa date de publication', color: '#FB923C' },
  project_published:        { emoji: '🎉', verb: 'a sa vidéo en ligne',              color: 'var(--green)' },
};

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

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function ActivityFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/funnel-recent?limit=15', { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) setEvents(data);
      }
    } catch { /* tolerate */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibilityAwarePolling(load, 30_000);

  if (loading || events.length === 0) {
    // Pas de skeleton agressif — feed est secondaire, on cache si vide
    // pour ne pas polluer le dashboard avec un état "Aucune activité"
    // qui n'apporte aucune info actionable.
    return null;
  }

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid rgba(232,105,43,.20)',
      padding: '14px 16px', marginBottom: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
      }}>
        <span aria-hidden style={{ fontSize: '1.1rem' }}>⚡</span>
        <h3 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '0.95rem', color: 'var(--text)', margin: 0,
        }}>
          Activité client en direct
        </h3>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          rafraîchi auto
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map((e, i) => {
          const meta = EVENT_META[e.event] || { emoji: '🔹', verb: e.event, color: 'var(--text-muted)' };
          const businessName = e.clients?.business_name || '—';
          const contactName = e.clients?.contact_name || '';
          const inner = (
            <div style={{
              display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10, alignItems: 'center',
              padding: '6px 8px', borderRadius: 6,
              background: i === 0 ? 'rgba(232,105,43,.06)' : 'transparent',
              transition: 'background .15s',
            }}>
              <span aria-hidden style={{
                fontSize: 14, width: 26, height: 26, borderRadius: '50%',
                background: `${meta.color}25`, border: `1px solid ${meta.color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
              }}>{meta.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong>{businessName}</strong>
                  <span style={{ color: 'var(--text-mid)' }}> {meta.verb}</span>
                </div>
                {contactName && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {contactName}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {relativeTime(e.created_at)}
              </span>
            </div>
          );
          if (e.client_id) {
            return (
              <Link
                key={`${e.event}-${e.created_at}`}
                href={`/dashboard/clients/${e.client_id}?tab=journey`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {inner}
              </Link>
            );
          }
          return <div key={`${e.event}-${e.created_at}-${i}`}>{inner}</div>;
        })}
      </div>

      <Link
        href="/dashboard/funnel"
        style={{
          display: 'block', marginTop: 10, textAlign: 'center',
          fontSize: '0.74rem', color: 'var(--orange)',
          textDecoration: 'none', fontWeight: 600,
        }}
      >
        Voir le funnel complet →
      </Link>
    </div>
  );
}
