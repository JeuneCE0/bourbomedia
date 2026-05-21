'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCollapsiblePref } from '@/lib/use-collapsible';

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
  opportunity_name?: string | null;
  pipeline_stage_name?: string | null;
}

const KIND_META: Record<Appointment['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',    color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding', color: '#3B82F6' },
  tournage:   { emoji: '🎬', label: 'Tournage',   color: 'var(--green)' },
  other:      { emoji: '📅', label: 'Rendez-vous', color: 'var(--text-mid)' },
};

// Aligned with GHL "Pipeline Bourbon Média" stages — see migration 015.
const STATUS_OPTIONS: { value: string; label: string; emoji: string; followUpDays?: number }[] = [
  { value: 'reflection',          label: 'En réflexion',                 emoji: '🤔', followUpDays: 2 },
  { value: 'follow_up',           label: 'Follow-up',                    emoji: '🔁', followUpDays: 7 },
  { value: 'ghosting',            label: 'Ghosting',                     emoji: '👻' },
  { value: 'awaiting_signature',  label: 'Attente signature + paiement', emoji: '✍️' },
  { value: 'contracted',          label: 'Contracté',                    emoji: '🤝' },
  { value: 'regular',             label: 'Client régulier',              emoji: '⭐' },
  { value: 'not_interested',      label: 'Pas intéressé',                emoji: '🚫' },
  { value: 'closed_lost',         label: 'Perdu',                        emoji: '❌' },
];

const STATUS_BY_VALUE: Record<string, { label: string; emoji: string; followUpDays?: number }> =
  STATUS_OPTIONS.reduce((acc, o) => { acc[o.value] = o; return acc; }, {} as Record<string, { label: string; emoji: string; followUpDays?: number }>);

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function matchesQuery(a: Appointment, q: string): boolean {
  if (!q) return true;
  const hay = [
    a.opportunity_name, a.contact_name, a.contact_email, a.contact_phone,
    KIND_META[a.calendar_kind]?.label,
  ].filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const needle = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return hay.includes(needle);
}

export default function AppointmentsToDocument() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { collapsed, toggle } = useCollapsiblePref('bbm_appts_to_document_collapsed', false);

  const load = useCallback(() => {
    fetch('/api/gh-appointments?pending=1', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => setItems(d.appointments || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Quand une recherche est active : on filtre TOUTE la liste et on affiche
  // tous les résultats (sinon le prospect cherché pourrait être au-delà des
  // 8 premiers et rester invisible). Sans recherche : on garde le slice(0,8)
  // pour ne pas noyer le dashboard sous 50 lignes.
  const filtered = query.trim() ? items.filter(a => matchesQuery(a, query)) : items;
  const visible = query.trim() ? filtered : filtered.slice(0, 8);

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
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: collapsed ? 0 : (isEmpty ? 4 : 12), gap: 10, padding: 0,
          background: 'transparent', border: 'none', color: 'inherit',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📞</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Appels à documenter</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Appels passés — saisis statut + notes (No Show à marquer dans GHL)
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isEmpty && (
            <span style={{
              padding: '3px 10px', borderRadius: 999,
              background: 'rgba(168,85,247,.16)', border: '1px solid rgba(168,85,247,.45)',
              color: '#D8B4FE', fontSize: '0.72rem', fontWeight: 700,
            }}>{items.length}</span>
          )}
          <span aria-hidden style={{
            display: 'inline-block', fontSize: 11, color: 'var(--text-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform .2s ease',
          }}>▼</span>
        </div>
      </button>

      {!collapsed && (isEmpty ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: 30 }}>
          Tous les appels sont à jour. ✨
        </div>
      ) : (
        <>
          {/* Recherche — utile car la liste peut compter des dizaines
              d'appels en attente et seuls les 8 premiers sont affichés
              par défaut. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 10, marginBottom: 10,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
          }}>
            <span aria-hidden style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1 }}>🔍</span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un prospect, email, téléphone…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: '0.82rem', padding: 0, fontFamily: 'inherit',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: 2,
                }}
              >✕</button>
            )}
          </div>

          {visible.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '8px 4px', fontStyle: 'italic' }}>
              Aucun appel ne correspond à « {query} ».
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visible.map(a => (
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
          {!query && filtered.length > 8 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
              {filtered.length - 8} autre{filtered.length - 8 > 1 ? 's' : ''} appel{filtered.length - 8 > 1 ? 's' : ''} — utilise la recherche pour les retrouver.
            </div>
          )}
        </>
      ))}
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
              {appt.opportunity_name || appt.contact_name || appt.contact_email || 'Sans nom'}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {meta.label} · {formatWhen(appt.starts_at)}
              {appt.opportunity_name && appt.contact_name && appt.contact_name !== appt.opportunity_name && ` · ${appt.contact_name}`}
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

          {STATUS_BY_VALUE[status]?.followUpDays && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(59,130,246,.10)', border: '1px solid rgba(59,130,246,.30)',
              fontSize: '0.78rem', color: '#93C5FD',
            }}>
              ⏰ Une tâche de relance sera créée automatiquement pour <strong>J+{STATUS_BY_VALUE[status].followUpDays}</strong> ({STATUS_BY_VALUE[status].label.toLowerCase()}).
            </div>
          )}
          {(status === 'awaiting_signature' || status === 'contracted') && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.30)',
              fontSize: '0.78rem', color: '#86EFAC',
            }}>
              🚀 Pense à envoyer le lien d&apos;onboarding au prospect pour qu&apos;il complète son inscription.
            </div>
          )}

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
