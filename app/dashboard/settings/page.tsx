'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AutomationsView } from '@/app/dashboard/automations/page';
import { DensityToggle } from '@/components/DensityProvider';

type TabKey = 'team' | 'ads' | 'pricing' | 'integrations' | 'notifications' | 'automations' | 'data' | 'appearance';

const TABS: { key: TabKey; emoji: string; label: string }[] = [
  { key: 'team',          emoji: '👥', label: 'Équipe' },
  { key: 'notifications', emoji: '🔔', label: 'Notifications' },
  { key: 'appearance',    emoji: '🎨', label: 'Apparence' },
  { key: 'automations',   emoji: '🤖', label: 'Automatisations' },
  { key: 'integrations',  emoji: '🔌', label: 'Intégrations' },
  { key: 'data',          emoji: '🔄', label: 'Synchronisations' },
  { key: 'ads',           emoji: '💰', label: 'Budget Ads' },
  { key: 'pricing',       emoji: '💵', label: 'Tarifs' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-muted)' }}>Chargement…</div>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const sp = useSearchParams();
  const initialTab = (() => {
    const t = sp.get('tab');
    const valid = ['team', 'notifications', 'appearance', 'automations', 'integrations', 'data', 'ads', 'pricing'];
    return valid.includes(t || '') ? (t as TabKey) : 'team';
  })();
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const setTab = useCallback((next: TabKey) => {
    setTabState(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next === 'team') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

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
        {tab === 'notifications' && <NotificationsPanel />}
        {tab === 'appearance' && <AppearancePanel />}
        {tab === 'automations' && <AutomationsView />}
        {tab === 'integrations' && <IntegrationsPanel />}
        {tab === 'data' && <DataSyncPanel />}
        {tab === 'ads' && <AdsBudgetPanel />}
        {tab === 'pricing' && <PricingPanel />}
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

      <Card title="🪝 Webhooks GHL — URLs à configurer">
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>1. Appointments (RDV)</div>
          <div style={{
            padding: '12px 14px', borderRadius: 8, background: 'var(--night-mid)',
            border: '1px solid var(--border)', fontFamily: 'monospace',
            fontSize: '0.76rem', color: 'var(--text-mid)', wordBreak: 'break-all',
          }}>
            POST https://bourbonmedia.fr/api/webhooks/ghl/appointment?secret=&lt;GHL_WEBHOOK_SECRET&gt;
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Trigger : <em>Appointment Created / Status Changed</em>
          </p>
        </div>
        <div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>2. Opportunities (changement de stage pipeline)</div>
          <div style={{
            padding: '12px 14px', borderRadius: 8, background: 'var(--night-mid)',
            border: '1px solid var(--border)', fontFamily: 'monospace',
            fontSize: '0.76rem', color: 'var(--text-mid)', wordBreak: 'break-all',
          }}>
            POST https://bourbonmedia.fr/api/webhooks/ghl/opportunity?secret=&lt;GHL_WEBHOOK_SECRET&gt;
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Triggers : <em>Opportunity Created</em> <strong>+</strong> <em>Pipeline Stage Changed</em> (sync GHL → Bourbomedia).
            Sans le trigger <em>Created</em>, les nouveaux optins qui apparaissent direct dans la 1ère étape du pipeline ne sont jamais notifiés.
          </p>
        </div>

        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.30)',
        }}>
          <div style={{ fontSize: '0.74rem', color: '#fca5a5', fontWeight: 700, marginBottom: 4 }}>
            ⚠️ Important — calendriers embed
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-mid)', lineHeight: 1.55 }}>
            Sur les 3 calendriers GHL embeddés (closing / onboarding / tournage),
            <strong> retire toutes les redirections « après confirmation »</strong> côté GHL Dashboard
            (Calendar settings → <em>Confirmation page</em> → laisser <em>Default</em> sans URL custom).
            Les redirects vers <code>bourbonmedia.fr/portal</code> chargent le portail dans
            l&apos;iframe → loop infini ou écran blanc. Bourbomedia gère la confirmation
            via le webhook + verify polling, pas besoin de redirect.
          </div>
        </div>
      </Card>

      <BackfillCard />
    </>
  );
}

function DeepSyncAppointmentsCard() {
  const [running, setRunning] = useState(false);
  const [pastDays, setPastDays] = useState(30);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch(
        `/api/admin/ghl-sync-appointments?past_days=${pastDays}&future_days=60`,
        { method: 'POST', headers: authHeaders() },
      );
      const d = await r.json().catch(() => ({}));
      setResult(d);
    } finally { setRunning(false); }
  }

  return (
    <Card title="📅 Deep sync RDV — pull GHL des 3 calendriers" subtitle="Re-pull les rendez-vous (closing / onboarding / tournage) sur une fenêtre élargie. Skip l'enrichissement contact pour les RDV déjà complets, donc rapide même sur 90 jours.">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ flex: '1 1 160px' }}>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Jours en arrière</span>
          <select
            value={pastDays}
            onChange={e => setPastDays(parseInt(e.target.value, 10))}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit',
            }}
          >
            <option value={7}>7 derniers jours</option>
            <option value={14}>14 derniers jours</option>
            <option value={30}>30 derniers jours</option>
            <option value={60}>60 derniers jours</option>
            <option value={90}>90 derniers jours</option>
          </select>
        </label>
        <button onClick={run} disabled={running} style={{
          padding: '10px 18px', borderRadius: 8, background: 'var(--orange)',
          color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700,
          opacity: running ? 0.5 : 1,
        }}>
          {running ? '⏳ Sync…' : '📥 Pull les RDV'}
        </button>
      </div>
      {result && (
        <pre style={{
          padding: '12px 14px', borderRadius: 8,
          background: 'var(--night-mid)', border: '1px solid var(--border)',
          fontSize: '0.74rem', color: 'var(--text-mid)', overflow: 'auto', margin: 0,
          maxHeight: 220,
        }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
        Window jusqu&apos;à +60j en avant pour aussi capturer les RDV bookés à l&apos;avance.
        Idempotent : ré-exécutable sans risque (upsert).
      </p>
    </Card>
  );
}

function BackfillCard() {
  const [running, setRunning] = useState(false);
  const [since, setSince] = useState('2026-04-12');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch(`/api/admin/ghl-backfill?since=${since}`, {
        method: 'POST', headers: authHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      setResult(d);
    } finally { setRunning(false); }
  }

  return (
    <Card title="🔄 Backfill GHL — historique des appels & opportunités" subtitle="Importe rétroactivement tous les RDV et opportunités du pipeline depuis une date donnée. À lancer une seule fois.">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ flex: '1 1 180px' }}>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Depuis le</span>
          <input type="date" value={since} onChange={e => setSince(e.target.value)} style={{
            width: '100%', padding: '8px 12px', borderRadius: 8,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit',
          }} />
        </label>
        <button onClick={run} disabled={running} style={{
          padding: '10px 18px', borderRadius: 8, background: 'var(--orange)',
          color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700,
          opacity: running ? 0.5 : 1,
        }}>
          {running ? '⏳ En cours…' : '🚀 Lancer le backfill'}
        </button>
      </div>
      {result && (
        <pre style={{
          padding: '12px 14px', borderRadius: 8,
          background: 'var(--night-mid)', border: '1px solid var(--border)',
          fontSize: '0.74rem', color: 'var(--text-mid)', overflow: 'auto', margin: 0,
          maxHeight: 280,
        }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
        ⚠️ Peut prendre 30 s à 2 min selon le volume. Les RDV existants sont mis à jour, les nouveaux sont insérés.
      </p>
    </Card>
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

/* ========== NOTIFICATIONS (PWA push) ========== */

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; ++i) view[i] = raw.charCodeAt(i);
  return buf;
}

function NotificationsPanel() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vapidMissing, setVapidMissing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
    setSupported(ok);
    if (ok) {
      setPermission(Notification.permission);
      navigator.serviceWorker.getRegistration('/sw.js').then(async (reg) => {
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setSubscribed(true);
          // Re-sync : si le navigateur a déjà une subscription mais le serveur
          // n'en a pas (table push_subscriptions vide ou créée après coup),
          // on ré-enregistre en best-effort. Idempotent côté serveur (upsert).
          try {
            const subJson = sub.toJSON();
            await fetch('/api/push/subscribe', {
              method: 'POST', headers: authHeaders(),
              body: JSON.stringify({
                endpoint: subJson.endpoint,
                keys: subJson.keys,
                userAgent: navigator.userAgent,
              }),
            });
          } catch { /* tolerate */ }
        }
      });
    }
  }, []);

  async function enable() {
    setBusy(true); setMsg(null);
    try {
      // 1. Get VAPID public key
      const keyR = await fetch('/api/push/subscribe', { headers: authHeaders() });
      if (keyR.status === 503) { setVapidMissing(true); setMsg('VAPID_PUBLIC_KEY non configuré côté serveur.'); return; }
      if (!keyR.ok) { setMsg('Impossible de récupérer la clé VAPID.'); return; }
      const { publicKey } = await keyR.json();

      // 2. Register SW
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // 3. Permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setMsg('Permission refusée.'); return; }

      // 4. Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 5. Send to server
      const subJson = sub.toJSON();
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!r.ok) { setMsg('Échec enregistrement côté serveur.'); return; }

      setSubscribed(true);
      setMsg('Notifications activées ✓');
    } catch (e: unknown) {
      setMsg((e as Error).message || 'Erreur inconnue');
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: 'DELETE', headers: authHeaders(),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg('Notifications désactivées.');
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/push/test', { method: 'POST', headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        if (d.sent > 0) {
          setMsg(`✓ Test envoyé à ${d.sent} appareil${d.sent > 1 ? 's' : ''}.`);
        } else if (d.reason === 'vapid_missing') {
          setMsg('⚠️ Clés VAPID manquantes côté serveur (env vars).');
        } else if (d.reason === 'no_subscriptions') {
          setMsg('⚠️ Aucun appareil abonné en base. Désactive puis ré-active.');
        } else if (d.reason?.startsWith('db_error')) {
          setMsg(`⚠️ Erreur DB : ${d.reason.replace('db_error: ', '')}. La table push_subscriptions existe-t-elle ?`);
        } else {
          setMsg(`Aucun appareil joignable (total en base : ${d.total ?? 0}).`);
        }
      } else setMsg('Erreur lors du test.');
    } finally { setBusy(false); }
  }

  if (supported === null) return <div style={{ color: 'var(--text-muted)' }}>Vérification…</div>;
  if (!supported) return (
    <div style={{
      padding: 16, borderRadius: 12, background: 'var(--night-card)',
      border: '1px solid var(--border)', color: 'var(--text-mid)', fontSize: '0.88rem',
    }}>
      Ce navigateur ne supporte pas les notifications push (Push API ou Service Worker manquant).
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        padding: 18, borderRadius: 12, background: 'var(--night-card)', border: '1px solid var(--border)',
      }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
          🔔 Notifications navigateur
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Reçois une notification système (mac, iPhone si installé en PWA) quand un client paie, valide un script,
          envoie un retour vidéo ou réserve un appel — même quand le dashboard est fermé.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {!subscribed ? (
            <button onClick={enable} disabled={busy} style={{
              padding: '10px 16px', borderRadius: 8, background: 'var(--orange)',
              border: 'none', color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
              fontSize: '0.85rem', opacity: busy ? 0.7 : 1,
            }}>
              {busy ? 'Activation…' : '🔔 Activer les notifications'}
            </button>
          ) : (
            <>
              <button onClick={sendTest} disabled={busy} style={{
                padding: '10px 16px', borderRadius: 8, background: 'var(--orange)',
                border: 'none', color: '#fff', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontSize: '0.85rem',
              }}>📨 Envoyer un test</button>
              <button onClick={disable} disabled={busy} style={{
                padding: '10px 16px', borderRadius: 8, background: 'var(--night-mid)',
                border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                cursor: busy ? 'wait' : 'pointer', fontSize: '0.85rem',
              }}>Désactiver</button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>Permission : <strong style={{ color: permission === 'granted' ? 'var(--green)' : permission === 'denied' ? 'var(--red)' : 'var(--text-mid)' }}>{permission}</strong></span>
          <span>Statut : <strong style={{ color: subscribed ? 'var(--green)' : 'var(--text-mid)' }}>{subscribed ? 'abonné' : 'non abonné'}</strong></span>
        </div>

        {msg && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: 'var(--night-mid)', fontSize: '0.78rem', color: 'var(--text-mid)',
          }}>{msg}</div>
        )}

        {vapidMissing && (
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 8,
            background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.25)',
            fontSize: '0.76rem', color: '#FACC15', lineHeight: 1.5,
          }}>
            ⚠️ Ajoute dans tes variables d&apos;environnement :
            <pre style={{ margin: '6px 0 0', fontSize: '0.7rem', color: 'var(--text)' }}>
{`VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:tu@bourbomedia.fr`}
            </pre>
            <span style={{ display: 'block', marginTop: 4 }}>
              Génère-les avec <code>npx web-push generate-vapid-keys --json</code>.
            </span>
          </div>
        )}
      </div>

      <div style={{
        padding: 14, borderRadius: 10, background: 'var(--night-card)', border: '1px solid var(--border)',
        fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5,
      }}>
        💡 Sur iPhone, installe d&apos;abord le PWA depuis Safari (Partager → Sur l&apos;écran d&apos;accueil) puis active depuis l&apos;app.
      </div>
    </div>
  );
}

/* ========== SYNCHRONISATIONS (data backfill) ========== */

function DataSyncPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SyncCard
        emoji="💳"
        title="Stripe"
        description="Importe les paiements Stripe (Checkout, Payment Links, factures, charges directes) des 90 derniers jours dans la base. Auto-création client depuis GHL si absent. Idempotent."
        endpoint="/api/stripe/sync?days=90"
        confirmText="Récupérer les paiements Stripe des 90 derniers jours ?"
      />
      <SyncCard
        emoji="📄"
        title="Factures GHL"
        description="Importe les factures payées sur GHL des 180 derniers jours dans la base. Auto-bascule l'opportunité en 'Contracté'. Idempotent."
        endpoint="/api/ghl/sync-invoices?days=180"
        confirmText="Récupérer les factures GHL payées des 180 derniers jours ?"
      />
      <SyncCard
        emoji="📝"
        title="Notes RDV GHL"
        description="Pour chaque RDV documenté côté GHL après sa date, remplace le placeholder local par le contenu réel de la note. Bidirectionnel."
        endpoint="/api/gh-appointments/resync-notes"
        confirmText="Re-synchroniser les notes des RDV documentés sur GHL ?"
      />
      <DeepSyncAppointmentsCard />
      <div style={{
        padding: 14, borderRadius: 10, background: 'var(--night-card)', border: '1px solid var(--border)',
        fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        ℹ️ Ces sync sont automatiques au quotidien (webhooks Stripe + cron GHL). Le bouton manuel
        sert au backfill historique ou pour récupérer après une indisponibilité du webhook.
      </div>
    </div>
  );
}

function AppearancePanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        padding: 18, borderRadius: 12,
        background: 'var(--night-card)', border: '1px solid var(--border)',
      }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
          🎨 Densité d&apos;affichage
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Adapte les espacements et tailles de texte selon ton écran et tes préférences.
        </p>
        <DensityToggle />
      </div>
    </div>
  );
}

function SyncCard({
  emoji, title, description, endpoint,
}: { emoji: string; title: string; description: string; endpoint: string; confirmText?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; issues: string[]; raw?: unknown } | null>(null);

  async function run() {
    setBusy(true); setResult(null);
    try {
      console.log('[sync]', endpoint);
      const r = await fetch(endpoint, { method: 'POST', headers: authHeaders() });
      let d: { message?: string; error?: string; imported?: number; issues?: string[] } = {};
      try { d = await r.json(); } catch { /* non-JSON */ }
      console.log('[sync] response', r.status, d);
      if (r.ok) {
        setResult({
          ok: true,
          msg: d.message || `OK (${d.imported || 0} importé${(d.imported || 0) > 1 ? 's' : ''})`,
          issues: Array.isArray(d.issues) ? d.issues : [],
          raw: d,
        });
      } else {
        setResult({
          ok: false,
          msg: d.error || `HTTP ${r.status}`,
          issues: Array.isArray(d.issues) ? d.issues : [],
          raw: d,
        });
      }
    } catch (e: unknown) {
      console.error('[sync] error', e);
      setResult({ ok: false, msg: 'Erreur réseau : ' + (e as Error).message, issues: [] });
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      padding: 18, borderRadius: 12,
      background: 'var(--night-card)', border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
            <span aria-hidden style={{ marginRight: 6 }}>{emoji}</span> {title}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {description}
          </p>
        </div>
        <button onClick={run} disabled={busy} style={{
          padding: '9px 16px', borderRadius: 8, background: busy ? 'var(--text-muted)' : 'var(--orange)',
          border: 'none', color: '#fff', cursor: busy ? 'wait' : 'pointer',
          fontSize: '0.84rem', fontWeight: 700, whiteSpace: 'nowrap',
        }}>
          {busy ? '⏳ En cours…' : '🔄 Lancer'}
        </button>
      </div>
      {result && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: result.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.10)',
          border: `1px solid ${result.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          fontSize: '0.8rem', color: result.ok ? '#86EFAC' : '#FCA5A5', lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600 }}>{result.ok ? '✓' : '✕'} {result.msg}</div>
          {result.issues.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-mid)', fontWeight: 500 }}>
                Voir {result.issues.length} détail{result.issues.length > 1 ? 's' : ''}
              </summary>
              <div style={{ marginTop: 6, color: 'var(--text-mid)', fontWeight: 400 }}>
                {result.issues.map((iss, i) => <div key={i} style={{ marginBottom: 3 }}>• {iss}</div>)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
