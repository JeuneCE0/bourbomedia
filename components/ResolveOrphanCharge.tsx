'use client';

import { useState } from 'react';

export interface OrphanCharge {
  charge_id: string;
  payment_intent_id: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  amount_eur: number;
  currency: string;
  created_at: string;
  description: string | null;
  receipt_url: string | null;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

/**
 * Modal pour résoudre un paiement Stripe orphelin (sans client correspondant).
 * Crée un client local depuis les billing details Stripe + insère le payment.
 */
export default function ResolveOrphanCharge({
  orphan, onResolved, onClose,
}: {
  orphan: OrphanCharge;
  onResolved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    business_name: orphan.name || orphan.email || 'Client',
    contact_name: orphan.name || '',
    email: orphan.email || '',
    phone: orphan.phone || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!form.business_name.trim() || !form.email.trim()) {
      setError('Nom et email obligatoires');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 1. Créer le client local
      const cR = await fetch('/api/clients', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          contact_name: form.contact_name.trim() || form.business_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          status: 'onboarding',
          notes: `Client créé manuellement depuis le paiement Stripe ${orphan.charge_id} (${orphan.amount_eur} €).`,
        }),
      });
      if (!cR.ok) {
        const d = await cR.json().catch(() => ({}));
        setError(d.error || 'Création client échouée');
        return;
      }
      const newClient = await cR.json();

      // 2. Insérer le payment lié
      const amountCents = Math.round(orphan.amount_eur * 100);
      const pR = await fetch('/api/payments', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          client_id: newClient.id,
          amount: amountCents,
          currency: orphan.currency,
          status: 'completed',
          description: orphan.description || 'Paiement Stripe (rattaché manuellement)',
          stripe_payment_intent: orphan.payment_intent_id,
          stripe_session_id: null,
          receipt_url: orphan.receipt_url,
        }),
      });
      if (!pR.ok) {
        const d = await pR.json().catch(() => ({}));
        setError(`Client créé mais paiement non enregistré : ${d.error || 'erreur'}`);
        return;
      }

      setDone(true);
      setTimeout(() => {
        onResolved();
        onClose();
      }, 1200);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setSubmitting(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
        backdropFilter: 'blur(3px)', zIndex: 1500,
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 1501, width: 'min(540px, calc(100vw - 32px))',
        maxHeight: '85vh', overflowY: 'auto',
        background: 'var(--night-card)', borderRadius: 14,
        border: '1px solid var(--border-md)',
        boxShadow: '0 20px 60px rgba(0,0,0,.55)',
        padding: '20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
          <div>
            <h2 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
              fontSize: '1.05rem', color: 'var(--text)', margin: 0,
            }}>
              🔧 Résoudre paiement orphelin
            </h2>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Crée un client + rattache le paiement automatiquement
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1,
          }}>×</button>
        </div>

        {/* Stripe details */}
        <div style={{
          padding: '12px 14px', borderRadius: 10, marginBottom: 14,
          background: 'rgba(99,91,255,.08)', border: '1px solid rgba(99,91,255,.3)',
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            💳 Charge Stripe
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#635BFF', fontFamily: "'Bricolage Grotesque', sans-serif" }}>
            {orphan.amount_eur.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-mid)', marginTop: 2 }}>
            {new Date(orphan.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}
            {orphan.description && ` · ${orphan.description}`}
          </div>
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
            {orphan.charge_id}
          </div>
        </div>

        {/* Form pré-rempli */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Nom commerce *" value={form.business_name} onChange={v => setForm({ ...form, business_name: v })} placeholder="Boulangerie X" />
          <Field label="Contact" value={form.contact_name} onChange={v => setForm({ ...form, contact_name: v })} placeholder="Marie Dupont" />
          <Field label="Email *" value={form.email} onChange={v => setForm({ ...form, email: v })} placeholder="contact@..." type="email" />
          <Field label="Téléphone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} type="tel" />
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.82rem',
          }}>❌ {error}</div>
        )}

        {done && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(34,197,94,.10)', color: 'var(--green)', fontSize: '0.82rem', fontWeight: 600,
          }}>✓ Client créé et paiement rattaché !</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} disabled={submitting} style={{
            padding: '9px 16px', borderRadius: 8, background: 'transparent',
            border: '1px solid var(--border-md)', color: 'var(--text-mid)',
            cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600,
          }}>Annuler</button>
          <button onClick={submit} disabled={submitting || done} style={{
            padding: '9px 18px', borderRadius: 8, background: 'var(--orange)',
            color: '#fff', border: 'none', cursor: submitting ? 'wait' : 'pointer',
            fontSize: '0.84rem', fontWeight: 700, opacity: submitting || done ? 0.6 : 1,
          }}>{submitting ? '⏳ Création…' : done ? '✓' : 'Créer et rattacher'}</button>
        </div>
      </div>
    </>
  );
}

function Field({ label, value, onChange, placeholder, type }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <input
        type={type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '9px 11px', borderRadius: 7,
          background: 'var(--night-mid)', border: '1px solid var(--border-md)',
          color: 'var(--text)', fontSize: '0.86rem', outline: 'none', fontFamily: 'inherit',
        }}
      />
    </label>
  );
}
