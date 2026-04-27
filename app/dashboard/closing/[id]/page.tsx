'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  ghl_contact_id: string | null;
  opportunity_id: string | null;
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

const PROSPECT_STATUS_OPTIONS = [
  { value: 'reflection',          label: 'En réflexion',         emoji: '🤔', color: '#FACC15' },
  { value: 'follow_up',           label: 'Follow-up',            emoji: '🔁', color: '#F97316' },
  { value: 'awaiting_signature',  label: 'Attente signature',    emoji: '✍️', color: '#3B82F6' },
  { value: 'contracted',          label: '✅ Contracté',          emoji: '🤝', color: 'var(--green)' },
  { value: 'ghosting',            label: 'Ghosting',             emoji: '👻', color: '#94A3B8' },
  { value: 'not_interested',      label: 'Pas intéressé',        emoji: '🚫', color: '#737373' },
  { value: 'closed_lost',         label: 'Perdu',                emoji: '❌', color: '#EF4444' },
];

const PRIORITY_LABELS = [
  'Type de commerce', 'Ville du commerce', 'Ancienneté du commerce',
  'Expérience publicité en ligne', 'Objectif principal', 'Détail objectif',
  'Prêt à investir', 'Qualifié',
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}
function authHeadersForm() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}` };
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export default function ClosingRoomPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [apt, setApt] = useState<Appointment | null>(null);
  const [contact, setContact] = useState<GhlContact | null>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AI summary
  const [summarizing, setSummarizing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/gh-appointments?id=${id}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        const a = (d.appointments || [])[0] || null;
        setApt(a);
        if (a) {
          setNotes(a.notes || '');
          setStatus(a.prospect_status || '');
          if (a.ghl_contact_id) {
            const cR = await fetch(`/api/ghl/contact?id=${encodeURIComponent(a.ghl_contact_id)}`, { headers: authHeaders() });
            if (cR.ok) {
              const cd = await cR.json();
              setContact(cd?.contact || null);
            }
          }
        }
      }
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Autosave notes (debounce 2s)
  useEffect(() => {
    if (!apt) return;
    if (notes === (apt.notes || '') && status === (apt.prospect_status || '')) return;
    const t = setTimeout(() => save(), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, status, apt]);

  async function save() {
    if (!apt) return;
    setSaving(true);
    try {
      await fetch('/api/gh-appointments', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ id: apt.id, notes: notes.trim() || null, prospect_status: status || null }),
      });
      setSavedAt(new Date());
    } finally { setSaving(false); }
  }

  // ── Audio recording ───────────────────────────────────────────────
  async function startRecording() {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = handleStop;
      mr.start(1000); // chunk every 1s
      mediaRecorderRef.current = mr;
      setRecording(true);
      startTsRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTsRef.current) / 1000));
      }, 500);
    } catch (e: unknown) {
      setRecordError((e as Error).message || 'Permission micro refusée');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
    }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecording(false);
  }

  async function handleStop() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    setTranscribing(true);
    setRecordError(null);
    try {
      const fd = new FormData();
      fd.append('audio', blob, `recording-${Date.now()}.webm`);
      fd.append('language', 'fr');
      const r = await fetch('/api/ai/transcribe', { method: 'POST', headers: authHeadersForm(), body: fd });
      const d = await r.json();
      if (r.ok && d.text) {
        const stamp = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        setNotes(prev => {
          const block = `[Vocal ${stamp}] ${d.text}`;
          return prev.trim() ? `${prev}\n\n${block}` : block;
        });
      } else {
        setRecordError(d.error || 'Transcription échouée');
      }
    } catch (e: unknown) {
      setRecordError((e as Error).message);
    } finally { setTranscribing(false); }
  }

  // ── AI summary via /api/ai/copilot ────────────────────────────────
  async function summarizeWithAI() {
    if (!notes.trim() || !apt) return;
    setSummarizing(true);
    try {
      const r = await fetch('/api/ai/copilot', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          action: 'summarize_call',
          payload: {
            raw_notes: notes,
            contact_name: apt.contact_name,
            business_name: contact?.companyName || apt.opportunity_name,
            appointment_kind: apt.calendar_kind,
          },
        }),
      });
      const d = await r.json();
      if (r.ok && d.text) {
        setNotes(d.text);
      }
    } finally { setSummarizing(false); }
  }

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Chargement…</div>;
  if (!apt) return <div style={{ padding: 32, color: 'var(--red)' }}>RDV introuvable</div>;

  const phone = contact?.phone || apt.contact_phone;
  const email = contact?.email || apt.contact_email;
  const businessName = contact?.companyName || apt.opportunity_name || apt.contact_name;

  return (
    <div style={{ padding: 'clamp(14px, 2vw, 24px)', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header sticky */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--night)', padding: '14px 0',
        borderBottom: '1px solid var(--border)', marginBottom: 18,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <button onClick={() => router.back()} style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: '0.78rem', cursor: 'pointer', padding: 0, marginBottom: 4,
            }}>← Retour</button>
            <h1 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
              fontSize: 'clamp(1.4rem, 3vw, 2rem)', color: 'var(--text)', margin: 0, lineHeight: 1.1,
            }}>
              📞 {businessName || 'Closing'}
            </h1>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              {fmtDateTime(apt.starts_at)} · {apt.calendar_kind}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {phone && (
              <a href={`tel:${phone}`} style={btnLg('var(--orange)')}>📞 Appeler</a>
            )}
            {phone && (
              <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={btnLg('#25D366')}>💬 WhatsApp</a>
            )}
            {email && (
              <a href={`mailto:${email}`} style={btnLg('var(--night-card)', 'var(--text-mid)')}>📧 Email</a>
            )}
            {apt.client_id && (
              <Link href={`/dashboard/clients/${apt.client_id}`} style={btnLg('var(--night-card)', 'var(--text-mid)')}>→ Fiche</Link>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)', gap: 16 }}>
        {/* MAIN COLUMN — Notes + record */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* Quick prospect status pills */}
          <Card title="🎯 Statut prospect">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PROSPECT_STATUS_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setStatus(opt.value === status ? '' : opt.value)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, fontSize: '0.86rem', fontWeight: 600,
                    background: status === opt.value ? opt.color : 'var(--night-mid)',
                    color: status === opt.value ? '#fff' : 'var(--text-mid)',
                    border: `1.5px solid ${status === opt.value ? opt.color : 'var(--border-md)'}`,
                    cursor: 'pointer', transition: 'all .15s',
                  }}>
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Notes editor */}
          <Card
            title="📝 Notes de l'appel"
            action={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {saving ? '💾 …' : savedAt ? `✓ ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'auto-save'}
                </span>
                <button onClick={summarizeWithAI} disabled={summarizing || !notes.trim()} style={{
                  padding: '5px 10px', borderRadius: 6,
                  background: 'rgba(232,105,43,.12)', border: '1px solid rgba(232,105,43,.35)',
                  color: 'var(--orange)', fontSize: '0.72rem', fontWeight: 600,
                  cursor: summarizing || !notes.trim() ? 'wait' : 'pointer', opacity: summarizing || !notes.trim() ? 0.5 : 1,
                }}>
                  {summarizing ? '⏳' : '✨'} Structurer (IA)
                </button>
              </div>
            }
          >
            {/* Record button */}
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {!recording ? (
                <button onClick={startRecording} disabled={transcribing} style={{
                  padding: '12px 18px', borderRadius: 10,
                  background: 'rgba(239,68,68,.12)', border: '1.5px solid rgba(239,68,68,.4)',
                  color: '#FCA5A5', fontSize: '0.9rem', fontWeight: 700, cursor: transcribing ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 8, opacity: transcribing ? 0.6 : 1,
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#EF4444' }} />
                  {transcribing ? '⏳ Transcription…' : '🎙️ Enregistrer (vocal → texte)'}
                </button>
              ) : (
                <button onClick={stopRecording} style={{
                  padding: '12px 18px', borderRadius: 10,
                  background: '#EF4444', border: 'none',
                  color: '#fff', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  animation: 'bm-pulse 1.5s infinite',
                }}>
                  <style>{`@keyframes bm-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }`}</style>
                  ⏹ Arrêter ({Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')})
                </button>
              )}
              {recordError && (
                <span style={{ fontSize: '0.74rem', color: '#FCA5A5' }}>{recordError}</span>
              )}
            </div>

            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Écris ou dicte tes notes ici…"
              rows={14}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.95rem', boxSizing: 'border-box',
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6,
              }}
            />
          </Card>
        </div>

        {/* SIDEBAR — Contact + Qualification */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <Card title="👤 Contact">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <InfoLine icon="🏷️" value={contact?.name || apt.contact_name || apt.opportunity_name || '—'} />
              <InfoLine icon="📧" value={email || '—'} link={email ? `mailto:${email}` : undefined} copyable />
              <InfoLine icon="📱" value={phone || '—'} link={phone ? `tel:${phone}` : undefined} copyable />
              {contact?.companyName && <InfoLine icon="🏢" value={contact.companyName} />}
              {contact?.city && <InfoLine icon="📍" value={contact.city} />}
              {contact?.source && <InfoLine icon="🔗" value={`Source : ${contact.source}`} />}
            </div>
            {contact?.tags && contact.tags.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {contact.tags.map((t, i) => (
                  <span key={i} style={{
                    fontSize: '0.68rem', padding: '2px 8px', borderRadius: 999,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text-muted)',
                  }}>#{t}</span>
                ))}
              </div>
            )}
          </Card>

          <Card title="🎯 Qualification">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PRIORITY_LABELS.map(label => {
                const found = contact?.customFields.find(cf => {
                  const n = norm(cf.label);
                  const t = norm(label);
                  return n === t || n.includes(t) || t.includes(n);
                });
                return (
                  <div key={label} style={{
                    padding: '7px 9px', borderRadius: 6,
                    background: found ? 'var(--night-mid)' : 'transparent',
                    border: `1px solid ${found ? 'rgba(232,105,43,.25)' : 'var(--border)'}`,
                    opacity: found ? 1 : 0.5,
                  }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: found ? 'var(--text)' : 'var(--text-muted)', wordBreak: 'break-word', fontStyle: found ? 'normal' : 'italic' }}>
                      {found ? (Array.isArray(found.value) ? found.value.join(', ') : String(found.value)) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function InfoLine({ icon, value, link, copyable }: { icon: string; value: string; link?: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (value === '—') return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  }
  const inner = (
    <>
      <span aria-hidden style={{ marginRight: 8, fontSize: '0.9rem' }}>{icon}</span>
      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      {copyable && value !== '—' && (
        <button onClick={(e) => { e.preventDefault(); copy(); }} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: copied ? 'var(--green)' : 'var(--text-muted)', fontSize: '0.78rem', padding: 2,
        }}>{copied ? '✓' : '📋'}</button>
      )}
    </>
  );
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center',
    fontSize: '0.84rem', textDecoration: 'none',
  };
  return link ? <a href={link} style={style}>{inner}</a> : <div style={style}>{inner}</div>;
}

function btnLg(bg: string, color = '#fff'): React.CSSProperties {
  return {
    padding: '10px 14px', borderRadius: 10, background: bg,
    border: bg === 'var(--night-card)' ? '1px solid var(--border-md)' : 'none',
    color, textDecoration: 'none', fontSize: '0.86rem', fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
  };
}
