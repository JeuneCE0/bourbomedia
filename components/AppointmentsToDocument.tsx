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
  client_id: string | null;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  ghl_synced_at: string | null;
}

const KIND_META: Record<Appointment['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',    color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding', color: '#3B82F6' },
  tournage:   { emoji: '🎬', label: 'Tournage',   color: 'var(--green)' },
  other:      { emoji: '📅', label: 'Rendez-vous', color: 'var(--text-mid)' },
};

const STATUS_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'interested',     label: 'Intéressé',          emoji: '👀' },
  { value: 'to_follow_up',   label: 'À relancer',         emoji: '🔁' },
  { value: 'closed_won',     label: 'Closé gagné',        emoji: '🏆' },
  { value: 'closed_lost',    label: 'Closé perdu',        emoji: '❌' },
  { value: 'not_interested', label: 'Pas intéressé',      emoji: '🚫' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AppointmentsToDocument() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/gh-appointments?pending=1', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => setItems(d.appointments || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{
        background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
        padding: '16px 20px', marginBottom: 14, opacity: 0.7,
      }}>
        <div style={{ height: 60, background: 'var(--night-mid)', borderRadius: 8 }} />
      </div>
    );
  }

  const isEmpty = items.length === 0;

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: `1px solid ${isEmpty ? 'var(--border)' : 'rgba(168,85,247,.30)'}`,
      padding: '16px 20px', marginBottom: 14,
      opacity: isEmpty ? 0.7 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: isEmpty ? 4 : 12, gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📞</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Appels à documenter</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Renseigner le statut + les notes après chaque appel
            </div>
          </div>
        </div>
        {!isEmpty && (
          <span style={{
            padding: '3px 10px', borderRadius: 999,
            background: 'rgba(168,85,247,.16)', border: '1px solid rgba(168,85,247,.45)',
            color: '#D8B4FE', fontSize: '0.72rem', fontWeight: 700,
          }}>{items.length}</span>
        )}
      </div>

      {isEmpty ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: 30 }}>
          Tous les appels sont à jour. ✨
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.slice(0, 8).map(a => (
            <AppointmentRow
              key={a.id}
              appt={a}
              open={openId === a.id}
              onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              onSaved={() => { setOpenId(null); load(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentRow({ appt, open, onToggle, onSaved }: {
  appt: Appointment;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(appt.notes || '');
  const [status, setStatus] = useState<string>(appt.prospect_status || '');
  const [saving, setSaving] = useState(false);
  const meta = KIND_META[appt.calendar_kind];

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
      background: 'var(--night-mid)', borderRadius: 10,
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <button onClick={onToggle} style={{
        width: '100%', padding: '10px 12px', background: 'transparent', border: 'none',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'var(--night-raised)', border: `1.5px solid ${meta.color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem',
          }}>{meta.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {appt.contact_name || appt.contact_email || 'Contact GHL'}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {meta.label} · {formatWhen(appt.starts_at)}
            </div>
          </div>
        </div>
        <span style={{
          fontSize: '0.7rem', padding: '4px 10px', borderRadius: 999,
          background: 'rgba(168,85,247,.16)', border: '1px solid rgba(168,85,247,.45)',
          color: '#D8B4FE', fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          {open ? 'Fermer' : '✏️ Renseigner'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Statut prospect
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setStatus(opt.value)} style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600,
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
              placeholder="Compte-rendu de l'appel, prochaines étapes, objections, budget..."
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                background: 'var(--night-raised)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.85rem', resize: 'vertical', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {appt.ghl_contact_id ? '🔁 Sera synchronisé sur la fiche GHL' : '⚠️ Contact GHL non lié'}
            </span>
            <button onClick={save} disabled={saving} style={{
              padding: '8px 16px', borderRadius: 10, background: 'var(--orange)',
              color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
              opacity: saving ? 0.5 : 1,
            }}>
              {saving ? '⏳ Enregistrement…' : '💾 Enregistrer & sync GHL'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
