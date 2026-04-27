'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Action = 'generate_script' | 'summarize_call' | 'suggest_next_action' | 'draft_message';

interface ActionMeta {
  emoji: string;
  label: string;
  description: string;
}

const ACTIONS: Record<Action, ActionMeta> = {
  generate_script: {
    emoji: '✍️',
    label: 'Générer un script V1',
    description: 'Rédige une première version de script (Hook + Corps + CTA) à partir des infos du commerce.',
  },
  summarize_call: {
    emoji: '📞',
    label: "Résumer un appel",
    description: 'Structure tes notes brutes : synthèse, points clés, objections, prochaine action.',
  },
  suggest_next_action: {
    emoji: '🎯',
    label: 'Que faire avec ce prospect ?',
    description: 'Analyse la situation et suggère la meilleure action commerciale + un brouillon de message.',
  },
  draft_message: {
    emoji: '💬',
    label: 'Brouillon de message',
    description: 'Rédige un WhatsApp / email / SMS pour follow-up, relance, remerciement…',
  },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function AiCopilot() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Form fields (un état par action)
  const [scriptForm, setScriptForm] = useState({ business_name: '', category: '', city: '', usp: '', target_audience: '', desired_tone: '', duration_seconds: 30, custom_brief: '' });
  const [callForm, setCallForm] = useState({ raw_notes: '', contact_name: '', business_name: '', appointment_kind: '' });
  const [opportunityForm, setOpportunityForm] = useState({ business_name: '', contact_name: '', prospect_status: '', last_note: '', monetary_value_eur: '', days_in_stage: '' });
  const [messageForm, setMessageForm] = useState({ contact_name: '', business_name: '', intent: 'follow_up' as const, channel: 'whatsapp' as const, context_notes: '' });

  // Toggle via Cmd+J / Ctrl+J
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setCopied(false);
  }, []);

  function pickAction(a: Action) {
    setAction(a);
    reset();
  }

  async function run() {
    if (!action) return;
    setBusy(true); reset();
    let payload: Record<string, unknown> = {};
    if (action === 'generate_script') payload = { ...scriptForm, duration_seconds: Number(scriptForm.duration_seconds) || 30 };
    if (action === 'summarize_call') payload = callForm;
    if (action === 'suggest_next_action') payload = {
      ...opportunityForm,
      monetary_value_eur: opportunityForm.monetary_value_eur ? Number(opportunityForm.monetary_value_eur) : null,
      days_in_stage: opportunityForm.days_in_stage ? Number(opportunityForm.days_in_stage) : null,
    };
    if (action === 'draft_message') payload = messageForm;

    try {
      const r = await fetch('/api/ai/copilot', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ action, payload }),
      });
      const d = await r.json();
      if (r.ok) setResult(d.text || '');
      else setError(d.error || `HTTP ${r.status}`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      {/* Floating launcher button — z-index assez haut pour rester visible
          au-dessus des contenus, sauf modals plein-écran (qui sont 1000+).
          On utilise calc + env(safe-area-inset-bottom) pour iPhone home bar. */}
      <button
        onClick={() => setOpen(true)}
        title="AI Co-Pilot Bourbon · ⌘J"
        aria-label="Ouvrir AI Co-Pilot"
        style={{
          position: 'fixed',
          bottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          right: 16,
          zIndex: 500,
          width: 60, height: 60, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--orange) 0%, #C45520 100%)',
          border: '2px solid rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer',
          fontSize: '1.5rem',
          boxShadow: '0 8px 24px rgba(232,105,43,.5), 0 0 0 0 rgba(232,105,43,.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform .2s, box-shadow .2s',
          animation: 'bm-copilot-pulse 3s ease-in-out infinite',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(232,105,43,.7)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(232,105,43,.5), 0 0 0 0 rgba(232,105,43,.3)'; }}
      >
        <style>{`@keyframes bm-copilot-pulse {
          0%, 100% { box-shadow: 0 8px 24px rgba(232,105,43,.5), 0 0 0 0 rgba(232,105,43,.4); }
          50%      { box-shadow: 0 8px 24px rgba(232,105,43,.5), 0 0 0 12px rgba(232,105,43,0); }
        }`}</style>
        <span aria-hidden style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>✨</span>
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
            backdropFilter: 'blur(3px)', zIndex: 1100,
          }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1101,
            width: 'min(560px, 100vw)', background: 'var(--night-card)',
            borderLeft: '1px solid var(--border-md)',
            display: 'flex', flexDirection: 'column',
            boxShadow: '-12px 0 40px rgba(0,0,0,.45)',
            animation: 'bm-slide-in-right .2s ease-out',
          }}>
            <style>{`@keyframes bm-slide-in-right { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

            {/* Header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            }}>
              <div>
                <h2 style={{
                  fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', margin: 0,
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span aria-hidden>✨</span> AI Co-Pilot
                </h2>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  Powered by Claude · ⌘J pour ouvrir/fermer
                </p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Fermer" style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {!action ? (
                <ActionPicker onPick={pickAction} />
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <button onClick={() => { setAction(null); reset(); }} style={{
                      background: 'transparent', border: '1px solid var(--border-md)',
                      borderRadius: 6, padding: '4px 10px', color: 'var(--text-muted)',
                      cursor: 'pointer', fontSize: '0.74rem',
                    }}>← Retour</button>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
                      {ACTIONS[action].emoji} {ACTIONS[action].label}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 14px' }}>
                    {ACTIONS[action].description}
                  </p>

                  {action === 'generate_script' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Field label="Nom du commerce *" value={scriptForm.business_name} onChange={v => setScriptForm({ ...scriptForm, business_name: v })} required />
                      <FieldRow>
                        <Field label="Catégorie" value={scriptForm.category} onChange={v => setScriptForm({ ...scriptForm, category: v })} placeholder="Boulangerie, restaurant…" />
                        <Field label="Ville" value={scriptForm.city} onChange={v => setScriptForm({ ...scriptForm, city: v })} placeholder="Saint-Denis" />
                      </FieldRow>
                      <Field label="USP / différenciateur" value={scriptForm.usp} onChange={v => setScriptForm({ ...scriptForm, usp: v })} placeholder="Pain au levain, ouvert 24h…" />
                      <FieldRow>
                        <Field label="Cible" value={scriptForm.target_audience} onChange={v => setScriptForm({ ...scriptForm, target_audience: v })} placeholder="Famille, étudiants…" />
                        <Field label="Ton" value={scriptForm.desired_tone} onChange={v => setScriptForm({ ...scriptForm, desired_tone: v })} placeholder="Chaleureux, fun…" />
                      </FieldRow>
                      <Field label="Durée (s)" value={String(scriptForm.duration_seconds)} onChange={v => setScriptForm({ ...scriptForm, duration_seconds: Number(v) || 30 })} type="number" />
                      <Field label="Brief libre (optionnel)" value={scriptForm.custom_brief} onChange={v => setScriptForm({ ...scriptForm, custom_brief: v })} multiline placeholder="Promo en cours, événement, mood spécifique…" />
                    </div>
                  )}

                  {action === 'summarize_call' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <FieldRow>
                        <Field label="Contact" value={callForm.contact_name} onChange={v => setCallForm({ ...callForm, contact_name: v })} />
                        <Field label="Commerce" value={callForm.business_name} onChange={v => setCallForm({ ...callForm, business_name: v })} />
                      </FieldRow>
                      <Field label="Type d'appel" value={callForm.appointment_kind} onChange={v => setCallForm({ ...callForm, appointment_kind: v })} placeholder="Closing, onboarding, suivi…" />
                      <Field label="Notes brutes *" value={callForm.raw_notes} onChange={v => setCallForm({ ...callForm, raw_notes: v })} multiline rows={8} placeholder="Tape tout ce qui s'est dit, en vrac. Pas besoin de structure." required />
                    </div>
                  )}

                  {action === 'suggest_next_action' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <FieldRow>
                        <Field label="Commerce *" value={opportunityForm.business_name} onChange={v => setOpportunityForm({ ...opportunityForm, business_name: v })} required />
                        <Field label="Contact" value={opportunityForm.contact_name} onChange={v => setOpportunityForm({ ...opportunityForm, contact_name: v })} />
                      </FieldRow>
                      <FieldRow>
                        <Field label="Statut prospect" value={opportunityForm.prospect_status} onChange={v => setOpportunityForm({ ...opportunityForm, prospect_status: v })} placeholder="reflection, follow_up, ghosting…" />
                        <Field label="Jours dans stage" value={opportunityForm.days_in_stage} onChange={v => setOpportunityForm({ ...opportunityForm, days_in_stage: v })} type="number" />
                      </FieldRow>
                      <Field label="Valeur estimée (€)" value={opportunityForm.monetary_value_eur} onChange={v => setOpportunityForm({ ...opportunityForm, monetary_value_eur: v })} type="number" />
                      <Field label="Dernière note d'appel" value={opportunityForm.last_note} onChange={v => setOpportunityForm({ ...opportunityForm, last_note: v })} multiline rows={4} placeholder="Ce que vous saviez du prospect après le dernier contact" />
                    </div>
                  )}

                  {action === 'draft_message' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <ContactAutocomplete
                        contactName={messageForm.contact_name}
                        businessName={messageForm.business_name}
                        onPick={(c) => setMessageForm({
                          ...messageForm,
                          contact_name: c.contact_name || messageForm.contact_name,
                          business_name: c.business_name || messageForm.business_name,
                        })}
                        onContactChange={v => setMessageForm({ ...messageForm, contact_name: v })}
                        onBusinessChange={v => setMessageForm({ ...messageForm, business_name: v })}
                      />
                      <FieldRow>
                        <SelectField label="Intention" value={messageForm.intent} onChange={v => setMessageForm({ ...messageForm, intent: v as typeof messageForm.intent })} options={[
                          { value: 'follow_up', label: 'Follow-up appel' },
                          { value: 'send_script_link', label: 'Script prêt à valider' },
                          { value: 'thank_after_payment', label: 'Merci après paiement' },
                          { value: 'reminder_filming', label: 'Rappel tournage' },
                          { value: 'reactivation', label: 'Réactivation prospect' },
                          { value: 'custom', label: 'Custom (préciser)' },
                        ]} />
                        <SelectField label="Canal" value={messageForm.channel} onChange={v => setMessageForm({ ...messageForm, channel: v as typeof messageForm.channel })} options={[
                          { value: 'whatsapp', label: '💬 WhatsApp' },
                          { value: 'email', label: '📧 Email' },
                          { value: 'sms', label: '📱 SMS' },
                        ]} />
                      </FieldRow>
                      <Field label="Contexte additionnel" value={messageForm.context_notes} onChange={v => setMessageForm({ ...messageForm, context_notes: v })} multiline rows={4} placeholder="Tout détail utile : ce qu'on s'est dit, son budget, ses objections…" />
                    </div>
                  )}

                  {/* Action button */}
                  <button onClick={run} disabled={busy} style={{
                    marginTop: 14, width: '100%', padding: '12px 16px', borderRadius: 10,
                    background: busy ? 'var(--text-muted)' : 'var(--orange)',
                    border: 'none', color: '#fff', fontSize: '0.9rem', fontWeight: 700,
                    cursor: busy ? 'wait' : 'pointer',
                  }}>
                    {busy ? '⏳ Claude réfléchit…' : `✨ Générer`}
                  </button>

                  {/* Result */}
                  {error && (
                    <div style={{
                      marginTop: 14, padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)',
                      fontSize: '0.82rem', color: '#FCA5A5',
                    }}>✕ {error}</div>
                  )}
                  {result && (
                    <div style={{
                      marginTop: 14, padding: 14, borderRadius: 10,
                      background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginBottom: 10, gap: 8,
                      }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          ✨ Réponse Claude
                        </span>
                        <button onClick={copy} style={{
                          padding: '4px 10px', borderRadius: 6,
                          background: copied ? 'rgba(34,197,94,.15)' : 'var(--night-raised)',
                          border: `1px solid ${copied ? 'rgba(34,197,94,.4)' : 'var(--border-md)'}`,
                          color: copied ? 'var(--green)' : 'var(--text-mid)',
                          cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
                        }}>{copied ? '✓ Copié' : '📋 Copier'}</button>
                      </div>
                      <div style={{
                        fontSize: '0.86rem', color: 'var(--text)', lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>{result}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ActionPicker({ onPick }: { onPick: (a: Action) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
        Que veux-tu faire ?
      </p>
      {(Object.keys(ACTIONS) as Action[]).map(a => {
        const meta = ACTIONS[a];
        return (
          <button key={a} onClick={() => onPick(a)} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '14px 16px', borderRadius: 12,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            cursor: 'pointer', textAlign: 'left', color: 'inherit',
            transition: 'all .15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-orange)'; e.currentTarget.style.background = 'var(--night-raised)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-md)'; e.currentTarget.style.background = 'var(--night-mid)'; }}
          >
            <span aria-hidden style={{ fontSize: '1.5rem', flexShrink: 0 }}>{meta.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                {meta.label}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {meta.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, rows, type, required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; rows?: number; type?: string; required?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: 'var(--orange)', marginLeft: 3 }}>*</span>}
      </span>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows || 3} style={inputStyle} />
      ) : (
        <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      )}
    </label>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 11px', borderRadius: 7,
  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
  color: 'var(--text)', fontSize: '0.84rem', boxSizing: 'border-box',
  fontFamily: 'inherit', resize: 'vertical', width: '100%',
};

interface ContactSuggestion {
  id: string;
  type: 'client' | 'prospect';
  contact_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
}

function ContactAutocomplete({
  contactName, businessName, onPick, onContactChange, onBusinessChange,
}: {
  contactName: string;
  businessName: string;
  onPick: (c: ContactSuggestion) => void;
  onContactChange: (v: string) => void;
  onBusinessChange: (v: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState<'contact' | 'business' | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/contacts/lookup?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setSuggestions(d.contacts || []);
        setOpen((d.contacts || []).length > 0);
      }
    } finally { setLoading(false); }
  }, []);

  // Debounce 200ms sur les changements de champ actif
  useEffect(() => {
    const q = activeField === 'contact' ? contactName : activeField === 'business' ? businessName : '';
    if (!activeField) return;
    const t = setTimeout(() => search(q), 200);
    return () => clearTimeout(t);
  }, [contactName, businessName, activeField, search]);

  // Close dropdown au clic en dehors
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function handlePick(c: ContactSuggestion) {
    onPick(c);
    setOpen(false);
    setActiveField(null);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Contact <span style={{ color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400, marginLeft: 4 }}>(2 lettres min)</span>
          </span>
          <input
            type="text"
            value={contactName}
            onChange={e => { onContactChange(e.target.value); setActiveField('contact'); }}
            onFocus={() => { setActiveField('contact'); if (contactName.length >= 2) search(contactName); }}
            placeholder="Tape un prénom, nom ou email…"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Commerce
          </span>
          <input
            type="text"
            value={businessName}
            onChange={e => { onBusinessChange(e.target.value); setActiveField('business'); }}
            onFocus={() => { setActiveField('business'); if (businessName.length >= 2) search(businessName); }}
            placeholder="Nom du commerce"
            style={inputStyle}
          />
        </label>
      </div>

      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          marginTop: 4, padding: 4, borderRadius: 10,
          background: 'var(--night-card)', border: '1px solid var(--border-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {loading && (
            <div style={{ padding: 10, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Recherche…
            </div>
          )}
          {suggestions.map(s => (
            <button
              key={`${s.type}-${s.id}`}
              type="button"
              onClick={() => handlePick(s)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                width: '100%', padding: '8px 10px', borderRadius: 6,
                background: 'transparent', border: 'none', textAlign: 'left',
                cursor: 'pointer', color: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem',
                color: 'var(--text)', fontWeight: 600,
              }}>
                <span aria-hidden style={{
                  fontSize: '0.66rem', padding: '1px 6px', borderRadius: 4,
                  background: s.type === 'client' ? 'rgba(34,197,94,.15)' : 'rgba(20,184,166,.15)',
                  color: s.type === 'client' ? 'var(--green)' : '#14B8A6',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{s.type === 'client' ? 'Client' : 'Prospect'}</span>
                {s.contact_name || '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {s.business_name && <span style={{ color: 'var(--orange)' }}>🏢 {s.business_name}</span>}
                {s.business_name && (s.email || s.phone) && ' · '}
                {s.email && <span>📧 {s.email}</span>}
                {s.email && s.phone && ' · '}
                {s.phone && <span>📱 {s.phone}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
