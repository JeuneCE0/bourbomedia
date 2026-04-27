'use client';

import { useEffect, useState, useCallback } from 'react';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: string;
  starts_at: string;
  contact_name: string | null;
  contact_email: string | null;
  opportunity_name: string | null;
  notes_completed_at: string | null;
}

const KIND_META: Record<Appointment['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',    color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding', color: '#3B82F6' },
  tournage:   { emoji: '🎬', label: 'Tournage',   color: 'var(--green)' },
  other:      { emoji: '📅', label: 'Rendez-vous', color: 'var(--text-mid)' },
};

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  no_show:   { label: 'No show',  bg: 'rgba(239,68,68,.16)',  color: '#FCA5A5' },
  cancelled: { label: 'Annulé',   bg: 'rgba(115,115,115,.16)', color: '#A3A3A3' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function TodayAppointments() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/gh-appointments?today=1', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => setItems(d.appointments || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (items.length === 0) return null;

  const now = Date.now();
  const upcoming = items.filter(a => new Date(a.starts_at).getTime() > now);
  const past = items.filter(a => new Date(a.starts_at).getTime() <= now);

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid rgba(232,105,43,.30)',
      padding: '16px 20px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>🗓️</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Appels d&apos;aujourd&apos;hui</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {upcoming.length} à venir · {past.length} passé{past.length > 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 999,
          background: 'rgba(232,105,43,.16)', border: '1px solid rgba(232,105,43,.45)',
          color: '#FFB58A', fontSize: '0.72rem', fontWeight: 700,
        }}>{items.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(a => {
          const meta = KIND_META[a.calendar_kind];
          const badge = STATUS_BADGE[a.status];
          const isPast = new Date(a.starts_at).getTime() <= now;
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              borderRadius: 8, background: 'var(--night-mid)', border: '1px solid var(--border)',
              opacity: isPast && !badge ? 0.85 : 1,
            }}>
              <span style={{
                fontSize: '0.78rem', fontWeight: 700, color: meta.color, fontFamily: "'Bricolage Grotesque', sans-serif",
                minWidth: 44, textAlign: 'center',
              }}>{formatTime(a.starts_at)}</span>
              <span aria-hidden style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: 'var(--night-raised)', border: `1.5px solid ${meta.color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem',
              }}>{meta.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.opportunity_name || a.contact_name || a.contact_email || 'Sans nom'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {meta.label}{isPast && !badge && a.notes_completed_at ? ' · ✅ documenté' : ''}
                </div>
              </div>
              {badge && (
                <span style={{
                  fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999,
                  background: badge.bg, color: badge.color, fontWeight: 600, whiteSpace: 'nowrap',
                }}>{badge.label}</span>
              )}
              {isPast && !badge && !a.notes_completed_at && (
                <span style={{
                  fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999,
                  background: 'rgba(168,85,247,.16)', color: '#D8B4FE',
                  border: '1px solid rgba(168,85,247,.45)', fontWeight: 600, whiteSpace: 'nowrap',
                }}>À documenter</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
