'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'bbm_welcome_wizard_v1_seen';

interface Step {
  emoji: string;
  title: string;
  description: string;
  cta?: { label: string; href: string };
}

const STEPS: Step[] = [
  {
    emoji: '👋',
    title: 'Bienvenue dans Bourbomedia Admin',
    description: 'Tour rapide en 4 étapes pour t\'orienter. Tu peux fermer à tout moment et y revenir via Réglages.',
  },
  {
    emoji: '🌊',
    title: 'Pipeline — ton flux commercial + production',
    description: 'Tous les prospects et clients en un seul endroit, organisés par stages GHL (commerciale) et étapes Bourbomedia (onboarding). Clique sur une carte pour éditer / contacter / supprimer.',
    cta: { label: 'Voir le Pipeline', href: '/dashboard/pipeline' },
  },
  {
    emoji: '🗓️',
    title: 'Calendrier — tous tes RDV remontés',
    description: 'Closing, onboarding, tournages : tout est synchronisé depuis GHL toutes les 15 min. Vue Grille pour le mois, vue Liste pour l\'agenda chronologique.',
    cta: { label: 'Ouvrir le Calendrier', href: '/dashboard/calendar' },
  },
  {
    emoji: '👥',
    title: 'Fiche client — la source de vérité',
    description: 'Chaque client a 5 onglets : Aperçu · Closing & RDV · Script · Montage · Paiements. Toutes les données GHL + Stripe + scripts + vidéos sont centralisées ici.',
    cta: { label: 'Voir mes clients', href: '/dashboard/clients' },
  },
  {
    emoji: '⚙️',
    title: 'Réglages — budget, équipe, intégrations',
    description: 'Configure ton budget Ads mensuel, ajoute des membres de ton équipe, vérifie les connexions GHL/Stripe/Slack.',
    cta: { label: 'Ouvrir les Réglages', href: '/dashboard/settings' },
  },
];

export default function WelcomeWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setOpen(true);
  }, []);

  function close() {
    setOpen(false);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, '1');
  }

  if (!open) return null;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, animation: 'bm-modal-backdrop var(--t-fast) ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 540, padding: 'clamp(24px, 4vw, 36px)',
          borderRadius: 18, background: 'var(--night-card)',
          border: '1px solid var(--border-md)',
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
          animation: 'bm-modal-pop var(--t-base) var(--ease-bounce) both',
          position: 'relative',
        }}
      >
        {/* Close X */}
        <button
          onClick={close}
          aria-label="Fermer"
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', padding: 4, lineHeight: 1,
          }}
        >×</button>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 999,
              background: i <= step ? 'var(--orange)' : 'var(--night-mid)',
              transition: 'background .25s',
            }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '3rem', marginBottom: 14 }}>{current.emoji}</div>
          <h2 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: 'clamp(1.3rem, 3vw, 1.6rem)', color: 'var(--text)',
            margin: '0 0 12px', lineHeight: 1.2,
          }}>
            {current.title}
          </h2>
          <p style={{
            fontSize: '0.92rem', color: 'var(--text-mid)',
            margin: 0, lineHeight: 1.6, maxWidth: 440, marginInline: 'auto',
          }}>
            {current.description}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={close}
            style={{
              padding: '8px 14px', borderRadius: 8, background: 'transparent',
              border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 500,
            }}
          >Passer</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{
                  padding: '9px 16px', borderRadius: 8,
                  background: 'transparent', border: '1px solid var(--border-md)',
                  color: 'var(--text-mid)', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600,
                }}
              >← Précédent</button>
            )}
            {current.cta && (
              <Link
                href={current.cta.href}
                onClick={close}
                style={{
                  padding: '9px 16px', borderRadius: 8,
                  background: 'transparent', border: '1px solid var(--orange)',
                  color: 'var(--orange)', textDecoration: 'none', fontSize: '0.84rem', fontWeight: 600,
                }}
              >{current.cta.label} ↗</Link>
            )}
            {isLast ? (
              <button
                onClick={close}
                style={{
                  padding: '11px 22px', borderRadius: 10,
                  background: 'var(--orange)', color: '#fff', border: 'none',
                  cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(232,105,43,.4)',
                }}
              >🎉 C&apos;est parti</button>
            ) : (
              <button
                onClick={() => setStep(s => s + 1)}
                style={{
                  padding: '11px 22px', borderRadius: 10,
                  background: 'var(--orange)', color: '#fff', border: 'none',
                  cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(232,105,43,.4)',
                }}
              >Suivant →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
