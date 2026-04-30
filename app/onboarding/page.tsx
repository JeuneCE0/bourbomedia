'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import GhlBookingEmbed from '@/components/GhlBookingEmbed';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const STEPS = [
  { num: 1, label: 'Compte', icon: '👋' },
  { num: 2, label: 'Contrat', icon: '✍️' },
  { num: 3, label: 'Paiement', icon: '💳' },
  { num: 4, label: 'Appel', icon: '📞' },
  { num: 5, label: 'Script', icon: '📝' },
  { num: 6, label: 'Tournage', icon: '🎬' },
  { num: 7, label: 'Publication', icon: '📺' },
];

const FORM_DRAFT_KEY = 'ob_form_draft_v1';

interface ClientData {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  onboarding_step: number;
  portal_token?: string;
  contract_signature_link?: string;
  contract_signed_at?: string;
  paid_at?: string;
  onboarding_call_booked?: boolean;
  onboarding_call_date?: string;
  filming_date?: string;
  filming_date_confirmed?: boolean;
  publication_date?: string;
  publication_date_confirmed?: boolean;
  status?: string;
  scripts?: Array<{ id: string; status: string }>;
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenParam = searchParams.get('token');
  const paymentStatus = searchParams.get('payment');

  const [token, setToken] = useState(tokenParam || '');
  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(1);

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

  // Step 2 state
  const [checkingContract, setCheckingContract] = useState(false);
  const [showSignedBtn, setShowSignedBtn] = useState(false);
  const [contractIframeLoaded, setContractIframeLoaded] = useState(false);
  const [callIframeLoaded, setCallIframeLoaded] = useState(false);

  // Step 4 state
  const [calBooking, setCalBooking] = useState(false);

  // Step 6/7 state
  const [confirming, setConfirming] = useState(false);

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
      setClient(data);
      setCurrentStep(data.onboarding_step || 1);
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

  // Handle payment return
  useEffect(() => {
    if (paymentStatus === 'success' && tokenParam) {
      fetchClient(tokenParam);
    }
  }, [paymentStatus, tokenParam, fetchClient]);

  // Note : le redirect GHL ?call_booked=true ne déclenche plus d'auto-confirm.
  // Le client clique manuellement sur "J'ai réservé mon créneau" (pop-up de
  // confirmation dans handleCallBooked) — un seul chemin de validation, pas de
  // doublon entre auto-handler et bouton.

  const api = async (action: string, extra: Record<string, unknown> = {}) => {
    const r = await fetch(`/api/onboarding?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return r;
  };

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
      if (portalToken) {
        router.replace(`/portal?token=${portalToken}`);
        return;
      }
      // Fallback rare : pas de portal_token renvoyé — on reste sur le funnel.
      setToken(data.token);
      setClient(data.client);
      setCurrentStep(2);
      router.replace(`/onboarding?token=${data.token}`);
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

  // Step 2: Confirm contract signed
  const handleCheckContract = async () => {
    if (!confirm('Avez-vous bien finalisé et confirmé la signature de votre contrat ?')) return;
    setCheckingContract(true);
    setError('');
    try {
      const r = await api('check_contract');
      const data = await r.json();
      if (data.signed) {
        await fetchClient(token);
      } else {
        setError(
          data.error ||
            "Nous n'avons pas encore reçu votre signature. Vérifiez que vous avez bien rempli tous les champs et signé en bas du contrat, puis réessayez dans quelques secondes."
        );
      }
    } catch {
      setError("Impossible de vérifier votre contrat pour le moment. Réessayez dans un instant ou contactez-nous.");
    } finally {
      setCheckingContract(false);
    }
  };

  // Step 4: Book call
  const handleCallBooked = async () => {
    if (!confirm('Avez-vous bien finalisé et confirmé votre rendez-vous d’onboarding ?')) return;
    setCalBooking(true);
    setError('');
    try {
      const r = await api('call_booked', { date: new Date().toISOString() });
      if (!r.ok) throw new Error('Erreur');
      await fetchClient(token);
    } catch {
      setError("Nous n'avons pas pu confirmer votre réservation. Vérifiez que vous avez bien sélectionné un créneau dans le calendrier, puis réessayez.");
    } finally {
      setCalBooking(false);
    }
  };

  // Step 6: Confirm filming
  const handleConfirmFilming = async () => {
    if (!confirm('Avez-vous bien finalisé et confirmé la réservation de votre tournage ?')) return;
    setConfirming(true);
    setError('');
    try {
      const r = await api('confirm_filming');
      if (!r.ok) throw new Error('Erreur');
      await fetchClient(token);
    } catch {
      setError("La confirmation de la date de tournage n'a pas pu être enregistrée. Réessayez ou contactez-nous.");
    } finally {
      setConfirming(false);
    }
  };

  // Step 7: Confirm publication
  const handleConfirmPublication = async () => {
    if (!confirm('Avez-vous bien finalisé et confirmé votre date de publication ?')) return;
    setConfirming(true);
    setError('');
    try {
      const r = await api('confirm_publication');
      if (!r.ok) throw new Error('Erreur');
      await fetchClient(token);
    } catch {
      setError("La confirmation de la date de publication n'a pas pu être enregistrée. Réessayez ou contactez-nous.");
    } finally {
      setConfirming(false);
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

  // Render stepper
  const renderStepper = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 2,
      marginBottom: 32,
      flexWrap: 'wrap',
      padding: '0 8px',
    }}>
      {STEPS.map((step) => {
        const isActive = step.num === currentStep;
        const isDone = step.num < currentStep;
        return (
          <div key={step.num} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              minWidth: 56,
            }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
                background: isDone
                  ? 'var(--green)'
                  : isActive
                    ? 'var(--orange)'
                    : 'var(--night-mid)',
                color: isDone || isActive ? '#fff' : 'var(--text-muted)',
                border: isActive
                  ? '2px solid rgba(232,105,43,.3)'
                  : '1px solid var(--border)',
                transition: 'all .2s',
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}>
                {isDone ? '✓' : step.num}
              </div>
              <span style={{
                fontSize: '0.7rem',
                fontWeight: isActive ? 600 : 400,
                color: isDone ? 'var(--green)' : isActive ? 'var(--orange)' : 'var(--text-muted)',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                letterSpacing: '.2px',
              }}>
                {step.label}
              </span>
            </div>
            {step.num < STEPS.length && (
              <div style={{
                width: 20,
                height: 2,
                background: isDone ? 'var(--green)' : 'var(--border)',
                marginBottom: 22,
                borderRadius: 1,
                transition: 'background .3s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );

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
      router.replace(`/onboarding?token=${data.token}`);
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

  // Step 2: Contract signing (embedded public GHL link)
  const contractPublicUrl = (() => {
    const base = process.env.NEXT_PUBLIC_GHL_CONTRACT_URL || '';
    if (!base || !client) return base;
    const nameParts = client.contact_name?.trim().split(' ') || [];
    const params = new URLSearchParams();
    if (nameParts[0]) params.set('first_name', nameParts[0]);
    if (nameParts.length > 1) params.set('last_name', nameParts.slice(1).join(' '));
    if (client.email) params.set('email', client.email);
    if (client.phone) params.set('phone', client.phone);
    if (client.business_name) params.set('companyName', client.business_name);
    const sep = base.includes('?') ? '&' : '?';
    return base + sep + params.toString();
  })();

  // Show "I signed" button as soon as the contract iframe is loaded (typically 1-2s)
  // with a small grace period so users don't click before reading.
  useEffect(() => {
    if (currentStep === 2 && contractIframeLoaded && !showSignedBtn) {
      const timer = setTimeout(() => setShowSignedBtn(true), 2500);
      return () => clearTimeout(timer);
    }
    // Safety fallback if the iframe load event never fires (rare)
    if (currentStep === 2 && !contractIframeLoaded && !showSignedBtn) {
      const fallback = setTimeout(() => setShowSignedBtn(true), 8000);
      return () => clearTimeout(fallback);
    }
  }, [currentStep, contractIframeLoaded, showSignedBtn]);

  const stepHeaderStyle = (icon: string, title: string, subtitle: string) => (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <div style={{
        width: 52,
        height: 52,
        borderRadius: '50%',
        background: 'rgba(232,105,43,.12)',
        border: '1px solid var(--border-orange)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 14px',
        fontSize: '1.7rem',
        color: 'var(--orange)',
        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
      }} aria-hidden>
        {icon}
      </div>
      <h2 style={{
        color: 'var(--text)',
        fontSize: '1.35rem',
        fontWeight: 700,
        margin: 0,
        letterSpacing: '-.2px',
        fontFamily: "'Bricolage Grotesque', sans-serif",
      }}>
        {title}
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: 8, lineHeight: 1.5, margin: '8px 0 0' }}>
        {subtitle}
      </p>
    </div>
  );

  const errorBox = (msg: string) => (
    <div style={{
      marginTop: 14,
      padding: '10px 14px',
      background: 'rgba(239,68,68,.08)',
      borderLeft: '3px solid var(--red)',
      borderRadius: 6,
      color: '#fca5a5',
      fontSize: '0.84rem',
      lineHeight: 1.5,
    }}>
      {msg}
    </div>
  );

  const renderStep2 = () => (
    <div style={{ ...cardStyle, maxWidth: 900 }}>
      {stepHeaderStyle('✍️', 'Signature du contrat', 'Lisez, remplissez et signez votre contrat ci-dessous. Cela formalise notre collaboration.')}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border-md)',
          background: '#fff',
        }}>
          <iframe
            src={contractPublicUrl}
            onLoad={() => setContractIframeLoaded(true)}
            style={{
              width: '100%',
              height: '80vh',
              minHeight: 600,
              border: 'none',
              display: 'block',
            }}
            title="Contrat de prestation"
            allow="camera;microphone"
          />
        </div>

        {showSignedBtn ? (
          <>
            <div style={{
              padding: '10px 14px',
              background: 'rgba(250,204,21,.08)',
              borderLeft: '3px solid var(--yellow)',
              borderRadius: 6,
              color: 'var(--yellow)',
              fontSize: '0.82rem',
              lineHeight: 1.5,
            }}>
              ⚠ Avant de continuer, clique sur <strong>« Terminé »</strong> en bas du contrat ci-dessus pour finaliser ta signature, <em>puis</em> sur le bouton ci-dessous.
            </div>
            <button
              onClick={handleCheckContract}
              disabled={checkingContract}
              style={{ ...btnPrimary, opacity: checkingContract ? 0.6 : 1, animation: 'fadeIn .4s ease' }}
            >
              {checkingContract ? '⏳ Vérification…' : '✅ J\'ai signé mon contrat'}
            </button>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
              💡 Remplissez et signez dans le contrat ci-dessus, puis cliquez sur le bouton
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Prenez le temps de lire et signer le contrat ci-dessus
          </p>
        )}
      </div>

      {error && errorBox(error)}
    </div>
  );

  // Step 3: Payment (Embedded Stripe Checkout)
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);

  useEffect(() => {
    if (currentStep === 3 && token && !client?.paid_at && !stripeClientSecret && paymentStatus !== 'success') {
      (async () => {
        setError('');
        try {
          const r = await fetch(`/api/onboarding?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create_payment' }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          setStripeClientSecret(data.clientSecret);
        } catch (e: unknown) {
          setError((e as Error).message);
        }
      })();
    }
  }, [currentStep, token, client?.paid_at, stripeClientSecret, paymentStatus]);

  const renderStep3 = () => {
    const isPaid = !!client?.paid_at;
    return (
      <div style={{ ...cardStyle, maxWidth: isPaid || paymentStatus === 'success' ? 520 : 700 }}>
        {stepHeaderStyle('💳', 'Paiement sécurisé', isPaid ? 'Votre paiement a bien été reçu' : 'Réglez votre prestation en toute sécurité avec Stripe')}

        {isPaid ? (
          <SuccessBox
            title="Paiement reçu"
            subtitle={`Payé le ${new Date(client!.paid_at!).toLocaleDateString('fr-FR')}`}
          />
        ) : paymentStatus === 'success' ? (
          <SuccessBox
            title="Paiement en cours de traitement"
            subtitle="Votre paiement est en cours de vérification. Cette page se mettra à jour automatiquement."
          />
        ) : stripeClientSecret && stripePromise ? (
          <div style={{ borderRadius: 12, overflow: 'hidden' }}>
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: stripeClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '3px solid var(--border-md)',
              borderTopColor: 'var(--orange)',
              margin: '0 auto 16px',
              animation: 'spin 1s linear infinite',
            }} />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement du paiement&hellip;</p>
          </div>
        )}

        {error && errorBox(error)}
      </div>
    );
  };

  // Step 4: Onboarding call (embedded GHL Calendar)
  // Fallback chain identique au portail : ONBOARDING_CALENDAR_URL > legacy
  // CALENDAR_URL > id GHL hardcodé. Sans fallback, un env vide rendait
  // l'iframe avec src="" et le calendrier ne se chargeait pas du tout.
  const [showCallBookedBtn, setShowCallBookedBtn] = useState(false);
  const calendarUrl = process.env.NEXT_PUBLIC_GHL_ONBOARDING_CALENDAR_URL
    || process.env.NEXT_PUBLIC_GHL_CALENDAR_URL
    || 'https://api.leadconnectorhq.com/widget/booking/2fmSZkWpwEulfZsvpPmh';

  // Délai volontaire de 30s avant d'afficher le bouton "J'ai réservé" : laisse le
  // temps au client de vraiment finaliser dans GHL et au webhook côté serveur de
  // remonter le rendez-vous. Évite que le client clique trop vite sans avoir
  // confirmé son créneau dans le widget.
  useEffect(() => {
    if (currentStep === 4 && !showCallBookedBtn) {
      const delay = callIframeLoaded ? 30000 : 35000; // +5s si iframe pas encore chargée
      const timer = setTimeout(() => setShowCallBookedBtn(true), delay);
      return () => clearTimeout(timer);
    }
  }, [currentStep, callIframeLoaded, showCallBookedBtn]);

  const renderStep4 = () => (
    <div style={{ ...cardStyle, maxWidth: 900 }}>
      {stepHeaderStyle('📞', 'Appel de lancement', 'Réservez 30 minutes avec notre équipe pour cadrer votre projet')}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GhlBookingEmbed
          url={calendarUrl}
          title="Réservation appel onboarding"
          onLoad={() => setCallIframeLoaded(true)}
          prefill={client ? {
            contact_name: client.contact_name,
            email: client.email,
            phone: client.phone,
            business_name: client.business_name,
          } : undefined}
        />

        {showCallBookedBtn ? (
          <button
            onClick={handleCallBooked}
            disabled={calBooking}
            style={{ ...btnPrimary, opacity: calBooking ? 0.6 : 1, animation: 'fadeIn .4s ease' }}
          >
            {calBooking ? '⏳ Confirmation…' : '✅ J\'ai réservé mon créneau'}
          </button>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            S&eacute;lectionnez un cr&eacute;neau dans le calendrier ci-dessus
          </p>
        )}
      </div>

      {error && errorBox(error)}
    </div>
  );

  // Step 5: Waiting for script — auto-refresh every 2 min so client never feels forgotten
  useEffect(() => {
    if (currentStep !== 5 || !token) return;
    const scripts = client?.scripts || [];
    const allConfirmed = scripts.length > 0 && scripts.every(s => s.status === 'confirmed');
    if (allConfirmed) return;
    const interval = setInterval(() => { fetchClient(token); }, 120000);
    return () => clearInterval(interval);
  }, [currentStep, token, client?.scripts, fetchClient]);

  const renderStep5 = () => {
    const scripts = client?.scripts || [];
    const hasScript = scripts.length > 0;
    const scriptConfirmed = scripts.some(s => s.status === 'confirmed');

    return (
      <div style={cardStyle}>
        {stepHeaderStyle('📝', 'Votre script', scriptConfirmed
          ? '🎉 Votre script a été validé — on s\'occupe du reste !'
          : hasScript
            ? 'Votre script est prêt à être relu dans votre portail.'
            : 'Notre équipe prépare votre script sur mesure.'
        )}
        {scriptConfirmed ? (
          <SuccessBox title="Script validé" subtitle="On s'occupe d'organiser votre tournage. Vous serez notifié dès qu'une date est proposée." />
        ) : hasScript ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              padding: '22px',
              background: 'rgba(232,105,43,.08)',
              border: '1px solid var(--border-orange)',
              borderRadius: 12,
              textAlign: 'center',
            }}>
              <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
                ✨ Votre script est prêt à être relu
              </p>
              <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: '8px 0 0' }}>
                Connectez-vous à votre portail pour le découvrir, demander des modifications ou le valider.
              </p>
            </div>
            {client?.portal_token && (
              <a
                href={`/portal?token=${client.portal_token}`}
                style={{
                  ...btnPrimary,
                  textDecoration: 'none',
                  textAlign: 'center',
                  display: 'block',
                }}
              >
                🚀 Voir mon script dans le portail
              </a>
            )}
          </div>
        ) : (
          <div style={{
            padding: '32px 20px',
            background: 'var(--night-mid)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }} aria-hidden>✍️</div>
            <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
              Notre équipe rédige votre script
            </p>
            <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: '10px 0 0', lineHeight: 1.6 }}>
              On compose un script personnalisé pour votre projet.<br />
              <strong style={{ color: 'var(--text)' }}>Délai habituel : 2 à 5 jours ouvrés.</strong>
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '14px 0 0' }}>
              📧 Vous recevrez un email dès qu&apos;il est prêt — vous pouvez fermer cette page sereinement.
            </p>
          </div>
        )}

        <button
          onClick={() => fetchClient(token)}
          style={{ ...btnSecondary, marginTop: 12 }}
        >
          🔄 Actualiser
        </button>
      </div>
    );
  };

  // Step 6: Confirm filming date
  const renderStep6 = () => (
    <div style={cardStyle}>
      {stepHeaderStyle('🎬', 'Date de tournage', 'Notre équipe vous propose une date — confirmez-la pour la valider')}

      {client?.filming_date ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            padding: '24px',
            background: 'var(--night-mid)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>
              Date proposée
            </p>
            <p style={{ color: 'var(--white)', fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
              {new Date(client.filming_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          <button
            onClick={handleConfirmFilming}
            disabled={confirming}
            style={{ ...btnPrimary, opacity: confirming ? 0.6 : 1 }}
          >
            {confirming ? '⏳ Confirmation…' : '✅ Confirmer cette date'}
          </button>
        </div>
      ) : (
        <div style={{
          padding: '32px 20px',
          background: 'var(--night-mid)',
          borderRadius: 12,
          textAlign: 'center',
        }}>
          <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: 0 }}>
            La date de tournage n&apos;a pas encore été fixée.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '8px 0 0' }}>
            Elle sera définie après validation de votre script.
          </p>
        </div>
      )}

      {error && errorBox(error)}
    </div>
  );

  // Step 7: Confirm publication date
  const renderStep7 = () => (
    <div style={cardStyle}>
      {stepHeaderStyle('📺', 'Date de publication', 'Quand votre vidéo sera-t-elle mise en ligne ? Validez la date proposée.')}

      {client?.publication_date ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            padding: '24px',
            background: 'var(--night-mid)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>
              Date de publication
            </p>
            <p style={{ color: 'var(--white)', fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
              {new Date(client.publication_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          <button
            onClick={handleConfirmPublication}
            disabled={confirming}
            style={{ ...btnPrimary, opacity: confirming ? 0.6 : 1 }}
          >
            {confirming ? '⏳ Confirmation…' : '🎉 Confirmer et finaliser'}
          </button>
        </div>
      ) : (
        <div style={{
          padding: '32px 20px',
          background: 'var(--night-mid)',
          borderRadius: 12,
          textAlign: 'center',
        }}>
          <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: 0 }}>
            La date de publication sera fixée 14 jours après le tournage.
          </p>
        </div>
      )}

      {error && errorBox(error)}
    </div>
  );

  // Step 8: Completed
  const renderCompleted = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'rgba(34,197,94,.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          fontSize: '2.5rem',
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        }} aria-hidden>
          🎉
        </div>
        <h2 style={{ color: 'var(--green)', fontSize: '1.4rem', fontWeight: 700, margin: '0 0 12px' }}>
          Tout est prêt — bienvenue chez nous !
        </h2>
        <p style={{ color: 'var(--text-mid)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
          Merci {client?.contact_name} ! Votre onboarding est terminé.
          <br />Votre tournage est planifié et votre vidéo sera bientôt prête.
        </p>
        {client?.filming_date && (
          <div style={{
            marginTop: 24,
            padding: '16px',
            background: 'var(--night-mid)',
            borderRadius: 12,
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>
              Prochain rendez-vous
            </p>
            <p style={{ color: 'var(--orange)', fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              Tournage le {new Date(client.filming_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        )}
        {client?.portal_token && (
          <a
            href={`/portal?token=${client.portal_token}`}
            style={{
              ...btnPrimary,
              textDecoration: 'none',
              display: 'inline-block',
              marginTop: 24,
              width: 'auto',
              padding: '12px 32px',
            }}
          >
            Accéder à mon espace client
          </a>
        )}
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    if (!token && currentStep === 1) return renderStep1();
    if (!client && currentStep > 1) return (
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
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</p>
      </div>
    );

    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
      case 6: return renderStep6();
      case 7: return renderStep7();
      default: return renderCompleted();
    }
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
        {currentStep >= 1 && currentStep <= 7 && renderStepper()}
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
