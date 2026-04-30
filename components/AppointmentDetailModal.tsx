'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  ghl_contact_id: string | null;
  opportunity_id: string | null;
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
  client_id: string | null;
  rescheduled_at?: string | null;
  previous_starts_at?: string | null;
  reschedule_count?: number | null;
}

interface GhlContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  city: string | null;
  source: string | null;
  tags: string[];
  customFields: { id: string; label: string; value: unknown }[];
}

const KIND_META: Record<Appointment['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',    color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding', color: '#14B8A6' },
  tournage:   { emoji: '🎬', label: 'Tournage',   color: '#3B82F6' },
  other:      { emoji: '📅', label: 'RDV',        color: 'var(--text-mid)' },
};

const PROSPECT_STATUS_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'reflection',          label: 'En réflexion',         emoji: '🤔' },
  { value: 'follow_up',           label: 'Follow-up',            emoji: '🔁' },
  { value: 'ghosting',            label: 'Ghosting',             emoji: '👻' },
  { value: 'awaiting_signature',  label: 'Attente signature',    emoji: '✍️' },
  { value: 'contracted',          label: 'Contracté',            emoji: '🤝' },
  { value: 'not_interested',      label: 'Pas intéressé',        emoji: '🚫' },
  { value: 'closed_lost',         label: 'Perdu',                emoji: '❌' },
];

const PRIORITY_LABELS = [
  'Type de commerce',
  'Ville du commerce',
  'Ancienneté du commerce',
  'Expérience publicité en ligne',
  'Objectif principal',
  'Détail objectif',
  'Prêt à investir',
  'Qualifié',
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export default function AppointmentDetailModal({
  appointmentId, onClose,
}: {
  appointmentId: string;
  onClose: () => void;
}) {
  const [apt, setApt] = useState<Appointment | null>(null);
  const [contact, setContact] = useState<GhlContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/gh-appointments?id=${appointmentId}`, { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      const a = (d.appointments || [])[0] || null;
      setApt(a);
      if (!a) return;
      setNotes(a.notes || '');
      setStatus(a.prospect_status || '');

      // 1 seul call serveur (merge_opps=1 → backend fetch les opps liées au
      // contact et merge leurs customFields → on obtient la qualification
      // complète qu'elle soit au niveau contact OU opportunité).
      let contactIdToFetch: string | null = a.ghl_contact_id;
      if (!contactIdToFetch && a.opportunity_id) {
        const oR = await fetch(`/api/ghl/opportunity?id=${encodeURIComponent(a.opportunity_id)}`, { headers: authHeaders() }).catch(() => null);
        if (oR && oR.ok) {
          const od = await oR.json();
          contactIdToFetch = od?.opportunity?.contactId || null;
        }
      }
      if (contactIdToFetch) {
        const cR = await fetch(`/api/ghl/contact?id=${encodeURIComponent(contactIdToFetch)}&merge_opps=1`, { headers: authHeaders() });
        if (cR.ok) {
          const cd = await cR.json();
          setContact(cd?.contact || null);
        }
      }
    } finally { setLoading(false); }
  }, [appointmentId]);

  useEffect(() => { load(); }, [load]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!apt) return;
    setSaving(true);
    try {
      await fetch('/api/gh-appointments', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ id: apt.id, notes: notes.trim() || null, prospect_status: status || null }),
      });
      await load();
    } finally { setSaving(false); }
  }

  const meta = apt ? KIND_META[apt.calendar_kind] : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--night-card)', borderRadius: 14,
          border: '1px solid var(--border-md)',
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
          animation: 'bm-fade-in .15s ease-out',
        }}
      >
        <style>{`@keyframes bm-fade-in { from { opacity: 0; transform: scale(.98) } to { opacity: 1; transform: scale(1) } }`}</style>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{
              fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0,
              fontFamily: "'Bricolage Grotesque', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {meta && <span aria-hidden style={{ fontSize: '1.2rem' }}>{meta.emoji}</span>}
              {meta ? meta.label : 'Rendez-vous'}
            </h2>
            {apt && (
              <>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  {fmtDateTime(apt.starts_at)}
                </p>
                {apt.rescheduled_at && apt.previous_starts_at && (
                  <div style={{
                    marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '4px 10px', borderRadius: 999,
                    background: 'rgba(250,204,21,.14)', border: '1px solid rgba(250,204,21,.45)',
                    color: '#FACC15', fontSize: '0.7rem', fontWeight: 700,
                  }}>
                    🔄 Reporté{(apt.reschedule_count || 0) > 1 ? ` ×${apt.reschedule_count}` : ''}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                      · initialement {fmtDateTime(apt.previous_starts_at)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
          )}

          {apt && (
            <>
              {/* Contact info */}
              <div>
                <div style={{
                  fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
                }}>👤 Contact</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
                  {(contact?.name || apt.contact_name || apt.opportunity_name) && (
                    <InfoRow icon="🏷️" value={contact?.name || apt.contact_name || apt.opportunity_name!} />
                  )}
                  {(contact?.email || apt.contact_email) && (
                    <InfoRow icon="📧" value={contact?.email || apt.contact_email!} link={`mailto:${contact?.email || apt.contact_email}`} />
                  )}
                  {(contact?.phone || apt.contact_phone) && (
                    <InfoRow icon="📱" value={contact?.phone || apt.contact_phone!} link={`tel:${contact?.phone || apt.contact_phone}`} />
                  )}
                  {contact?.companyName && <InfoRow icon="🏢" value={contact.companyName} />}
                  {contact?.city && <InfoRow icon="📍" value={contact.city} />}
                  {contact?.source && <InfoRow icon="🔗" value={contact.source} />}
                </div>
              </div>

              {/* Quick actions */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {apt.calendar_kind === 'closing' && (
                  <Link href={`/dashboard/closing/${apt.id}`} onClick={onClose} style={btnStyle('linear-gradient(135deg, var(--orange) 0%, #C45520 100%)', '#fff')}>
                    🎯 Closing Room
                  </Link>
                )}
                {(contact?.phone || apt.contact_phone) && (
                  <a href={`tel:${contact?.phone || apt.contact_phone}`} style={btnStyle()}>📱 Appeler</a>
                )}
                {(contact?.email || apt.contact_email) && (
                  <a href={`mailto:${contact?.email || apt.contact_email}`} style={btnStyle()}>📧 Email</a>
                )}
                {apt.client_id && (
                  <Link href={`/dashboard/clients/${apt.client_id}`} onClick={onClose} style={btnStyle()}>
                    → Fiche client
                  </Link>
                )}
                {apt.opportunity_name && (
                  <Link href={`/dashboard/pipeline?q=${encodeURIComponent(apt.opportunity_name)}`} onClick={onClose} style={btnStyle()}>
                    → Pipeline prospect
                  </Link>
                )}
              </div>

              {/* Custom fields prioritaires (qualification) */}
              {contact?.customFields && contact.customFields.length > 0 && (
                <div>
                  <div style={{
                    fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
                  }}>🎯 Qualification</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
                    {PRIORITY_LABELS.map(label => {
                      const target = norm(label);
                      const found = contact.customFields.find(cf => {
                        const n = norm(cf.label);
                        return n === target || n.includes(target) || target.includes(n);
                      });
                      return (
                        <div key={label} style={{
                          padding: '7px 9px', borderRadius: 6,
                          background: found ? 'var(--night-mid)' : 'transparent',
                          border: `1px solid ${found ? 'rgba(232,105,43,.25)' : 'var(--border)'}`,
                          opacity: found ? 1 : 0.5,
                        }}>
                          <div style={{
                            fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700,
                            marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em',
                          }}>{label}</div>
                          <div style={{
                            fontSize: '0.78rem', color: found ? 'var(--text)' : 'var(--text-muted)',
                            wordBreak: 'break-word', fontStyle: found ? 'normal' : 'italic',
                          }}>
                            {found ? (Array.isArray(found.value) ? found.value.join(', ') : String(found.value)) : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Statut prospect (closing only) */}
              {apt.calendar_kind === 'closing' && (
                <div>
                  <label style={{
                    fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
                    display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>Statut prospect</label>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {PROSPECT_STATUS_OPTIONS.map(opt => (
                      <button key={opt.value} type="button" onClick={() => setStatus(opt.value)} style={{
                        padding: '5px 10px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                        background: status === opt.value ? 'var(--orange)' : 'var(--night-mid)',
                        color: status === opt.value ? '#fff' : 'var(--text-mid)',
                        border: `1px solid ${status === opt.value ? 'var(--orange)' : 'var(--border-md)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}>
                        {opt.emoji} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label style={{
                  fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
                  display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>📝 Notes du RDV</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Compte-rendu, points clés, suite à donner…"
                  rows={5}
                  style={{
                    width: '100%', padding: '11px 13px', borderRadius: 10,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.86rem', boxSizing: 'border-box',
                    fontFamily: 'inherit', resize: 'vertical', minHeight: 100,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={onClose} style={{
                  padding: '10px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600,
                }}>Annuler</button>
                <button onClick={save} disabled={saving} style={{
                  padding: '10px 18px', borderRadius: 8, background: 'var(--orange)',
                  border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.84rem',
                  fontWeight: 700, opacity: saving ? 0.7 : 1,
                }}>{saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg = 'var(--night-mid)', color = 'var(--text)'): React.CSSProperties {
  return {
    padding: '8px 12px', borderRadius: 7, background: bg,
    border: bg === 'var(--night-mid)' ? '1px solid var(--border-md)' : 'none',
    color, textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 4,
  };
}

function InfoRow({ icon, value, link }: { icon: string; value: string; link?: string }) {
  const inner = (
    <div style={{
      padding: '6px 10px', borderRadius: 6, background: 'var(--night-mid)',
      border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6,
      fontSize: '0.78rem',
    }}>
      <span aria-hidden>{icon}</span>
      <span style={{
        color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</span>
    </div>
  );
  return link ? <a href={link} style={{ textDecoration: 'none' }}>{inner}</a> : inner;
}
