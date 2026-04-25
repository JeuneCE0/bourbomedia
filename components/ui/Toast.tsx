'use client';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  emoji?: string;
}

interface ToastContextValue {
  show: (message: string, opts?: { variant?: ToastVariant; emoji?: string; durationMs?: number }) => void;
  success: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  error: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  info: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
  warning: (message: string, opts?: { emoji?: string; durationMs?: number }) => void;
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

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show: ToastContextValue['show'] = useCallback((message, opts) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const variant = opts?.variant || 'info';
    setToasts((prev) => [...prev, { id, message, variant, emoji: opts?.emoji }]);
    const duration = opts?.durationMs ?? (variant === 'error' ? 5000 : 3500);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }, [dismiss]);

  const value: ToastContextValue = {
    show,
    success: (m, o) => show(m, { ...o, variant: 'success' }),
    error: (m, o) => show(m, { ...o, variant: 'error' }),
    info: (m, o) => show(m, { ...o, variant: 'info' }),
    warning: (m, o) => show(m, { ...o, variant: 'warning' }),
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
        {toasts.map((t) => {
          const v = VARIANT_STYLE[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 12,
                background: v.bg,
                border: `1px solid ${v.border}`,
                backdropFilter: 'blur(10px)',
                color: 'var(--text)',
                fontSize: 14,
                minWidth: 240,
                maxWidth: 420,
                boxShadow: '0 12px 32px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.2)',
                animation: 'bm-toast-rise 350ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{t.emoji || v.emoji}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                aria-label="Fermer"
                onClick={() => dismiss(t.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-mid)',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 4,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
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
    };
  }
  return ctx;
}
