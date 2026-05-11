'use client';

import { useEffect, useState } from 'react';

// Bannière d'aide à l'installation PWA :
// - Sur iOS Safari (pas d'API beforeinstallprompt), affiche l'instruction
//   "Partager → Sur l'écran d'accueil" qui est le seul chemin natif sur
//   iPhone/iPad.
// - Sur Android/Chromium, capture l'évènement beforeinstallprompt et expose
//   un bouton "Installer".
// Dans les deux cas on stocke la dismissal dans localStorage pour ne pas
// re-spammer l'admin à chaque login.

const DISMISS_KEY = 'bbm_pwa_dismissed_v1';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // iPad sur iOS 13+ se présente comme MacIntel avec touch — détection
  // dédiée pour ne pas rater les iPads modernes.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS exposait navigator.standalone, les autres regardent display-mode.
  const navStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return navStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export default function InstallPWAPrompt() {
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    if (isIos()) {
      // Délai pour ne pas s'afficher au tout premier paint, laisser
      // l'utilisateur prendre ses marques.
      const t = setTimeout(() => { setIosHint(true); setShow(true); }, 3500);
      return () => clearTimeout(t);
    }

    const onBefore = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onBefore);
    return () => window.removeEventListener('beforeinstallprompt', onBefore);
  }, []);

  if (!show) return null;

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') {
        localStorage.setItem(DISMISS_KEY, '1');
        setShow(false);
      }
    } catch { /* */ }
    setDeferred(null);
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Installer l'application"
      style={{
        position: 'fixed',
        left: 'max(12px, env(safe-area-inset-left))',
        right: 'max(12px, env(safe-area-inset-right))',
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        zIndex: 9000,
        background: 'var(--night-card)',
        border: '1px solid var(--border-md)',
        borderRadius: 14,
        padding: '12px 14px',
        boxShadow: '0 12px 32px rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 520,
        margin: '0 auto',
        animation: 'bm-slide-up var(--t-base) var(--ease-out) both',
      }}
    >
      <span aria-hidden style={{ fontSize: '1.6rem', lineHeight: 1 }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text)' }}>
          Installer BourbonMédia
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>
          {iosHint
            ? <>Appuyez sur <span aria-label="Partager" style={{ display: 'inline-block', transform: 'translateY(2px)' }}>⬆️</span> puis <strong>« Sur l&apos;écran d&apos;accueil »</strong>.</>
            : 'Accès rapide, notifications, mode hors-ligne.'}
        </div>
      </div>
      {!iosHint && (
        <button
          onClick={install}
          style={{
            padding: '8px 14px', borderRadius: 8,
            background: 'var(--orange)', border: 'none', color: '#fff',
            fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >Installer</button>
      )}
      <button
        onClick={dismiss}
        aria-label="Plus tard"
        style={{
          padding: 6, borderRadius: 6,
          background: 'transparent', border: 'none',
          color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: '1.1rem', lineHeight: 1,
        }}
      >✕</button>
    </div>
  );
}
