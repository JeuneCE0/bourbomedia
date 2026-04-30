'use client';

// /onboarding est désormais un page d'entrée signup-only :
//  - Visiteur sans token → formulaire d'inscription (mode signup) ou
//    "Reprendre mon onboarding" (mode login).
//  - Visiteur avec token (URL ou localStorage) → fetchClient et redirect
//    vers /portal qui est l'espace client riche.
// Le funnel inline historique (steps 2-7 : contrat, paiement, calendriers,
// script, dates) a été migré dans /portal et stripé d'ici — ~1000 lignes
// de code mort retirées + bundle JS plus léger pour les nouveaux signups.

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { trackFunnel } from '@/lib/funnel';

const FORM_DRAFT_KEY = 'ob_form_draft_v1';

interface ClientData {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  onboarding_step: number;
  portal_token?: string;
  status?: string;
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenParam = searchParams.get('token');

  const [token, setToken] = useState(tokenParam || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1 form (auto-saved draft restored on mount client-side)
  const [form, setForm] = useState({ business_name: '', contact_name: '', email: '', phone: '', password: '', passwordConfirm: '' });

  // SEO/UX : titre d'onglet côté client.
  useEffect(() => { document.title = 'BourbonMédia — Onboarding'; }, []);

  // Restore Step 1 draft from localStorage (browser-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Never restore the password field for security
      setForm((f) => ({
        business_name: draft.business_name ?? f.business_name,
        contact_name: draft.contact_name ?? f.contact_name,
        email: draft.email ?? f.email,
        phone: draft.phone ?? f.phone,
        password: '',
        passwordConfirm: '',
      }));
    } catch { /* ignore corrupt draft */ }
  }, []);

  // Auto-save Step 1 draft (debounced) — survives accidental close/reload
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const { password, passwordConfirm, ...safe } = form;
        void password; void passwordConfirm;
        localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(safe));
      } catch { /* quota exceeded — ignore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [form]);

  const fetchClient = useCallback(async (t: string) => {
    try {
      const r = await fetch(`/api/onboarding?token=${t}`);
      if (!r.ok) throw new Error('Token invalide');
      const data = await r.json();
      // /onboarding est l'URL d'entrée publique partagée en appel ; une fois
      // que le prospect est inscrit (a un portal_token), on bascule pour de
      // bon sur /portal qui est l'espace client riche (script, vidéo, dates,
      // notifs). Du coup le commercial n'a qu'une seule URL à partager —
      // /onboarding/ — et toutes les visites suivantes routent automatiquement
      // au bon endroit. On ne set pas l'état avant le redirect pour éviter
      // un flash du funnel inline. Fallback : clients legacy sans portal_token
      // → on garde le funnel inline (set state ci-dessous).
      if (data.portal_token) {
        router.replace(`/portal?token=${data.portal_token}`);
        return data;
      }
      // Edge case clients legacy sans portal_token : on affiche un message
      // d'erreur clair. Cas très rare puisque la création de compte génère
      // toujours les deux jetons (cf. /api/onboarding action='create_account').
      setError("Votre espace client n'est pas encore activé. Contactez l'équipe BourbonMédia.");
      return data;
    } catch {
      setError('Lien invalide ou expiré');
      return null;
    }
  }, [router]);

  useEffect(() => {
    if (tokenParam) {
      setToken(tokenParam);
      localStorage.setItem('ob_token', tokenParam);
      fetchClient(tokenParam);
    } else {
      const saved = localStorage.getItem('ob_token');
      if (saved) {
        setToken(saved);
        fetchClient(saved);
      }
    }
  }, [tokenParam, fetchClient]);

  // Step 1: Create account
  const handleCreateAccount = async () => {
    setError('');
    if (!form.business_name || !form.contact_name || !form.email || !form.password) {
      setError('Tous les champs sont requis');
      return;
    }
    if (form.password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_account', ...form }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // Account created — clear draft (data is now persisted server-side)
      localStorage.removeItem(FORM_DRAFT_KEY);
      // Migration : la suite de l'onboarding (contrat / paiement / appel) se fait
      // désormais dans /portal. On garde aussi l'onboarding_token en localStorage
      // pour le bouton "Reprendre mon onboarding" et le fallback /onboarding.
      localStorage.setItem('ob_token', data.token);
      const portalToken = data.portalToken || data.client?.portal_token;
      // Track funnel : signup réussi (1ère étape mesurable du funnel).
      trackFunnel({ event: 'signup_completed', source: 'onboarding', token: portalToken || data.token });
      if (portalToken) {
        router.replace(`/portal?token=${portalToken}`);
        return;
      }
      // Fallback rare : pas de portal_token renvoyé. On affiche une erreur
      // claire — l'admin contactera le client manuellement pour activer son
      // espace (au lieu de retomber sur le funnel inline supprimé).
      setToken(data.token);
      setError("Votre espace client n'est pas encore activé. L'équipe BourbonMédia vous recontacte sous peu.");
    } catch (e: unknown) {
      const msg = (e as Error).message || '';
      if (msg.toLowerCase().includes('email') && msg.toLowerCase().includes('exist')) {
        setError('Cet email est déjà utilisé. Cliquez sur « Reprendre mon onboarding » ci-dessous.');
      } else if (msg.toLowerCase().includes('email')) {
        setError("L'adresse email semble invalide. Vérifiez-la et réessayez.");
      } else {
        setError(msg || "Impossible de créer votre compte. Réessayez ou contactez-nous.");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    background: 'var(--night-mid)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'border-color .15s, background .15s',
    fontFamily: 'inherit',
  };

  const btnPrimary: React.CSSProperties = {
    width: '100%',
    padding: '12px 20px',
    background: 'var(--orange)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: '0.92rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background .15s',
  };

  const btnSecondary: React.CSSProperties = {
    width: '100%',
    padding: '12px 20px',
    background: 'transparent',
    color: 'var(--text-mid)',
    border: '1px solid var(--border-md)',
    borderRadius: 8,
    fontSize: '0.92rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all .15s',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--night-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '28px',
    maxWidth: 520,
    width: '100%',
    margin: '0 auto',
  };

  const SuccessBox = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div style={{
      padding: '22px 20px',
      background: 'rgba(34,197,94,.08)',
      border: '1px solid rgba(34,197,94,.25)',
      borderRadius: 10,
      textAlign: 'center',
    }}>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'rgba(34,197,94,.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 12px',
        fontSize: '1.1rem',
        color: 'var(--green)',
      }}>
        ✓
      </div>
      <p style={{ color: 'var(--green)', fontWeight: 600, margin: 0, fontSize: '0.95rem' }}>{title}</p>
      {subtitle && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 6, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
  );

  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    color: 'var(--text-mid)',
    marginBottom: 6,
    display: 'block',
    fontWeight: 500,
  };

  // Step 1: Account creation + login/resume
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleLogin = async () => {
    setError('');
    if (!loginEmail || !loginPassword) {
      setError('Email et mot de passe requis');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email: loginEmail, password: loginPassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localStorage.setItem('ob_token', data.token);
      setToken(data.token);
      // fetchClient redirige automatiquement vers /portal s'il y a un
      // portal_token (cas standard pour les comptes existants).
      await fetchClient(data.token);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <div style={cardStyle}>
      {mode === 'signup' ? (
        <>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(232,105,43,.12)',
              border: '1px solid var(--border-orange)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
              fontSize: '1.6rem',
              color: 'var(--orange)',
              fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
            }} aria-hidden>
              👋
            </div>
            <h2 style={{
              color: 'var(--text)',
              fontSize: '1.4rem',
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-.2px',
              fontFamily: "'Bricolage Grotesque', sans-serif",
            }}>
              Bienvenue chez BourbonM&eacute;dia
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: 8, lineHeight: 1.5, margin: '8px 0 0' }}>
              Créons votre espace en moins d&apos;une minute
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Nom de votre entreprise</label>
              <input
                style={inputStyle}
                placeholder="Ex : Boulangerie Saint-Denis"
                value={form.business_name}
                onChange={e => setForm({ ...form, business_name: e.target.value })}
                autoComplete="organization"
              />
            </div>
            <div>
              <label style={labelStyle}>Prénom et nom</label>
              <input
                style={inputStyle}
                placeholder="Ex : Marie Dupont"
                value={form.contact_name}
                onChange={e => setForm({ ...form, contact_name: e.target.value })}
                autoComplete="name"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  style={inputStyle}
                  placeholder="marie@monentreprise.re"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                />
              </div>
              <div>
                <label style={labelStyle}>Téléphone</label>
                <input
                  type="tel"
                  style={inputStyle}
                  placeholder="0692 12 34 56"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  autoComplete="tel"
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Mot de passe</label>
                <input
                  type="password"
                  style={inputStyle}
                  placeholder="Au moins 6 caractères"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label style={labelStyle}>Confirmer le mot de passe</label>
                <input
                  type="password"
                  style={inputStyle}
                  placeholder="Retapez le même"
                  value={form.passwordConfirm}
                  onChange={e => setForm({ ...form, passwordConfirm: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0, lineHeight: 1.5 }}>
              🔒 Vos informations sont enregistrées automatiquement à chaque saisie — vous pouvez fermer cette page et revenir plus tard sans rien perdre.
            </p>
          </div>

          {error && (
            <div style={{
              marginTop: 18,
              padding: '12px 16px',
              background: 'rgba(239,68,68,.08)',
              borderLeft: '3px solid var(--red)',
              borderRadius: 8,
              color: '#fca5a5',
              fontSize: '0.85rem',
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleCreateAccount}
            disabled={loading}
            style={{ ...btnPrimary, marginTop: 24, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Démarrage en cours...' : 'Démarrer mon onboarding'}
          </button>

          <div style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,.06)',
            textAlign: 'center',
          }}>
            <button
              onClick={() => { setMode('login'); setError(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              D&eacute;j&agrave; un compte ? <span style={{ color: 'var(--orange)', fontWeight: 600 }}>Reprendre mon onboarding</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(232,105,43,.12)',
              border: '1px solid var(--border-orange)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
              fontSize: '1.6rem',
              color: 'var(--orange)',
              fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
            }} aria-hidden>
              ↩️
            </div>
            <h2 style={{
              color: 'var(--text)',
              fontSize: '1.4rem',
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-.2px',
              fontFamily: "'Bricolage Grotesque', sans-serif",
            }}>
              Reprendre mon onboarding
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: 8, lineHeight: 1.5, margin: '8px 0 0' }}>
              Connectez-vous pour reprendre l&agrave; o&ugrave; vous en &eacute;tiez
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                style={inputStyle}
                placeholder="email@pro.re"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
              />
            </div>
            <div>
              <label style={labelStyle}>Mot de passe</label>
              <input
                type="password"
                style={inputStyle}
                placeholder="Votre mot de passe"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              marginTop: 18,
              padding: '12px 16px',
              background: 'rgba(239,68,68,.08)',
              borderLeft: '3px solid var(--red)',
              borderRadius: 8,
              color: '#fca5a5',
              fontSize: '0.85rem',
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ ...btnPrimary, marginTop: 24, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Connexion...' : 'Me connecter'}
          </button>

          <div style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,.06)',
            textAlign: 'center',
          }}>
            <button
              onClick={() => { setMode('signup'); setError(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              Pas encore de compte ? <span style={{ color: 'var(--orange)', fontWeight: 600 }}>Créer mon compte</span>
            </button>
          </div>
        </>
      )}
    </div>
  );

  /* ─────────────────────────────────────────────────────────────────────
   * Step 2 → 7 ne sont plus rendus inline ici. Toute la suite de
   * l'onboarding (contrat, paiement, appel, script, tournage, publication)
   * vit dans /portal qui est l'espace client définitif. Le redirect
   * automatique dans fetchClient assure qu'aucun client avec portal_token
   * ne tombe ici. Le seul render restant est renderStep1 (signup + login).
   * ───────────────────────────────────────────────────────────────────── */



  // Render simple : signup/login form (renderStep1) ou loader pendant que
  // fetchClient résout le redirect vers /portal. Pas de switch sur les
  // anciens steps puisqu'ils sont rendus côté /portal maintenant.
  const renderCurrentStep = () => {
    if (token && !error) {
      return (
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '3px solid var(--border-md)',
            borderTopColor: 'var(--orange)',
            margin: '0 auto 16px',
            animation: 'spin 1s linear infinite',
          }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Redirection vers votre espace…</p>
        </div>
      );
    }
    return renderStep1();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--night)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        padding: '20px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 700,
          fontSize: '1.15rem',
          color: 'var(--orange)',
          letterSpacing: '-.2px',
        }}>
          BourbonM&eacute;dia
        </span>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '32px 16px',
        maxWidth: 720,
        width: '100%',
        margin: '0 auto',
      }}>
        {renderCurrentStep()}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '16px 24px',
        borderTop: '1px solid var(--border)',
        textAlign: 'center',
      }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>
          BourbonM&eacute;dia &mdash; Production vid&eacute;o &agrave; La R&eacute;union
        </p>
      </footer>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        input:focus, select:focus, textarea:focus {
          border-color: var(--border-orange) !important;
          background: var(--night-raised) !important;
        }
      `}</style>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        background: 'var(--night)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  );
}
