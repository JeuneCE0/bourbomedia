'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';

type Action = 'generate_script' | 'summarize_call' | 'suggest_next_action' | 'draft_message';

interface ContextHint {
  scope: 'client' | 'closing' | 'opportunity' | 'none';
  id: string;
  business_name?: string | null;
  contact_name?: string | null;
  category?: string | null;
  city?: string | null;
  prospect_status?: string | null;
  last_note?: string | null;
  source_label?: string;
}

interface HistoryEntry {
  id: string;
  action: Action;
  payload: Record<string, unknown>;
  result: string;
  ts: number;
}

const HISTORY_KEY = 'bbm_copilot_history_v1';
const MAX_HISTORY = 10;

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveHistory(items: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch { /* */ }
}

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
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [autoContext, setAutoContext] = useState<ContextHint | null>(null);
  const lastFocusedTextareaRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  // Form fields (un état par action)
  const [scriptForm, setScriptForm] = useState({ business_name: '', category: '', city: '', usp: '', target_audience: '', desired_tone: '', duration_seconds: 30, custom_brief: '' });
  const [callForm, setCallForm] = useState({ raw_notes: '', contact_name: '', business_name: '', appointment_kind: '' });
  const [opportunityForm, setOpportunityForm] = useState({ business_name: '', contact_name: '', prospect_status: '', last_note: '', monetary_value_eur: '', days_in_stage: '' });
  const [messageForm, setMessageForm] = useState({ contact_name: '', business_name: '', intent: 'follow_up' as const, channel: 'whatsapp' as const, context_notes: '' });

  // Track le dernier textarea/input cliqué pour le bouton 'Insérer ici'
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')) {
        lastFocusedTextareaRef.current = t as HTMLTextAreaElement | HTMLInputElement;
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  // Detect le contexte de la page courante quand on ouvre le drawer.
  useEffect(() => {
    if (!open) return;
    setHistory(loadHistory());
    detectContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pathname]);

  async function detectContext() {
    if (!pathname) { setAutoContext(null); return; }
    // /dashboard/clients/[id]
    const clientMatch = pathname.match(/\/dashboard\/clients\/([0-9a-f-]+)/);
    if (clientMatch) {
      try {
        const r = await fetch(`/api/clients?id=${clientMatch[1]}`, { headers: authHeaders() });
        if (r.ok) {
          const c = await r.json();
          setAutoContext({
            scope: 'client',
            id: clientMatch[1],
            business_name: c?.business_name,
            contact_name: c?.contact_name,
            category: c?.category,
            city: c?.city,
            source_label: 'Fiche client',
          });
          return;
        }
      } catch { /* */ }
    }
    // /dashboard/closing/[appointmentId]
    const closingMatch = pathname.match(/\/dashboard\/closing\/([0-9a-f-]+)/);
    if (closingMatch) {
      try {
        const r = await fetch(`/api/gh-appointments?id=${closingMatch[1]}`, { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          const a = (d.appointments || [])[0];
          if (a) {
            setAutoContext({
              scope: 'closing',
              id: closingMatch[1],
              business_name: a.opportunity_name,
              contact_name: a.contact_name,
              prospect_status: a.prospect_status,
              last_note: a.notes,
              source_label: `Closing Room — ${a.calendar_kind}`,
            });
            return;
          }
        }
      } catch { /* */ }
    }
    setAutoContext(null);
  }

  // Quand on choisit une action, pré-remplit le form avec le contexte détecté
  function applyContextToForm(actionKey: Action) {
    if (!autoContext) return;
    const c = autoContext;
    if (actionKey === 'generate_script') {
      setScriptForm(prev => ({
        ...prev,
        business_name: c.business_name || prev.business_name,
        category: c.category || prev.category,
        city: c.city || prev.city,
      }));
    } else if (actionKey === 'summarize_call') {
      setCallForm(prev => ({
        ...prev,
        contact_name: c.contact_name || prev.contact_name,
        business_name: c.business_name || prev.business_name,
        appointment_kind: c.scope === 'closing' ? 'Closing' : prev.appointment_kind,
      }));
    } else if (actionKey === 'suggest_next_action') {
      setOpportunityForm(prev => ({
        ...prev,
        business_name: c.business_name || prev.business_name,
        contact_name: c.contact_name || prev.contact_name,
        prospect_status: c.prospect_status || prev.prospect_status,
        last_note: c.last_note || prev.last_note,
      }));
    } else if (actionKey === 'draft_message') {
      setMessageForm(prev => ({
        ...prev,
        contact_name: c.contact_name || prev.contact_name,
        business_name: c.business_name || prev.business_name,
      }));
    }
  }

  function insertIntoFocusedField() {
    if (!result) return;
    const target = lastFocusedTextareaRef.current;
    if (!target) {
      // Fallback: copy to clipboard
      copy();
      return;
    }
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const before = target.value.slice(0, start);
    const after = target.value.slice(end);
    const next = before + result + after;
    // Use native setter to trigger React onChange
    const setter = Object.getOwnPropertyDescriptor(
      target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    if (setter) setter.call(target, next);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
    target.selectionStart = target.selectionEnd = start + result.length;
    setOpen(false);
  }

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
    // Pré-remplit avec le contexte détecté si dispo
    applyContextToForm(a);
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
      if (r.ok) {
        const text = d.text || '';
        setResult(text);
        // Save to history (capped 10)
        if (text.trim().length > 0) {
          const entry: HistoryEntry = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: action!,
            payload,
            result: text,
            ts: Date.now(),
          };
          const next = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
          saveHistory(next);
          setHistory(next);
        }
      } else setError(d.error || `HTTP ${r.status}`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  function loadFromHistory(h: HistoryEntry) {
    setAction(h.action);
    setShowHistory(false);
    setResult(h.result);
    setError(null);
    // Restore form fields from payload
    const p = h.payload as Record<string, unknown>;
    if (h.action === 'generate_script') setScriptForm(prev => ({ ...prev, ...p as typeof scriptForm }));
    if (h.action === 'summarize_call') setCallForm(prev => ({ ...prev, ...p as typeof callForm }));
    if (h.action === 'suggest_next_action') setOpportunityForm(prev => ({
      ...prev,
      ...p as Partial<typeof opportunityForm>,
      monetary_value_eur: typeof p.monetary_value_eur === 'number' ? String(p.monetary_value_eur) : (typeof p.monetary_value_eur === 'string' ? p.monetary_value_eur : ''),
      days_in_stage: typeof p.days_in_stage === 'number' ? String(p.days_in_stage) : (typeof p.days_in_stage === 'string' ? p.days_in_stage : ''),
    }));
    if (h.action === 'draft_message') setMessageForm(prev => ({ ...prev, ...p as typeof messageForm }));
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
          right: 'max(16px, env(safe-area-inset-right))',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setShowHistory(s => !s)} title="Historique des dernières générations" style={{
                  background: showHistory ? 'rgba(232,105,43,.15)' : 'transparent',
                  border: '1px solid var(--border-md)', color: showHistory ? 'var(--orange)' : 'var(--text-muted)',
                  fontSize: '0.74rem', cursor: 'pointer', padding: '4px 10px', borderRadius: 6,
                }}>📜 Historique{history.length > 0 ? ` (${history.length})` : ''}</button>
                <button onClick={() => setOpen(false)} aria-label="Fermer" style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1, marginLeft: 4,
                }}>×</button>
              </div>
            </div>

            {/* Auto-context banner */}
            {autoContext && autoContext.scope !== 'none' && !showHistory && (
              <div style={{
                margin: '12px 20px 0', padding: '10px 12px', borderRadius: 10,
                background: 'rgba(20,184,166,.08)', border: '1px solid rgba(20,184,166,.3)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span aria-hidden style={{ fontSize: '1.1rem' }}>🎯</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    Contexte détecté · {autoContext.source_label}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600 }}>
                    {autoContext.business_name || autoContext.contact_name || '—'}
                  </div>
                </div>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                  Auto-rempli au choix d&apos;une action
                </span>
              </div>
            )}

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {showHistory ? (
                <HistoryPanel
                  items={history}
                  onPick={loadFromHistory}
                  onClear={() => { saveHistory([]); setHistory([]); }}
                />
              ) : !action ? (
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
                      <ContactAutocomplete
                        value={scriptForm.business_name}
                        onChange={v => setScriptForm({ ...scriptForm, business_name: v })}
                        onPick={(c) => setScriptForm({
                          ...scriptForm,
                          business_name: c.business_name || c.contact_name || '',
                        })}
                        label="Contact"
                        placeholder="Tape un prénom, nom ou email…"
                        required
                      />
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
                      <ContactAutocomplete
                        value={callForm.contact_name}
                        onChange={v => setCallForm({ ...callForm, contact_name: v })}
                        onPick={(c) => setCallForm({
                          ...callForm,
                          contact_name: c.contact_name || c.business_name || '',
                          business_name: c.business_name || '',
                        })}
                      />
                      <Field label="Type d'appel" value={callForm.appointment_kind} onChange={v => setCallForm({ ...callForm, appointment_kind: v })} placeholder="Closing, onboarding, suivi…" />
                      <NotesWithRecorder
                        label="Notes brutes"
                        value={callForm.raw_notes}
                        onChange={v => setCallForm({ ...callForm, raw_notes: v })}
                        placeholder="Tape ou dicte tout ce qui s'est dit, en vrac. Pas besoin de structure."
                        required
                      />
                    </div>
                  )}

                  {action === 'suggest_next_action' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <ContactAutocomplete
                        value={opportunityForm.contact_name}
                        onChange={v => setOpportunityForm({ ...opportunityForm, contact_name: v })}
                        onPick={(c) => setOpportunityForm({
                          ...opportunityForm,
                          contact_name: c.contact_name || c.business_name || '',
                          business_name: c.business_name || '',
                        })}
                        required
                      />
                      <FieldRow>
                        <Field label="Statut prospect" value={opportunityForm.prospect_status} onChange={v => setOpportunityForm({ ...opportunityForm, prospect_status: v })} placeholder="reflection, follow_up, ghosting…" />
                        <Field label="Jours dans stage" value={opportunityForm.days_in_stage} onChange={v => setOpportunityForm({ ...opportunityForm, days_in_stage: v })} type="number" />
                      </FieldRow>
                      <Field label="Valeur estimée (€)" value={opportunityForm.monetary_value_eur} onChange={v => setOpportunityForm({ ...opportunityForm, monetary_value_eur: v })} type="number" />
                      <NotesWithRecorder
                        label="Dernière note d'appel (optionnel — vocal possible)"
                        value={opportunityForm.last_note}
                        onChange={v => setOpportunityForm({ ...opportunityForm, last_note: v })}
                        placeholder="Ce que vous saviez du prospect après le dernier contact"
                        rows={4}
                      />
                    </div>
                  )}

                  {action === 'draft_message' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <ContactAutocomplete
                        value={messageForm.contact_name}
                        onChange={v => setMessageForm({ ...messageForm, contact_name: v })}
                        onPick={(c) => setMessageForm({
                          ...messageForm,
                          contact_name: c.contact_name || c.business_name || '',
                          business_name: c.business_name || '',
                        })}
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
                        marginBottom: 10, gap: 8, flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          ✨ Réponse Claude
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {lastFocusedTextareaRef.current && (
                            <button onClick={insertIntoFocusedField} title="Insérer dans le dernier champ utilisé" style={{
                              padding: '4px 10px', borderRadius: 6,
                              background: 'var(--orange)', border: 'none', color: '#fff',
                              cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700,
                            }}>↵ Insérer ici</button>
                          )}
                          <button onClick={copy} style={{
                            padding: '4px 10px', borderRadius: 6,
                            background: copied ? 'rgba(34,197,94,.15)' : 'var(--night-raised)',
                            border: `1px solid ${copied ? 'rgba(34,197,94,.4)' : 'var(--border-md)'}`,
                            color: copied ? 'var(--green)' : 'var(--text-mid)',
                            cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
                          }}>{copied ? '✓ Copié' : '📋 Copier'}</button>
                        </div>
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

function HistoryPanel({ items, onPick, onClear }: { items: HistoryEntry[]; onPick: (h: HistoryEntry) => void; onClear: () => void }) {
  if (items.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>📜</div>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          Aucune génération encore. Tes 10 dernières seront sauvegardées ici.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, gap: 8,
      }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {items.length} génération{items.length > 1 ? 's' : ''} récente{items.length > 1 ? 's' : ''}
        </span>
        <button onClick={() => { if (confirm('Vider tout l\'historique ?')) onClear(); }} style={{
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline', padding: 0,
        }}>Vider</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(h => {
          const meta = ACTIONS[h.action];
          const ago = Math.floor((Date.now() - h.ts) / 60000);
          const agoLabel = ago < 1 ? "à l'instant" : ago < 60 ? `il y a ${ago} min` : `il y a ${Math.floor(ago / 60)} h`;
          return (
            <button key={h.id} onClick={() => onPick(h)} style={{
              padding: '10px 12px', borderRadius: 8, textAlign: 'left',
              background: 'var(--night-mid)', border: '1px solid var(--border)',
              cursor: 'pointer', color: 'inherit',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-orange)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.74rem' }}>
                <span aria-hidden>{meta.emoji}</span>
                <strong style={{ color: 'var(--text)' }}>{meta.label}</strong>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.66rem' }}>{agoLabel}</span>
              </div>
              <div style={{
                fontSize: '0.78rem', color: 'var(--text-mid)', lineHeight: 1.4,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
              }}>
                {h.result.slice(0, 200)}{h.result.length > 200 ? '…' : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
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

// Textarea avec bouton 🎙️ pour dicter le contenu (Whisper via /api/ai/transcribe).
// Audio level meter live + garde-fou silence côté client.
function NotesWithRecorder({
  label, value, onChange, placeholder, rows = 8, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; rows?: number; required?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [maxLevelSeen, setMaxLevelSeen] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const startTsRef = useRef(0);

  async function start() {
    setError(null);
    setMaxLevelSeen(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      try {
        type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };
        const Ctor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const lvl = Math.min(100, Math.round(Math.sqrt(sum / data.length) * 250));
            setAudioLevel(lvl);
            setMaxLevelSeen(prev => Math.max(prev, lvl));
            meterRafRef.current = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch { /* meter optionnel */ }

      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = onStopHandler;
      mr.start(1000);
      mediaRecorderRef.current = mr;
      setRecording(true);
      startTsRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTsRef.current) / 1000)), 500);
    } catch (e: unknown) {
      setError((e as Error).message || 'Permission micro refusée');
    }
  }

  function stop() {
    if (mediaRecorderRef.current && recording) mediaRecorderRef.current.stop();
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (meterRafRef.current) { cancelAnimationFrame(meterRafRef.current); meterRafRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => null); audioCtxRef.current = null; }
    setRecording(false);
    setAudioLevel(0);
  }

  async function onStopHandler() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];

    if (maxLevelSeen < 5) {
      setError(`Aucun son détecté (max ${maxLevelSeen}/100). Vérifie ton micro.`);
      return;
    }

    setTranscribing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('audio', blob, `recording-${Date.now()}.webm`);
      fd.append('language', 'fr');
      const r = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('bbp_token')}` },
        body: fd,
      });
      const d = await r.json();
      if (r.ok && d.text) {
        const stamp = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const block = `[Vocal ${stamp}] ${d.text}`;
        onChange(value.trim() ? `${value}\n\n${block}` : block);
      } else if (d.empty) {
        setError(d.hint || 'Audio trop faible.');
      } else {
        setError(d.error || 'Transcription échouée.');
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setTranscribing(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1, minWidth: 100 }}>
          {label}{required && <span style={{ color: 'var(--orange)', marginLeft: 3 }}>*</span>}
        </span>
        {!recording ? (
          <button type="button" onClick={start} disabled={transcribing} style={{
            padding: '5px 11px', borderRadius: 7,
            background: transcribing ? 'var(--night-mid)' : 'rgba(239,68,68,.1)',
            border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5',
            fontSize: '0.74rem', fontWeight: 700, cursor: transcribing ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5, opacity: transcribing ? 0.6 : 1,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#EF4444' }} />
            {transcribing ? 'Transcription…' : '🎙️ Dicter'}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={stop} style={{
              padding: '5px 11px', borderRadius: 7, background: '#EF4444',
              border: 'none', color: '#fff', fontSize: '0.74rem', fontWeight: 700,
              cursor: 'pointer', animation: 'bm-pulse 1.5s infinite',
            }}>
              <style>{`@keyframes bm-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }`}</style>
              ⏹ Arrêter ({Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')})
            </button>
            <div style={{ width: 70, height: 8, borderRadius: 4, background: 'var(--night-mid)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${audioLevel}%`,
                background: audioLevel < 5 ? '#EF4444' : audioLevel < 20 ? '#F97316' : '#22C55E',
                transition: 'width 80ms ease-out',
              }} />
            </div>
          </div>
        )}
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={inputStyle}
      />
      {error && (
        <div style={{
          padding: '6px 9px', borderRadius: 6, fontSize: '0.74rem',
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: '#FCA5A5',
        }}>⚠️ {error}</div>
      )}
    </div>
  );
}

interface ContactSuggestion {
  id: string;
  type: 'client' | 'prospect';
  contact_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
}

// Single-field contact lookup. Sous le capot : remplit aussi le business_name
// du parent (pour qu'il soit envoyé à l'IA), mais c'est invisible côté UX.
// Préfille via la sélection ; l'utilisateur peut aussi taper un contact qui
// n'existe pas encore (free text → submit comme contact_name uniquement).
function ContactAutocomplete({
  value, onChange, onPick, label = 'Contact', placeholder = 'Tape un prénom, nom ou email…', required,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (c: ContactSuggestion) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLLabelElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
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

  // Debounce 200ms sur changement de valeur (uniquement quand focused)
  useEffect(() => {
    if (!focused) return;
    const t = setTimeout(() => search(value), 200);
    return () => clearTimeout(t);
  }, [value, focused, search]);

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
    onChange(c.contact_name || c.business_name || value);
    setOpen(false);
  }

  return (
    <label ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: 'var(--orange)', marginLeft: 3 }}>*</span>}
        <span style={{ color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400, marginLeft: 6 }}>(2 lettres min)</span>
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { setFocused(true); if (value.length >= 2) search(value); }}
        onBlur={() => { setTimeout(() => setFocused(false), 200); }}
        placeholder={placeholder}
        style={inputStyle}
      />

      {open && (suggestions.length > 0 || loading) && (
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
                {s.contact_name || s.business_name || '—'}
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
    </label>
  );
}
