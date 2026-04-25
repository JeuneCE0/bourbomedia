'use client';

import { useEffect, useState, useCallback } from 'react';

type TabKey = 'team' | 'ads' | 'pricing' | 'integrations';

const TABS: { key: TabKey; emoji: string; label: string }[] = [
  { key: 'team',         emoji: '👥', label: 'Équipe' },
  { key: 'ads',          emoji: '💰', label: 'Budget Ads' },
  { key: 'pricing',      emoji: '💵', label: 'Tarifs' },
  { key: 'integrations', emoji: '🔌', label: 'Intégrations' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('team');

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800, fontSize: '1.7rem', color: 'var(--text)',
          margin: 0, lineHeight: 1.2,
        }}>
          ⚙️ Paramètres
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Configuration de la plateforme Bourbomedia
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, background: 'var(--night-card)',
        borderRadius: 12, border: '1px solid var(--border)', marginBottom: 18,
        flexWrap: 'wrap',
      }}>
        {TABS.map(t => {
          const active = t.key === tab;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: '1 1 auto', padding: '10px 14px', borderRadius: 8,
              background: active ? 'var(--night-mid)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: active ? 700 : 500,
              transition: 'all .15s', whiteSpace: 'nowrap',
            }}>
              <span aria-hidden style={{ marginRight: 6 }}>{t.emoji}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="bm-fade-in" key={tab}>
        {tab === 'team' && <TeamPanel />}
        {tab === 'ads' && <AdsBudgetPanel />}
        {tab === 'pricing' && <PricingPanel />}
        {tab === 'integrations' && <IntegrationsPanel />}
      </div>
    </div>
  );
}

/* ========== ADS BUDGET ========== */

function AdsBudgetPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const [monthly, setMonthly] = useState('');

  useEffect(() => {
    fetch('/api/app-settings', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMonthly(((d.ads_budget_monthly_cents || 0) / 100).toString()); })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/app-settings', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ ads_budget_monthly_cents: Math.round(parseFloat(monthly || '0') * 100) }),
      });
      if (r.ok) { setSavedHint(true); setTimeout(() => setSavedHint(false), 2500); }
    } finally { setSaving(false); }
  }

  if (loading) return <Card>Chargement…</Card>;

  const monthlyNum = parseFloat(monthly || '0');
  const today = new Date();
  const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daily = monthlyNum / dim;
  const weekly = daily * 7;

  return (
    <Card title="💰 Budget publicitaire mensuel" subtitle="Saisis ton budget Meta Ads / Google Ads pour le mois en cours. Le système répartit automatiquement par jour / semaine pour les vues 'Aujourd&apos;hui' et 'Cette semaine'.">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <label style={{ flex: '1 1 200px' }}>
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
            Budget mensuel (€)
          </span>
          <input type="number" step="1" min="0" value={monthly} onChange={e => setMonthly(e.target.value)}
            placeholder="Ex: 3000"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '1rem', outline: 'none', fontFamily: 'inherit',
            }}
          />
        </label>
        <button onClick={save} disabled={saving} style={{
          padding: '10px 20px', borderRadius: 8, background: 'var(--orange)',
          color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700,
          opacity: saving ? 0.5 : 1,
        }}>
          {saving ? '⏳' : '💾'} Enregistrer
        </button>
        {savedHint && <span style={{ color: 'var(--green)', fontSize: '0.78rem', fontWeight: 600 }}>✅ Enregistré</span>}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
        padding: '14px 16px', background: 'var(--night-mid)', borderRadius: 10,
        border: '1px solid var(--border)',
      }}>
        <Mini label="Par jour" value={`${daily.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`} sub={`÷ ${dim} jours`} />
        <Mini label="Par semaine" value={`${weekly.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`} sub="moyenne 7j" />
        <Mini label="Ce mois" value={`${monthlyNum.toLocaleString('fr-FR')} €`} sub={today.toLocaleDateString('fr-FR', { month: 'long' })} />
      </div>
    </Card>
  );
}

/* ========== PRICING ========== */

function PricingPanel() {
  return (
    <Card title="💵 Tarifs standards" subtitle="Prix appliqué automatiquement à chaque opportunité (vidéo unique).">
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
      }}>
        <Mini label="Prix HT" value="500 €" sub="Vidéo unique" />
        <Mini label="TVA Réunion" value="8,5%" sub="Soit 42,50 €" />
        <Mini label="Prix TTC" value="542,50 €" sub="Facturé au client" highlight />
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 14, marginBottom: 0 }}>
        💡 Pour modifier ces tarifs, édite <code style={{ background: 'var(--night-mid)', padding: '1px 6px', borderRadius: 4 }}>lib/pricing.ts</code> dans le code.
        Les calculs de revenu prévisionnel (closings won × 500€) se mettent à jour automatiquement.
      </p>
    </Card>
  );
}

/* ========== INTEGRATIONS ========== */

interface IntegrationsStatus {
  ghl: boolean;
  ghl_calendars: { closing: boolean; onboarding: boolean; tournage: boolean };
  ghl_webhook_secret: boolean;
  slack: boolean;
  stripe: boolean;
  anthropic: boolean;
  automations_paused: boolean;
}

function IntegrationsPanel() {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/app-settings/integrations', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setStatus(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !status) return <Card>Chargement…</Card>;

  return (
    <>
      <Card title="🔌 Intégrations actives" subtitle="État des connexions externes (lecture seule — modifie via Vercel Env Vars).">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Row label="GHL API" ok={status.ghl} hint="GHL_API_KEY + GHL_LOCATION_ID" />
          <Row label="GHL Webhook secret" ok={status.ghl_webhook_secret} hint="GHL_WEBHOOK_SECRET" />
          <Row label="Calendrier closing" ok={status.ghl_calendars.closing} hint="GHL_CLOSING_CALENDAR_ID" />
          <Row label="Calendrier onboarding" ok={status.ghl_calendars.onboarding} hint="GHL_ONBOARDING_CALENDAR_ID" />
          <Row label="Calendrier tournage" ok={status.ghl_calendars.tournage} hint="GHL_FILMING_CALENDAR_ID" />
          <Row label="Slack notifications" ok={status.slack} hint="SLACK_WEBHOOK_URL" />
          <Row label="Stripe paiements" ok={status.stripe} hint="STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET" />
          <Row label="Anthropic (IA scripts)" ok={status.anthropic} hint="ANTHROPIC_API_KEY" />
        </div>
      </Card>

      <Card title="🚨 Kill switch automatisations">
        <div style={{
          padding: '14px 16px', borderRadius: 10,
          background: status.automations_paused ? 'rgba(239,68,68,.08)' : 'rgba(34,197,94,.08)',
          border: `1px solid ${status.automations_paused ? 'rgba(239,68,68,.30)' : 'rgba(34,197,94,.30)'}`,
          fontSize: '0.85rem', color: 'var(--text)',
        }}>
          {status.automations_paused ? (
            <>🔴 <strong>Automatisations en pause</strong> — aucun WhatsApp/SMS/Email automatique n&apos;est envoyé. Les notifs Slack et in-app restent actives.</>
          ) : (
            <>🟢 <strong>Automatisations actives</strong> — les workflows GHL (mails, SMS, WhatsApp) se déclenchent normalement.</>
          )}
        </div>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
          Pour basculer, modifie <code style={{ background: 'var(--night-mid)', padding: '1px 6px', borderRadius: 4 }}>AUTOMATIONS_PAUSED</code> dans Vercel (true/false) puis redéploie.
        </p>
      </Card>

      <Card title="🪝 Webhook GHL — URL à configurer">
        <div style={{
          padding: '12px 14px', borderRadius: 8, background: 'var(--night-mid)',
          border: '1px solid var(--border)', fontFamily: 'monospace',
          fontSize: '0.78rem', color: 'var(--text-mid)', wordBreak: 'break-all',
        }}>
          POST https://bourbonmedia.fr/api/webhooks/ghl/appointment?secret=&lt;GHL_WEBHOOK_SECRET&gt;
        </div>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
          À configurer dans <strong>GHL → Automation → Workflows</strong>, déclenché sur l&apos;événement <em>Appointment Created / Status Changed</em>.
        </p>
      </Card>
    </>
  );
}

function Row({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      background: 'var(--night-mid)', borderRadius: 8, border: '1px solid var(--border)',
    }}>
      <span aria-hidden style={{
        width: 24, height: 24, borderRadius: '50%',
        background: ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
        color: ok ? 'var(--green)' : 'var(--red)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
      }}>{ok ? '✓' : '✗'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{hint}</div>}
      </div>
      <span style={{
        fontSize: '0.7rem', padding: '3px 9px', borderRadius: 12, fontWeight: 600,
        background: ok ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.10)',
        color: ok ? 'var(--green)' : 'var(--red)',
      }}>
        {ok ? 'Connecté' : 'Manquant'}
      </span>
    </div>
  );
}

/* ========== TEAM ========== */

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  active: boolean;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' };
const ROLE_COLORS: Record<string, string> = { admin: 'var(--orange)', editor: '#3B82F6', viewer: 'var(--text-muted)' };

function TeamPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'editor' as 'admin' | 'editor' | 'viewer' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function notify(type: 'error' | 'success', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch('/api/users', { headers: authHeaders() });
      if (r.ok) setUsers(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
      if (form.password) payload.password = form.password;
      if (editingId) payload.id = editingId;
      const r = await fetch('/api/users', {
        method: editingId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error);
      notify('success', editingId ? 'Membre mis à jour' : 'Membre ajouté');
      setShowForm(false); setEditingId(null);
      setForm({ email: '', name: '', password: '', role: 'editor' });
      loadUsers();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function del(id: string) {
    setConfirmDeleteId(null);
    const r = await fetch('/api/users', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) });
    if (r.ok) { notify('success', 'Membre supprimé'); loadUsers(); }
  }

  async function toggleActive(u: User) {
    await fetch('/api/users', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ id: u.id, active: !u.active }),
    });
    loadUsers();
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setForm({ email: u.email, name: u.name, password: '', role: u.role });
    setShowForm(true);
  }

  return (
    <Card title="👥 Équipe" subtitle="Membres ayant accès au panel admin">
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '12px 18px', borderRadius: 10,
          background: toast.type === 'error' ? 'rgba(239,68,68,.95)' : 'rgba(34,197,94,.95)',
          color: '#fff', fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}>{toast.msg}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ email: '', name: '', password: '', role: 'editor' }); }}
          style={{
            padding: '8px 16px', borderRadius: 8, background: showForm ? 'var(--night-mid)' : 'var(--orange)',
            color: showForm ? 'var(--text)' : '#fff', border: showForm ? '1px solid var(--border-md)' : 'none',
            fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem',
          }}>
          {showForm ? 'Annuler' : '+ Ajouter un membre'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} style={{
          background: 'var(--night-mid)', borderRadius: 10, border: '1px solid var(--border)',
          padding: '14px 16px', marginBottom: 14,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
            <Field label="Nom"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} /></Field>
            <Field label="Email"><input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} /></Field>
            <Field label={`Mot de passe${editingId ? ' (vide = inchangé)' : ''}`}>
              <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                required={!editingId} minLength={6} style={inputStyle} />
            </Field>
            <Field label="Rôle">
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'editor' | 'viewer' })} style={inputStyle}>
                <option value="viewer">Lecteur</option>
                <option value="editor">Éditeur</option>
                <option value="admin">Administrateur</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving} style={{
              padding: '8px 18px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
              fontSize: '0.82rem', opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>Chargement…</div>
      ) : users.length === 0 ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Aucun membre. Ajoute le premier.
        </div>
      ) : (
        <div style={{ background: 'var(--night-mid)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {users.map((u, i) => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              opacity: u.active ? 1 : 0.5,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: ROLE_COLORS[u.role] + '18', color: ROLE_COLORS[u.role],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
              }}>
                {u.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{u.email}</div>
              </div>
              <span style={{
                fontSize: '0.66rem', padding: '3px 9px', borderRadius: 12,
                background: ROLE_COLORS[u.role] + '18', color: ROLE_COLORS[u.role], fontWeight: 600,
              }}>{ROLE_LABELS[u.role]}</span>
              <button onClick={() => toggleActive(u)} style={{
                padding: '4px 9px', borderRadius: 6,
                background: u.active ? 'rgba(34,197,94,.08)' : 'var(--night-mid)',
                border: `1px solid ${u.active ? 'rgba(34,197,94,.25)' : 'var(--border-md)'}`,
                color: u.active ? 'var(--green)' : 'var(--text-muted)',
                fontSize: '0.66rem', cursor: 'pointer', fontWeight: 600,
              }}>{u.active ? 'Actif' : 'Inactif'}</button>
              <button onClick={() => startEdit(u)} style={iconBtn} title="Modifier">✎</button>
              {confirmDeleteId === u.id ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => del(u.id)} style={{ ...iconBtn, background: 'rgba(239,68,68,.15)', borderColor: 'rgba(239,68,68,.3)', color: 'var(--red)', width: 'auto', padding: '4px 8px', fontSize: '0.62rem' }}>Oui</button>
                  <button onClick={() => setConfirmDeleteId(null)} style={{ ...iconBtn, width: 'auto', padding: '4px 8px', fontSize: '0.62rem' }}>Non</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteId(u.id)} style={{ ...iconBtn, color: 'var(--red)' }} title="Supprimer">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ========== Building blocks ========== */

function Card({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
      padding: '18px 20px', marginBottom: 14,
    }}>
      {title && (
        <h2 style={{
          fontSize: '1rem', fontWeight: 700, color: 'var(--text)',
          margin: '0 0 4px',
        }}>
          {title}
        </h2>
      )}
      {subtitle && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 16px' }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

function Mini({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: highlight ? 'rgba(232,105,43,.12)' : 'var(--night-raised)',
      border: `1px solid ${highlight ? 'rgba(232,105,43,.30)' : 'var(--border)'}`,
    }}>
      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: highlight ? 'var(--orange)' : 'var(--text)', fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  background: 'var(--night-card)', border: '1px solid var(--border-md)',
  color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit',
};
const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, background: 'var(--night-card)',
  border: '1px solid var(--border-md)', color: 'var(--text-mid)',
  cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
