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
  clients: {
    business_name?: string;
    contact_name?: string;
    // Source de vérité pour les vraies dates de RDV — on les préfère à
    // metadata.date qui peut contenir l'instant du clic sur le bouton
    // de fallback portail (incident Théo de Glaces Pépé 2026-05-18).
    onboarding_call_date?: string | null;
    filming_date?: string | null;
    publication_date?: string | null;
    payment_amount?: number | null;
  } | null;
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
  const [collapsed, setCollapsed] = useState(true);

  // Persist préférence collapse en localStorage. Default collapsed
  // pour ne pas bouffer la page au load.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('bbm_activity_collapsed');
      if (saved === '0') setCollapsed(false);
    } catch { /* */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v;
      try { window.localStorage.setItem('bbm_activity_collapsed', next ? '1' : '0'); } catch { /* */ }
      return next;
    });
  }

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
      <button
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: 0, background: 'transparent', border: 'none',
          color: 'inherit', cursor: 'pointer', fontFamily: 'inherit',
          marginBottom: collapsed ? 0 : 12,
        }}
      >
        <span aria-hidden style={{ fontSize: '1.1rem' }}>⚡</span>
        <h3 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '0.95rem', color: 'var(--text)', margin: 0, textAlign: 'left',
        }}>
          Activité client en direct
        </h3>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          ({events.length})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {collapsed ? 'Afficher' : 'Masquer'}
          <span aria-hidden style={{
            display: 'inline-block', fontSize: 10,
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform .2s ease',
          }}>▼</span>
        </span>
      </button>

      {!collapsed && (
        <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map((e, i) => {
          const meta = EVENT_META[e.event] || { emoji: '🔹', verb: e.event, color: 'var(--text-muted)' };
          // Identifie l'acteur : si on a une fiche client liée on utilise
          // son nom commercial. Sinon on tombe sur la source du funnel
          // event : 'admin' = action admin, 'portal'/'onboarding'/'webhook'
          // = action client (souvent un visiteur anonyme avant signup).
          // Évite l'affichage "— a visité l'onboarding" qui ne dit rien.
          const businessName = e.clients?.business_name
            || (e.source === 'admin' ? 'Admin' : 'Client');
          const contactName = e.clients?.contact_name || '';

          // Détermine la VRAIE date du RDV selon l'event — on privilégie
          // toujours la donnée à jour côté fiche client (clients.*) sur le
          // metadata stocké au moment du tracking (qui peut être faux,
          // ex. portail manuel avec date=instant du clic).
          let canonicalDate: string | null = null;
          if (e.event === 'call_booked') canonicalDate = e.clients?.onboarding_call_date || (e.metadata?.date as string | undefined) || null;
          else if (e.event === 'filming_booked') canonicalDate = e.clients?.filming_date || (e.metadata?.date as string | undefined) || null;
          else if (e.event === 'publication_booked') canonicalDate = e.clients?.publication_date || (e.metadata?.date as string | undefined) || null;
          else canonicalDate = (e.metadata?.date as string | undefined)
            || (e.metadata?.appointment_date as string | undefined)
            || (e.metadata?.starts_at as string | undefined)
            || null;
          let dateLabel = '';
          if (canonicalDate) {
            const d = new Date(canonicalDate);
            if (!Number.isNaN(d.getTime())) {
              const today = new Date();
              const sameYear = d.getFullYear() === today.getFullYear();
              // Pour les events booking, l'heure est l'info la plus actionnable.
              // Pour publication_booked, c'est plutôt la date seule (pas d'heure).
              const showTime = e.event !== 'publication_booked';
              dateLabel = d.toLocaleDateString('fr-FR', {
                weekday: 'short', day: 'numeric', month: 'short',
                ...(sameYear ? {} : { year: 'numeric' }),
                ...(showTime ? { hour: '2-digit', minute: '2-digit' } : {}),
              });
            }
          }

          // Montant pour les events liés au paiement. amount_cents est
          // stocké en metadata par le webhook Stripe + portail verify_payment ;
          // payment_amount sur la fiche client sert de fallback pour les
          // legacy events où metadata était null.
          let amountLabel = '';
          if (e.event === 'payment_completed') {
            const cents = (e.metadata?.amount_cents as number | undefined)
              ?? e.clients?.payment_amount
              ?? null;
            if (typeof cents === 'number' && cents > 0) {
              amountLabel = `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
            }
          }
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
                {(contactName || dateLabel || amountLabel) && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {contactName}
                    {contactName && (dateLabel || amountLabel) && ' · '}
                    {dateLabel && <span style={{ color: 'var(--orange)' }}>📅 {dateLabel}</span>}
                    {dateLabel && amountLabel && ' · '}
                    {amountLabel && <span style={{ color: 'var(--green)', fontWeight: 700 }}>💶 {amountLabel}</span>}
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
        </>
      )}
    </div>
  );
}
