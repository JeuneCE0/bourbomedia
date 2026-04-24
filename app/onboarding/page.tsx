'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const STEPS = [
  { num: 1, label: 'Compte', icon: '◉' },
  { num: 2, label: 'Contrat', icon: '✎' },
  { num: 3, label: 'Paiement', icon: '€' },
  { num: 4, label: 'Appel', icon: '☎' },
  { num: 5, label: 'Script', icon: '▤' },
  { num: 6, label: 'Tournage', icon: '▶' },
  { num: 7, label: 'Publication', icon: '◈' },
];

interface ClientData {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  onboarding_step: number;
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

  // Step 1 form
  const [form, setForm] = useState({ business_name: '', contact_name: '', email: '', phone: '', password: '', passwordConfirm: '' });

  // Step 2 state
  const [checkingContract, setCheckingContract] = useState(false);
  const [showSignedBtn, setShowSignedBtn] = useState(false);

  // Step 4 state
  const [calBooking, setCalBooking] = useState(false);

  // Step 6/7 state
  const [confirming, setConfirming] = useState(false);

  const fetchClient = useCallback(async (t: string) => {
    try {
      const r = await fetch(`/api/onboarding?token=${t}`);
      if (!r.ok) throw new Error('Token invalide');
      const data = await r.json();
      setClient(data);
      setCurrentStep(data.onboarding_step || 1);
      return data;
    } catch {
      setError('Lien invalide ou expiré');
      return null;
    }
  }, []);

  useEffect(() => {
    if (tokenParam) {
      setToken(tokenParam);
      fetchClient(tokenParam);
    }
  }, [tokenParam, fetchClient]);

  // Handle payment return
  useEffect(() => {
    if (paymentStatus === 'success' && tokenParam) {
      fetchClient(tokenParam);
    }
  }, [paymentStatus, tokenParam, fetchClient]);

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
      setToken(data.token);
      setClient(data.client);
      setCurrentStep(2);
      router.replace(`/onboarding?token=${data.token}`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Confirm contract signed
  const handleCheckContract = async () => {
    setCheckingContract(true);
    setError('');
    try {
      const r = await api('check_contract');
      const data = await r.json();
      if (data.signed) {
        await fetchClient(token);
      } else {
        setError(data.error || 'Erreur de confirmation');
      }
    } catch {
      setError('Erreur de confirmation');
    } finally {
      setCheckingContract(false);
    }
  };

  // Step 4: Book call
  const handleCallBooked = async () => {
    setCalBooking(true);
    setError('');
    try {
      const r = await api('call_booked', { date: new Date().toISOString() });
      if (!r.ok) throw new Error('Erreur');
      await fetchClient(token);
    } catch {
      setError('Erreur de réservation');
    } finally {
      setCalBooking(false);
    }
  };

  // Step 6: Confirm filming
  const handleConfirmFilming = async () => {
    setConfirming(true);
    setError('');
    try {
      const r = await api('confirm_filming');
      if (!r.ok) throw new Error('Erreur');
      await fetchClient(token);
    } catch {
      setError('Erreur de confirmation');
    } finally {
      setConfirming(false);
    }
  };

  // Step 7: Confirm publication
  const handleConfirmPublication = async () => {
    setConfirming(true);
    setError('');
    try {
      const r = await api('confirm_publication');
      if (!r.ok) throw new Error('Erreur');
      await fetchClient(token);
    } catch {
      setError('Erreur de confirmation');
    } finally {
      setConfirming(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    background: 'var(--night-mid)',
    border: '1px solid var(--border-md)',
    borderRadius: 10,
    color: 'var(--text)',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'border-color .2s',
  };

  const btnPrimary: React.CSSProperties = {
    width: '100%',
    padding: '14px 24px',
    background: 'var(--orange)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all .2s',
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary,
    background: 'transparent',
    border: '1px solid var(--border-md)',
    color: 'var(--text-mid)',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--night-card)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '32px',
    maxWidth: 520,
    width: '100%',
    margin: '0 auto',
  };

  // Render stepper
  const renderStepper = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 4,
      marginBottom: 40,
      flexWrap: 'wrap',
      padding: '0 16px',
    }}>
      {STEPS.map((step) => {
        const isActive = step.num === currentStep;
        const isDone = step.num < currentStep;
        const isFuture = step.num > currentStep;
        return (
          <div key={step.num} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              minWidth: 56,
            }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isDone ? '1rem' : '0.8rem',
                fontWeight: 700,
                background: isDone ? 'var(--green)' : isActive ? 'var(--orange)' : 'var(--night-mid)',
                color: isDone || isActive ? '#fff' : 'var(--text-muted)',
                border: isFuture ? '2px solid var(--border-md)' : 'none',
                transition: 'all .3s',
              }}>
                {isDone ? '✓' : step.icon}
              </div>
              <span style={{
                fontSize: '0.65rem',
                fontWeight: isActive ? 600 : 400,
                color: isDone ? 'var(--green)' : isActive ? 'var(--orange)' : 'var(--text-muted)',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {step.num < STEPS.length && (
              <div style={{
                width: 24,
                height: 2,
                background: isDone ? 'var(--green)' : 'var(--border-md)',
                marginBottom: 20,
                borderRadius: 1,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );

  // Step 1: Account creation form
  const renderStep1 = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>◉</div>
        <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
          Créez votre compte
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
          Bienvenue chez BourbonMédia ! Commencez par créer votre espace client.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6, display: 'block' }}>
            Nom de l&apos;entreprise *
          </label>
          <input
            style={inputStyle}
            placeholder="Ex: Ma Super Entreprise"
            value={form.business_name}
            onChange={e => setForm({ ...form, business_name: e.target.value })}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6, display: 'block' }}>
            Nom du contact *
          </label>
          <input
            style={inputStyle}
            placeholder="Prénom Nom"
            value={form.contact_name}
            onChange={e => setForm({ ...form, contact_name: e.target.value })}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6, display: 'block' }}>
            Email *
          </label>
          <input
            type="email"
            style={inputStyle}
            placeholder="email@entreprise.re"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6, display: 'block' }}>
            Téléphone
          </label>
          <input
            type="tel"
            style={inputStyle}
            placeholder="0692 XX XX XX"
            value={form.phone}
            onChange={e => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6, display: 'block' }}>
            Mot de passe *
          </label>
          <input
            type="password"
            style={inputStyle}
            placeholder="6 caractères minimum"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6, display: 'block' }}>
            Confirmer le mot de passe *
          </label>
          <input
            type="password"
            style={inputStyle}
            placeholder="Répétez le mot de passe"
            value={form.passwordConfirm}
            onChange={e => setForm({ ...form, passwordConfirm: e.target.value })}
          />
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 8,
          color: 'var(--red)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleCreateAccount}
        disabled={loading}
        style={{ ...btnPrimary, marginTop: 24, opacity: loading ? 0.6 : 1 }}
      >
        {loading ? 'Création en cours…' : 'Créer mon compte'}
      </button>
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

  useEffect(() => {
    if (currentStep === 2 && !showSignedBtn) {
      const timer = setTimeout(() => setShowSignedBtn(true), 30000);
      return () => clearTimeout(timer);
    }
  }, [currentStep, showSignedBtn]);

  const renderStep2 = () => (
    <div style={{ ...cardStyle, maxWidth: 900 }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#9998;</div>
        <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
          Signature du contrat
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
          Lisez, remplissez et signez votre contrat de prestation ci-dessous.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border-md)',
          background: '#fff',
        }}>
          <iframe
            src={contractPublicUrl}
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
            <button
              onClick={handleCheckContract}
              disabled={checkingContract}
              style={{ ...btnPrimary, opacity: checkingContract ? 0.6 : 1, animation: 'fadeIn .4s ease' }}
            >
              {checkingContract ? 'Confirmation...' : 'J\'ai signé mon contrat'}
            </button>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
              Remplissez et signez dans le formulaire ci-dessus, puis cliquez sur le bouton
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Prenez le temps de lire et signer le contrat ci-dessus
          </p>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 8,
          color: 'var(--red)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}
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
      <div style={{ ...cardStyle, maxWidth: isPaid || paymentStatus === 'success' ? 520 : 640 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#8364;</div>
          <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
            Paiement
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
            {isPaid ? 'Votre paiement a été confirmé !' : 'Réglez votre prestation de manière sécurisée.'}
          </p>
        </div>

        {isPaid ? (
          <div style={{
            padding: '24px',
            background: 'rgba(34,197,94,.1)',
            border: '1px solid rgba(34,197,94,.3)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#10003;</div>
            <p style={{ color: 'var(--green)', fontWeight: 600, margin: 0 }}>Paiement re&ccedil;u</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 4 }}>
              Pay&eacute; le {new Date(client!.paid_at!).toLocaleDateString('fr-FR')}
            </p>
          </div>
        ) : paymentStatus === 'success' ? (
          <div style={{
            padding: '24px',
            background: 'rgba(34,197,94,.1)',
            border: '1px solid rgba(34,197,94,.3)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#10003;</div>
            <p style={{ color: 'var(--green)', fontWeight: 600, margin: 0 }}>Paiement en cours de traitement</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 4 }}>
              Votre paiement est en cours de v&eacute;rification. Cette page se mettra &agrave; jour automatiquement.
            </p>
          </div>
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

        {error && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'rgba(239,68,68,.1)',
            border: '1px solid rgba(239,68,68,.3)',
            borderRadius: 8,
            color: 'var(--red)',
            fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}
      </div>
    );
  };

  // Step 4: Onboarding call
  const renderStep4 = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>☎</div>
        <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
          Appel de lancement
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
          Réservez un créneau pour votre appel de lancement avec notre équipe.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          padding: '20px',
          background: 'var(--night-mid)',
          borderRadius: 12,
        }}>
          <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: 0, lineHeight: 1.6 }}>
            Durant cet appel de 30 minutes, nous allons :
          </p>
          <ul style={{ color: 'var(--text)', fontSize: '0.85rem', margin: '12px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
            <li>Discuter de vos objectifs vidéo</li>
            <li>Définir le ton et le style souhaité</li>
            <li>Planifier le tournage</li>
            <li>Répondre à toutes vos questions</li>
          </ul>
        </div>

        <a
          href={process.env.NEXT_PUBLIC_GHL_CALENDAR_URL || '#'}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...btnPrimary,
            textDecoration: 'none',
            textAlign: 'center',
            display: 'block',
          }}
        >
          Réserver mon créneau ↗
        </a>

        <button
          onClick={handleCallBooked}
          disabled={calBooking}
          style={{ ...btnSecondary, opacity: calBooking ? 0.6 : 1 }}
        >
          {calBooking ? 'Confirmation…' : 'J\'ai réservé mon créneau'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 8,
          color: 'var(--red)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}
    </div>
  );

  // Step 5: Waiting for script
  const renderStep5 = () => {
    const scripts = client?.scripts || [];
    const hasScript = scripts.length > 0;
    const scriptConfirmed = scripts.some(s => s.status === 'confirmed');

    return (
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>▤</div>
          <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
            Script vidéo
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
            {scriptConfirmed
              ? 'Votre script a été validé !'
              : hasScript
                ? 'Votre script est en cours de préparation. Consultez-le et donnez votre avis.'
                : 'Notre équipe prépare votre script. Vous serez notifié dès qu\'il sera prêt.'
            }
          </p>
        </div>

        {scriptConfirmed ? (
          <div style={{
            padding: '24px',
            background: 'rgba(34,197,94,.1)',
            border: '1px solid rgba(34,197,94,.3)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>✓</div>
            <p style={{ color: 'var(--green)', fontWeight: 600, margin: 0 }}>Script validé</p>
          </div>
        ) : hasScript ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              padding: '20px',
              background: 'var(--night-mid)',
              borderRadius: 12,
              textAlign: 'center',
            }}>
              <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: 0 }}>
                Un script vous a été soumis. Accédez à votre portail client pour le consulter et le valider.
              </p>
            </div>
            {client && (
              <a
                href={`/portal?token=${client.id}`}
                style={{
                  ...btnPrimary,
                  textDecoration: 'none',
                  textAlign: 'center',
                  display: 'block',
                }}
              >
                Accéder à mon portail client ↗
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
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '3px solid var(--border-md)',
              borderTopColor: 'var(--orange)',
              margin: '0 auto 16px',
              animation: 'spin 1s linear infinite',
            }} />
            <p style={{ color: 'var(--text-mid)', fontSize: '0.85rem', margin: 0 }}>
              En attente de votre script…
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '8px 0 0' }}>
              Vous recevrez une notification quand il sera prêt.
            </p>
          </div>
        )}

        <button
          onClick={() => fetchClient(token)}
          style={{ ...btnSecondary, marginTop: 16 }}
        >
          Actualiser
        </button>
      </div>
    );
  };

  // Step 6: Confirm filming date
  const renderStep6 = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>▶</div>
        <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
          Date de tournage
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
          Confirmez la date de tournage proposée par notre équipe.
        </p>
      </div>

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
            {confirming ? 'Confirmation…' : 'Confirmer cette date'}
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

      {error && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 8,
          color: 'var(--red)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}
    </div>
  );

  // Step 7: Confirm publication date
  const renderStep7 = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>◈</div>
        <h2 style={{ color: 'var(--white)', fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>
          Date de publication
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
          Confirmez la date de publication de votre vidéo.
        </p>
      </div>

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
            {confirming ? 'Confirmation…' : 'Confirmer et finaliser'}
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

      {error && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 8,
          color: 'var(--red)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}
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
        }}>
          ✓
        </div>
        <h2 style={{ color: 'var(--green)', fontSize: '1.4rem', fontWeight: 700, margin: '0 0 12px' }}>
          Onboarding terminé !
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
        {client && (
          <a
            href={`/portal?token=${client.id}`}
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
          fontSize: '1.2rem',
          color: 'var(--orange)',
        }}>
          BourbonMédia
        </span>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '32px 16px',
        maxWidth: 640,
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
          BourbonMédia — Production vidéo à La Réunion
        </p>
      </footer>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
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
