'use client';

import { useEffect, useState, useCallback } from 'react';

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
  opportunity_name: string | null;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
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

const PROSPECT_STATUS_OPTIONS: { value: string; label: string; emoji: string; followUpDays?: number }[] = [
  { value: 'reflection',          label: 'En réflexion',                 emoji: '🤔', followUpDays: 2 },
  { value: 'follow_up',           label: 'Follow-up',                    emoji: '🔁', followUpDays: 7 },
  { value: 'ghosting',            label: 'Ghosting',                     emoji: '👻' },
  { value: 'awaiting_signature',  label: 'Attente signature + paiement', emoji: '✍️' },
  { value: 'contracted',          label: 'Contracté',                    emoji: '🤝' },
  { value: 'regular',             label: 'Client régulier',              emoji: '⭐' },
  { value: 'not_interested',      label: 'Pas intéressé',                emoji: '🚫' },
  { value: 'closed_lost',         label: 'Perdu',                        emoji: '❌' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function TodayAppointments() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

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
              {upcoming.length} à venir · {past.length} passé{past.length > 1 ? 's' : ''} · clic pour documenter
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
        {items.map(a => (
          <TodayRow
            key={a.id}
            appt={a}
            now={now}
            open={openId === a.id}
            onToggle={() => setOpenId(openId === a.id ? null : a.id)}
            onSaved={() => { setOpenId(null); load(); }}
          />
        ))}
      </div>
    </div>
  );
}

function TodayRow({ appt, now, open, onToggle, onSaved }: {
  appt: Appointment;
  now: number;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const meta = KIND_META[appt.calendar_kind];
  const badge = STATUS_BADGE[appt.status];
  const isPast = new Date(appt.starts_at).getTime() <= now;
  const documented = !!appt.notes_completed_at;

  const [notes, setNotes] = useState(appt.notes || '');
  const [status, setStatus] = useState<string>(appt.prospect_status || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!notes.trim()) {
      alert('Ajoute au moins quelques notes avant d\'enregistrer.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/gh-appointments', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ id: appt.id, notes: notes.trim(), prospect_status: status || null }),
      });
      if (r.ok) onSaved();
      else alert('Erreur lors de l\'enregistrement.');
    } finally { setSaving(false); }
  }

  return (
    <div style={{
      borderRadius: 8, background: 'var(--night-mid)', border: '1px solid var(--border)',
      overflow: 'hidden', opacity: isPast && !badge && documented ? 0.75 : 1,
    }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', background: 'transparent', border: 'none',
          padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
          color: 'var(--text)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <span style={{
          fontSize: '0.78rem', fontWeight: 700, color: meta.color,
          fontFamily: "'Bricolage Grotesque', sans-serif",
          minWidth: 44, textAlign: 'center',
        }}>{formatTime(appt.starts_at)}</span>
        <span aria-hidden style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: 'var(--night-raised)', border: `1.5px solid ${meta.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem',
        }}>{meta.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.84rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {appt.opportunity_name || appt.contact_name || appt.contact_email || 'Sans nom'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {meta.label}{isPast && !badge && documented ? ' · ✅ documenté' : ''}
          </div>
        </div>
        {badge && (
          <span style={{
            fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999,
            background: badge.bg, color: badge.color, fontWeight: 600, whiteSpace: 'nowrap',
          }}>{badge.label}</span>
        )}
        {isPast && !badge && !documented && (
          <span style={{
            fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999,
            background: 'rgba(168,85,247,.16)', color: '#D8B4FE',
            border: '1px solid rgba(168,85,247,.45)', fontWeight: 600, whiteSpace: 'nowrap',
          }}>{open ? 'Fermer' : '✏️ À documenter'}</span>
        )}
        {(badge || (isPast && documented)) && (
          <span style={{
            fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border-md)', fontWeight: 600, whiteSpace: 'nowrap',
          }}>{open ? 'Fermer' : '✏️ Modifier'}</span>
        )}
        {!isPast && !badge && (
          <span style={{
            fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border-md)', fontWeight: 600, whiteSpace: 'nowrap',
          }}>{open ? 'Fermer' : '✏️ Pré-remplir'}</span>
        )}
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Statut prospect
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PROSPECT_STATUS_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setStatus(opt.value)} style={{
                  padding: '5px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                  background: status === opt.value ? 'var(--orange)' : 'var(--night-raised)',
                  color: status === opt.value ? '#fff' : 'var(--text-mid)',
                  border: `1px solid ${status === opt.value ? 'var(--orange)' : 'var(--border-md)'}`,
                  cursor: 'pointer', transition: 'all .15s',
                }}>
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Notes de l&apos;appel
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Compte-rendu, prochaines étapes, objections, budget..."
              rows={4}
              autoFocus
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                background: 'var(--night-raised)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.85rem', resize: 'vertical', outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
              {appt.ghl_contact_id ? '🔁 Sync auto vers GHL au save' : '⚠️ Contact GHL non lié'}
            </span>
            <button onClick={save} disabled={saving} style={{
              padding: '7px 14px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
              opacity: saving ? 0.5 : 1,
            }}>
              {saving ? '⏳' : '💾'} Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
