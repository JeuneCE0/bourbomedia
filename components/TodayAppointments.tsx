'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';
import { useCollapsiblePref } from '@/lib/use-collapsible';
import { useGhlLocationId, buildGhlAppointmentUrl } from '@/lib/use-ghl-location';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  ghl_contact_id: string | null;
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

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtPrevDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function TodayAppointments() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notesModal, setNotesModal] = useState<{ apt: Appointment; text: string; status: string } | null>(null);
  const { collapsed, toggle } = useCollapsiblePref('bbm_today_appts_collapsed', false);

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

  // Sync GHL → gh_appointments en arrière-plan : sans cron Vercel ni
  // webhook fiable, un RDV booké pour le jour même n'apparaît pas. On
  // déclenche un sync léger (window -12h / +48h) au mount + toutes les
  // 30s quand l'onglet est visible. À chaque retour, on recharge la
  // liste locale.
  const autoSync = useCallback(() => {
    fetch('/api/admin/ghl-sync-appointments', { method: 'POST', headers: authHeaders() })
      .then(() => load())
      .catch(() => null);
  }, [load]);
  useEffect(() => { autoSync(); }, [autoSync]);
  useVisibilityAwarePolling(autoSync, 30_000);

  // Filtre client-side strict sur la "vraie" journée locale du user :
  // l'API renvoie une fenêtre ±14h pour ne pas rater les RDV de fuseau
  // (Réunion GMT+4 vs Vercel UTC), c'est ici qu'on resserre sur la
  // date du jour côté navigateur.
  const visibleAppts = useMemo(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = now.getMonth();
    const dd = now.getDate();
    return appts.filter(a => {
      const d = new Date(a.starts_at);
      return d.getFullYear() === yyyy && d.getMonth() === mm && d.getDate() === dd;
    });
  }, [appts]);

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

  async function saveModal() {
    if (!notesModal) return;
    await patchAppt(notesModal.apt.id, {
      notes: notesModal.text,
      prospect_status: notesModal.status || null,
    });
    setNotesModal(null);
  }

  if (loading) return null;
  if (visibleAppts.length === 0) return null;

  const now = new Date();
  const upcoming = visibleAppts.filter(a => new Date(a.starts_at).getTime() >= now.getTime());
  const past = visibleAppts.filter(a => new Date(a.starts_at).getTime() < now.getTime());

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid rgba(232,105,43,.30)',
      padding: '16px 20px', marginBottom: 14,
    }}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: collapsed ? 0 : 12, gap: 10, flexWrap: 'wrap',
          padding: 0, background: 'transparent', border: 'none',
          color: 'inherit', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📞</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
              Aujourd&apos;hui · {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {upcoming.length} à venir · {past.length} passé{past.length > 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '3px 10px', borderRadius: 999,
            background: 'rgba(232,105,43,.16)', border: '1px solid rgba(232,105,43,.45)',
            color: '#FFB58A', fontSize: '0.72rem', fontWeight: 700,
          }}>{visibleAppts.length} RDV</span>
          <span aria-hidden style={{
            display: 'inline-block', fontSize: 11, color: 'var(--text-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform .2s ease',
          }}>▼</span>
        </div>
      </button>

      {!collapsed && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Affichage strictement chronologique (asc, déjà l'ordre renvoyé par
            /api/gh-appointments?today=1). On gardait avant un découpage
            [upcoming, past] qui mettait un appel de 09h passé après un appel
            de 15h à venir — c'était pas l'ordre attendu en lecture rapide.
            Maintenant l'admin voit la journée du matin au soir, point. */}
        {visibleAppts.map(a => (
          <ApptCard key={a.id} apt={a}
            saving={savingId === a.id}
            onPatch={(patch) => patchAppt(a.id, patch)}
            onOpenNotes={() => setNotesModal({ apt: a, text: a.notes || '', status: a.prospect_status || '' })}
          />
        ))}
      </div>
      )}

      {/* Notes / status modal — bottom sheet on mobile, centered on desktop */}
      {notesModal && (
        <>
          <div onClick={() => setNotesModal(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200,
          }} />
          <div style={{
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 201, width: 'min(520px, calc(100vw - 32px))',
            maxHeight: '80vh', overflowY: 'auto',
            background: 'var(--night-card)', borderRadius: 14,
            padding: '20px 22px', border: '1px solid var(--border-md)',
            boxShadow: '0 20px 60px rgba(0,0,0,.5)',
          }}>
            <h3 style={{
              fontSize: '1rem', fontWeight: 700, color: 'var(--text)',
              margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {KIND_META[notesModal.apt.calendar_kind].emoji} {KIND_META[notesModal.apt.calendar_kind].label}
            </h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              {notesModal.apt.contact_name || notesModal.apt.opportunity_name || '—'} · {fmtTime(notesModal.apt.starts_at)}
            </div>

            {/* Statut prospect */}
            {notesModal.apt.calendar_kind === 'closing' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
                  display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>Statut prospect</label>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {PROSPECT_STATUS_OPTIONS.map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setNotesModal(m => m ? { ...m, status: opt.value } : m)}
                      style={{
                        padding: '5px 10px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                        background: notesModal.status === opt.value ? 'var(--orange)' : 'var(--night-mid)',
                        color: notesModal.status === opt.value ? '#fff' : 'var(--text-mid)',
                        border: `1px solid ${notesModal.status === opt.value ? 'var(--orange)' : 'var(--border-md)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}>
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <label style={{
              fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
              display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>Notes du RDV</label>
            <textarea
              value={notesModal.text}
              onChange={(e) => setNotesModal(m => m ? { ...m, text: e.target.value } : m)}
              placeholder="Compte-rendu, points clés, suite à donner…"
              rows={6}
              autoFocus
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.88rem', boxSizing: 'border-box',
                fontFamily: 'inherit', resize: 'vertical', minHeight: 110,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => {
                  // Confirm avant de fermer si l'admin a tapé des notes ou
                  // changé le statut prospect (sinon ses changements partent
                  // à la trappe sans warning).
                  const dirtyNotes = notesModal.text.trim() !== (notesModal.apt.notes || '').trim();
                  const dirtyStatus = (notesModal.status || '') !== (notesModal.apt.prospect_status || '');
                  if ((dirtyNotes || dirtyStatus) && !confirm('Vos modifications ne seront pas enregistrées. Fermer quand même ?')) return;
                  setNotesModal(null);
                }}
                style={{
                  flex: 1, padding: '11px', borderRadius: 10, background: 'var(--night-mid)',
                  border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                  fontSize: '0.86rem', fontWeight: 600, cursor: 'pointer',
                }}>Annuler</button>
              <button onClick={saveModal} disabled={savingId === notesModal.apt.id} style={{
                flex: 2, padding: '11px', borderRadius: 10, background: 'var(--orange)',
                border: 'none', color: '#fff', fontSize: '0.86rem', fontWeight: 700,
                cursor: 'pointer', opacity: savingId === notesModal.apt.id ? 0.7 : 1,
              }}>{savingId === notesModal.apt.id ? '⏳ Enregistrement…' : '💾 Enregistrer'}</button>
            </div>
          </div>
        </>
      )}
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
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);

  async function createTask() {
    const text = taskText.trim();
    if (!text) return;
    setTaskBusy(true);
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          client_id: apt.client_id || null,
          text: `[${apt.contact_name || apt.opportunity_name || 'Prospect'}] ${text}`,
          priority: 'medium',
        }),
      });
      if (r.ok) {
        setTaskText('');
        setShowTaskForm(false);
      } else {
        alert("Erreur création tâche.");
      }
    } finally { setTaskBusy(false); }
  }

  // Deep-link vers la fiche RDV GHL (admin replanifie directement dans GHL
  // où l'UI calendrier est conçue pour ça). Le location_id vient de l'API
  // /api/app-settings/integrations (lib/use-ghl-location), pas d'un env
  // var NEXT_PUBLIC inexistant → évite l'URL ".../location//appointments"
  // double-slash qui rendait une page blanche.
  const ghlLocationId = useGhlLocationId();
  const rescheduleUrl = buildGhlAppointmentUrl(ghlLocationId, apt.ghl_appointment_id);

  return (
    <div style={{
      background: 'var(--night-mid)', borderRadius: 12,
      border: `1px solid ${cancelled ? 'var(--border)' : documented ? 'rgba(34,197,94,.3)' : past ? 'rgba(168,85,247,.4)' : 'var(--border)'}`,
      padding: '12px 14px', opacity: cancelled ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          minWidth: 50, textAlign: 'center', paddingTop: 2,
        }}>
          <div style={{
            fontSize: '0.95rem', fontWeight: 700, color: meta.color,
            fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
          }}>{fmtTime(apt.starts_at)}</div>
          <span aria-hidden style={{
            display: 'inline-flex', marginTop: 6,
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--night-raised)', border: `1.5px solid ${meta.color}`,
            alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem',
            fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
          }}>{meta.emoji}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 8,
            alignItems: 'baseline', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>
              {meta.label}
            </span>
            {documented && <span style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600 }}>✓ documenté</span>}
            {cancelled && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{apt.status === 'no_show' ? '⌧ no-show' : '⌧ annulé'}</span>}
            {apt.rescheduled_at && apt.previous_starts_at && (
              <span title={`Reporté le ${new Date(apt.rescheduled_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                style={{
                  fontSize: '0.65rem', fontWeight: 700,
                  padding: '2px 8px', borderRadius: 999,
                  background: 'rgba(250,204,21,.14)', border: '1px solid rgba(250,204,21,.45)',
                  color: '#FACC15',
                }}>
                🔄 Reporté{(apt.reschedule_count || 0) > 1 ? ` ×${apt.reschedule_count}` : ''}
              </span>
            )}
          </div>
          {apt.rescheduled_at && apt.previous_starts_at && (
            <div style={{
              fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2,
              fontStyle: 'italic',
            }}>
              Initialement prévu le {fmtPrevDateTime(apt.previous_starts_at)}
            </div>
          )}
          <div style={{ fontSize: '0.83rem', color: 'var(--text-mid)', marginTop: 1, fontWeight: 500 }}>
            {apt.opportunity_name || apt.contact_name || apt.contact_email || '—'}
          </div>
          {apt.contact_phone && (
            <a href={`tel:${apt.contact_phone}`} onClick={e => e.stopPropagation()} style={{
              fontSize: '0.74rem', color: 'var(--orange)', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2,
            }}>📱 {apt.contact_phone}</a>
          )}
          {apt.notes && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, background: 'var(--night-raised)',
              fontSize: '0.74rem', color: 'var(--text-mid)', lineHeight: 1.4,
              marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden',
            }}>{apt.notes}</div>
          )}

          {!cancelled && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {apt.calendar_kind === 'closing' && (
                <Link href={`/dashboard/closing/${apt.id}`} style={{
                  padding: '7px 12px', borderRadius: 7,
                  background: 'linear-gradient(135deg, var(--orange) 0%, #C45520 100%)',
                  border: 'none', color: '#fff', fontSize: '0.76rem', fontWeight: 700,
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>🎯 Closing Room</Link>
              )}
              <button onClick={onOpenNotes} disabled={saving} style={{
                padding: '7px 12px', borderRadius: 7,
                background: apt.calendar_kind === 'closing' ? 'var(--night-raised)' : 'var(--orange)',
                border: apt.calendar_kind === 'closing' ? '1px solid var(--border-md)' : 'none',
                color: apt.calendar_kind === 'closing' ? 'var(--text-mid)' : '#fff',
                fontSize: '0.76rem', fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
              }}>
                {documented ? '✏️ Modifier' : '📝 Documenter'}
              </button>
              {!documented && past && (
                <>
                  <button
                    onClick={() => {
                      const who = apt.contact_name || apt.opportunity_name || 'ce RDV';
                      if (window.confirm(`Marquer "${who}" en No-show ? Action irréversible (synchro GHL).`)) {
                        onPatch({ status: 'no_show' });
                      }
                    }}
                    disabled={saving}
                    style={{
                      padding: '7px 12px', borderRadius: 7, background: 'var(--night-raised)',
                      border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                      fontSize: '0.76rem', cursor: saving ? 'wait' : 'pointer',
                    }}
                  >No-show</button>
                  <button
                    onClick={() => {
                      const who = apt.contact_name || apt.opportunity_name || 'ce RDV';
                      if (window.confirm(`Marquer "${who}" en Annulé ? Action irréversible (synchro GHL).`)) {
                        onPatch({ status: 'cancelled' });
                      }
                    }}
                    disabled={saving}
                    style={{
                      padding: '7px 12px', borderRadius: 7, background: 'var(--night-raised)',
                      border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                      fontSize: '0.76rem', cursor: saving ? 'wait' : 'pointer',
                    }}
                  >Annulé</button>
                </>
              )}
              <button
                onClick={() => setShowTaskForm(v => !v)}
                disabled={saving}
                style={{
                  padding: '7px 12px', borderRadius: 7, background: 'var(--night-raised)',
                  border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                  fontSize: '0.76rem', cursor: saving ? 'wait' : 'pointer',
                }}
              >📌 Tâche</button>
              <a
                href={rescheduleUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: '7px 12px', borderRadius: 7, background: 'var(--night-raised)',
                  border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                  fontSize: '0.76rem', textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >🔄 Replanifier</a>
              {apt.client_id && (
                <Link href={`/dashboard/clients/${apt.client_id}`} style={{
                  padding: '7px 12px', borderRadius: 7, background: 'transparent',
                  border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                  fontSize: '0.76rem', textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center',
                }}>→ Fiche</Link>
              )}
            </div>
          )}
          {showTaskForm && !cancelled && (
            <div style={{
              marginTop: 8, display: 'flex', gap: 6, alignItems: 'stretch',
            }}>
              <input
                type="text"
                value={taskText}
                onChange={e => setTaskText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !taskBusy && taskText.trim()) createTask(); }}
                placeholder={`Tâche pour ${apt.contact_name || apt.opportunity_name || 'ce prospect'}…`}
                autoFocus
                style={{
                  flex: 1, padding: '7px 11px', borderRadius: 7,
                  background: 'var(--night-raised)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', fontSize: '0.8rem', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={createTask}
                disabled={taskBusy || !taskText.trim()}
                style={{
                  padding: '7px 14px', borderRadius: 7,
                  background: taskText.trim() ? 'var(--orange)' : 'var(--night-raised)',
                  border: 'none', color: '#fff',
                  fontSize: '0.76rem', fontWeight: 700,
                  cursor: taskBusy || !taskText.trim() ? 'not-allowed' : 'pointer',
                  opacity: taskBusy ? 0.6 : 1,
                }}
              >{taskBusy ? '⏳' : 'Ajouter'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
