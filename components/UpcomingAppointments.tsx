'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useCollapsiblePref } from '@/lib/use-collapsible';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  ghl_contact_id: string | null;
  client_id: string | null;
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  opportunity_name: string | null;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  rescheduled_at?: string | null;
  previous_starts_at?: string | null;
  reschedule_count?: number | null;
}

const KIND_META: Record<Appointment['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',    color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding', color: '#14B8A6' },
  tournage:   { emoji: '🎬', label: 'Tournage',   color: '#3B82F6' },
  other:      { emoji: '📅', label: 'RDV',        color: 'var(--text-mid)' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

// Date relative humaine : "Demain", "Mer. 21 mai", "Lun. prochain"…
// Groupage : on regroupe les RDV par jour pour rendre la lecture rapide.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  if (diffDays >= 2 && diffDays <= 6) {
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function UpcomingAppointments() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const { collapsed, toggle } = useCollapsiblePref('bbm_upcoming_appts_collapsed', false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/gh-appointments?upcoming=1&days=14', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setAppts(Array.isArray(d.appointments) ? d.appointments : []);
      }
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filtre côté client : on exclut la journée courante (déjà couverte par
  // TodayAppointments) — l'API renvoie en théorie >= now+1h, on resserre.
  // On exclut aussi les RDV cancelled / no-show (au cas où le filtre status
  // côté supabase ne suffirait pas).
  const visible = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    return appts.filter(a =>
      a.status === 'scheduled'
      && new Date(a.starts_at).getTime() > Date.now()
      && dayKey(a.starts_at) !== todayKey,
    );
  }, [appts]);

  // Group par jour pour pouvoir afficher un séparateur léger "Demain", "Jeu. 22 mai"…
  const grouped = useMemo(() => {
    const out: { label: string; items: Appointment[] }[] = [];
    let currentKey = '';
    for (const a of visible) {
      const k = dayKey(a.starts_at);
      if (k !== currentKey) {
        out.push({ label: dayLabel(a.starts_at), items: [a] });
        currentKey = k;
      } else {
        out[out.length - 1].items.push(a);
      }
    }
    return out;
  }, [visible]);

  if (loading) return null;
  if (visible.length === 0) return null;

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid rgba(20,184,166,.25)',
      padding: '14px 16px', marginBottom: 14,
    }}>
      <div
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📅</span>
          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>
            Prochains RDV
          </span>
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            padding: '1px 8px', borderRadius: 999,
            background: 'rgba(20,184,166,.15)', color: '#14B8A6',
            border: '1px solid rgba(20,184,166,.35)',
          }}>{visible.length}</span>
        </div>
        <span style={{
          fontSize: '0.78rem', color: 'var(--text-muted)',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)',
          transition: 'transform .15s',
        }}>▼</span>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          {grouped.map(group => (
            <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                padding: '0 2px',
              }}>{group.label}</div>
              {group.items.map(a => <UpcomingCard key={a.id} apt={a} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpcomingCard({ apt }: { apt: Appointment }) {
  const meta = KIND_META[apt.calendar_kind];
  return (
    <div style={{
      background: 'var(--night-mid)', borderRadius: 10,
      border: '1px solid var(--border)',
      padding: '10px 12px',
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
    }}>
      <div style={{
        minWidth: 60, textAlign: 'center',
      }}>
        <div style={{
          fontSize: '0.9rem', fontWeight: 700, color: meta.color,
          fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
        }}>{fmtTime(apt.starts_at)}</div>
        <div style={{
          marginTop: 4, fontSize: '0.62rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
        }}>{meta.emoji} {meta.label}</div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {apt.opportunity_name || apt.contact_name || apt.contact_email || '—'}
        </div>
        {(apt.contact_name && apt.opportunity_name && apt.contact_name !== apt.opportunity_name) && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>
            {apt.contact_name}
          </div>
        )}
        {apt.rescheduled_at && apt.previous_starts_at && (
          <div style={{
            marginTop: 3, fontSize: '0.66rem', color: '#FACC15',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            🔄 Reporté{(apt.reschedule_count || 0) > 1 ? ` ×${apt.reschedule_count}` : ''}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {apt.calendar_kind === 'closing' && (
          <Link href={`/dashboard/closing/${apt.id}`} style={{
            padding: '6px 10px', borderRadius: 6,
            background: 'rgba(232,105,43,.12)',
            border: '1px solid rgba(232,105,43,.35)',
            color: 'var(--orange)', fontSize: '0.72rem', fontWeight: 700,
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}>🎯 Closing</Link>
        )}
        {apt.client_id && (
          <Link href={`/dashboard/clients/${apt.client_id}`} style={{
            padding: '6px 10px', borderRadius: 6,
            background: 'transparent',
            border: '1px solid var(--border-md)',
            color: 'var(--text-muted)', fontSize: '0.72rem',
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}>→ Fiche</Link>
        )}
      </div>
    </div>
  );
}
