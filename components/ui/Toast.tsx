'use client';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  emoji?: string;
  expiresAt?: number;        // pour countdown undo
  action?: ToastAction;
  onDismissed?: () => void;  // appelé si timeout sans interaction (commit)
}

interface UndoableOpts {
  emoji?: string;
  /** Durée du compte à rebours undo. Le toast se ferme à expiration. */
  durationMs?: number;
  /** Action en cas de clic 'Annuler'. */
  onUndo: () => void | Promise<void>;
  /** Action si le user laisse expirer (= confirme). Optionnelle. */
  onCommit?: () => void | Promise<void>;
}

interface ToastContextValue {
  show: (message: string, opts?: { variant?: ToastVariant; emoji?: string; durationMs?: number; action?: ToastAction }) => void;
  success: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  error: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  info: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  warning: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  /** Toast avec bouton 'Annuler' + countdown. Idéal pour archive/delete. */
  undoable: (message: string, opts: UndoableOpts) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLE: Record<ToastVariant, { bg: string; border: string; emoji: string }> = {
  success: { bg: 'rgba(34,197,94,.18)', border: 'rgba(34,197,94,.45)', emoji: '✅' },
  error: { bg: 'rgba(239,68,68,.18)', border: 'rgba(239,68,68,.45)', emoji: '❌' },
  info: { bg: 'rgba(59,130,246,.18)', border: 'rgba(59,130,246,.45)', emoji: 'ℹ️' },
  warning: { bg: 'rgba(250,204,21,.18)', border: 'rgba(250,204,21,.55)', emoji: '⚠️' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string, viaInteraction = false) => {
    setToasts((prev) => {
      const target = prev.find(t => t.id === id);
      // Si le toast a un onDismissed (= commit) et qu'on dismiss sans interaction
      // explicite, on appelle le callback (timeout = confirme l'action).
      if (target?.onDismissed && !viaInteraction) {
        try { target.onDismissed(); } catch { /* */ }
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const show: ToastContextValue['show'] = useCallback((message, opts) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const variant = opts?.variant || 'info';
    setToasts((prev) => [...prev, { id, message, variant, emoji: opts?.emoji, action: opts?.action }]);
    const duration = opts?.durationMs ?? (variant === 'error' ? 5000 : 3500);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }, [dismiss]);

  const undoable: ToastContextValue['undoable'] = useCallback((message, opts) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const duration = opts.durationMs ?? 5000;
    const expiresAt = Date.now() + duration;
    setToasts((prev) => [...prev, {
      id, message, variant: 'info', emoji: opts.emoji || '↩️', expiresAt,
      action: {
        label: 'Annuler',
        onClick: () => {
          try { Promise.resolve(opts.onUndo()).catch(() => null); } catch { /* */ }
          dismiss(id, true);
        },
      },
      onDismissed: opts.onCommit ? () => { Promise.resolve(opts.onCommit!()).catch(() => null); } : undefined,
    }]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  // Pont via window event : permet à n'importe quel composant (même un qui
  // s'apprête à démonter, ex: handleDelete + redirect) de déclencher un toast
  // undoable depuis le ToastProvider monté dans le layout.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUndoable = (e: Event) => {
      const ce = e as CustomEvent<{ message: string; emoji?: string; durationMs?: number; onUndo: () => void; onCommit?: () => void }>;
      const d = ce.detail;
      if (!d) return;
      undoable(d.message, { emoji: d.emoji, durationMs: d.durationMs, onUndo: d.onUndo, onCommit: d.onCommit });
    };
    window.addEventListener('bbm-toast-undoable', onUndoable);
    return () => window.removeEventListener('bbm-toast-undoable', onUndoable);
  }, [undoable]);

  const value: ToastContextValue = {
    show,
    success: (m, o) => show(m, { ...o, variant: 'success' }),
    error: (m, o) => show(m, { ...o, variant: 'error' }),
    info: (m, o) => show(m, { ...o, variant: 'info' }),
    warning: (m, o) => show(m, { ...o, variant: 'warning' }),
    undoable,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 9999,
          maxWidth: 'calc(100vw - 32px)',
        }}
      >
        {toasts.map((t) => <ToastCard key={t.id} t={t} dismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ t, dismiss }: { t: ToastItem; dismiss: (id: string, viaInteraction?: boolean) => void }) {
  const v = VARIANT_STYLE[t.variant];
  const [remaining, setRemaining] = useState<number | null>(null);
  // Tick toutes les 100ms si on a un expiresAt (countdown undo)
  useEffect(() => {
    if (!t.expiresAt) return;
    const tick = () => {
      const ms = Math.max(0, t.expiresAt! - Date.now());
      setRemaining(ms);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [t.expiresAt]);

  const totalMs = t.expiresAt ? Math.max(1, t.expiresAt - (Date.now() - 100)) : 0;
  const pct = remaining !== null && totalMs ? Math.max(0, Math.min(100, (remaining / 5000) * 100)) : 100;
  const seconds = remaining !== null ? Math.ceil(remaining / 1000) : null;

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderRadius: 12,
        background: v.bg, border: `1px solid ${v.border}`,
        backdropFilter: 'blur(10px)', color: 'var(--text)',
        fontSize: 14, minWidth: 260, maxWidth: 480,
        boxShadow: '0 12px 32px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.2)',
        animation: 'bm-toast-rise 350ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        position: 'relative', overflow: 'hidden',
      }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>{t.emoji || v.emoji}</span>
      <span style={{ flex: 1 }}>{t.message}</span>
      {t.action && (
        <button
          onClick={t.action.onClick}
          style={{
            background: 'rgba(255,255,255,.08)',
            border: '1px solid rgba(255,255,255,.18)',
            color: 'var(--text)', borderRadius: 7,
            padding: '5px 11px', fontSize: '0.78rem', fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {t.action.label}{seconds !== null ? ` (${seconds}s)` : ''}
        </button>
      )}
      {!t.action && (
        <button
          aria-label="Fermer"
          onClick={() => dismiss(t.id, true)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-mid)',
            cursor: 'pointer', fontSize: 16, padding: 4, lineHeight: 1,
          }}
        >✕</button>
      )}
      {/* Countdown progress bar (visible si undoable) */}
      {t.expiresAt && (
        <div style={{
          position: 'absolute', left: 0, bottom: 0, height: 2,
          width: `${pct}%`, background: v.border,
          transition: 'width 100ms linear',
        }} />
      )}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback no-op implementation when provider is missing — keeps UI from crashing.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('useToast() used outside <ToastProvider>. Toasts will be silent.');
    }
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
      undoable: (_m, opts) => { Promise.resolve(opts.onCommit?.()).catch(() => null); },
    };
  }
  return ctx;
}
