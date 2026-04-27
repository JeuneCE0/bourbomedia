'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Appointment {
  id: string;
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  opportunity_name: string | null;
  client_id: string | null;
}

const KIND_META: Record<Appointment['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',    color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding', color: '#14B8A6' },
  tournage:   { emoji: '🎬', label: 'Tournage',   color: '#3B82F6' },
  other:      { emoji: '📅', label: 'RDV',         color: 'var(--text-mid)' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function TodayPage() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notesModal, setNotesModal] = useState<{ apt: Appointment; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/gh-appointments?today=1', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setAppts(Array.isArray(d.appointments) ? d.appointments : []);
      }
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patchAppt(id: string, patch: Partial<Appointment>) {
    setSavingId(id);
    try {
      const r = await fetch('/api/gh-appointments', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ id, ...patch }),
      });
      if (r.ok) await load();
    } finally { setSavingId(null); }
  }

  async function saveNotes() {
    if (!notesModal) return;
    await patchAppt(notesModal.apt.id, { notes: notesModal.text });
    setNotesModal(null);
  }

  const now = new Date();
  const upcoming = appts.filter(a => new Date(a.starts_at).getTime() >= now.getTime());
  const past = appts.filter(a => new Date(a.starts_at).getTime() < now.getTime());

  return (
    <div style={{ padding: '20px 16px 100px', maxWidth: 640, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
          fontSize: '1.7rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          📞 Aujourd&apos;hui
          {appts.length > 0 && (
            <span style={{
              fontSize: '0.75rem', padding: '4px 12px', borderRadius: 999,
              background: 'var(--night-mid)', color: 'var(--text-muted)', fontWeight: 700,
            }}>{appts.length} RDV</span>
          )}
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
          {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </header>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--text-muted)' }}>Chargement…</div>
      ) : appts.length === 0 ? (
        <div style={{
          padding: '40px 20px', borderRadius: 14, textAlign: 'center',
          background: 'var(--night-card)', border: '1px dashed var(--border-md)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🌴</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-mid)' }}>
            Aucun RDV aujourd&apos;hui
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Profite-en pour avancer sur tes scripts.
          </div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Section title="À venir" emoji="⏰">
              {upcoming.map(a => (
                <ApptCard key={a.id} apt={a}
                  saving={savingId === a.id}
                  onPatch={(patch) => patchAppt(a.id, patch)}
                  onOpenNotes={() => setNotesModal({ apt: a, text: a.notes || '' })}
                />
              ))}
            </Section>
          )}
          {past.length > 0 && (
            <Section title="Passés" emoji="✅">
              {past.map(a => (
                <ApptCard key={a.id} apt={a}
                  saving={savingId === a.id}
                  onPatch={(patch) => patchAppt(a.id, patch)}
                  onOpenNotes={() => setNotesModal({ apt: a, text: a.notes || '' })}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {/* Notes modal — bottom sheet on mobile */}
      {notesModal && (
        <>
          <div onClick={() => setNotesModal(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100,
          }} />
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 101,
            background: 'var(--night-card)', borderRadius: '16px 16px 0 0',
            padding: '20px 18px 24px', maxHeight: '70vh', overflowY: 'auto',
            borderTop: '1px solid var(--border)',
          }}>
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: 'var(--border-md)',
              margin: '0 auto 14px',
            }} />
            <h3 style={{
              fontSize: '1rem', fontWeight: 700, color: 'var(--text)',
              margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {KIND_META[notesModal.apt.calendar_kind].emoji} Notes du RDV
            </h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              {notesModal.apt.contact_name || notesModal.apt.opportunity_name || '—'} · {fmtTime(notesModal.apt.starts_at)}
            </div>
            <textarea
              value={notesModal.text}
              onChange={(e) => setNotesModal({ ...notesModal, text: e.target.value })}
              placeholder="Compte-rendu, points clés, suite à donner…"
              rows={6}
              autoFocus
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.9rem', boxSizing: 'border-box',
                fontFamily: 'inherit', resize: 'vertical', minHeight: 120,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setNotesModal(null)} style={{
                flex: 1, padding: '12px', borderRadius: 10, background: 'var(--night-mid)',
                border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              }}>Annuler</button>
              <button onClick={saveNotes} style={{
                flex: 2, padding: '12px', borderRadius: 10, background: 'var(--orange)',
                border: 'none', color: '#fff', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer',
              }}>Enregistrer</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span aria-hidden>{emoji}</span> {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function ApptCard({
  apt, saving, onPatch, onOpenNotes,
}: {
  apt: Appointment;
  saving: boolean;
  onPatch: (patch: Partial<Appointment>) => void;
  onOpenNotes: () => void;
}) {
  const meta = KIND_META[apt.calendar_kind];
  const past = new Date(apt.starts_at).getTime() < Date.now();
  const documented = !!apt.notes_completed_at;
  const cancelled = apt.status === 'cancelled' || apt.status === 'no_show';

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: `1px solid ${cancelled ? 'var(--border)' : documented ? 'rgba(34,197,94,.3)' : past ? 'rgba(232,105,43,.3)' : 'var(--border)'}`,
      padding: '14px 16px', opacity: cancelled ? 0.55 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'var(--night-mid)', border: `2px solid ${meta.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem',
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        }} aria-hidden>{meta.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 8,
            alignItems: 'baseline', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
              {fmtTime(apt.starts_at)} · {meta.label}
            </span>
            {documented && <span style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600 }}>✓ documenté</span>}
            {cancelled && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{apt.status === 'no_show' ? '⌧ no-show' : '⌧ annulé'}</span>}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-mid)', marginTop: 2, fontWeight: 500 }}>
            {apt.contact_name || apt.opportunity_name || '—'}
          </div>
          {apt.contact_phone && (
            <a href={`tel:${apt.contact_phone}`} style={{
              fontSize: '0.78rem', color: 'var(--orange)', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2,
            }}>📱 {apt.contact_phone}</a>
          )}
        </div>
      </div>

      {/* Existing notes preview */}
      {apt.notes && (
        <div style={{
          padding: '8px 10px', borderRadius: 8, background: 'var(--night-mid)',
          fontSize: '0.78rem', color: 'var(--text-mid)', lineHeight: 1.45,
          marginBottom: 10, whiteSpace: 'pre-wrap',
        }}>{apt.notes}</div>
      )}

      {/* Actions */}
      {!cancelled && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ActionBtn
            primary
            disabled={saving}
            onClick={onOpenNotes}
            label={documented ? '✏️ Modifier notes' : '📝 Documenter'}
          />
          {!documented && past && (
            <>
              <ActionBtn
                disabled={saving}
                onClick={() => onPatch({ status: 'no_show' })}
                label="No-show"
              />
              <ActionBtn
                disabled={saving}
                onClick={() => onPatch({ status: 'cancelled' })}
                label="Annulé"
              />
            </>
          )}
          {apt.client_id && (
            <Link href={`/dashboard/clients/${apt.client_id}`} style={{
              padding: '8px 12px', borderRadius: 8, background: 'transparent',
              border: '1px solid var(--border-md)', color: 'var(--text-muted)',
              fontSize: '0.78rem', fontWeight: 500, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center',
            }}>→ Fiche</Link>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label, onClick, primary, disabled,
}: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 14px', borderRadius: 8,
        background: primary ? 'var(--orange)' : 'var(--night-mid)',
        border: primary ? 'none' : '1px solid var(--border-md)',
        color: primary ? '#fff' : 'var(--text-mid)',
        fontSize: '0.8rem', fontWeight: primary ? 700 : 500,
        cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.6 : 1,
        flex: primary ? '1 1 140px' : '0 0 auto',
      }}
    >
      {label}
    </button>
  );
}
