'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/error-log';

// Error boundary racine de l'app — capture toutes les erreurs runtime non
// interceptées par les <ErrorBoundary> internes (dashboard / portal). Sans
// ce fichier Next.js sert sa page par défaut "Application error: a
// client-side exception has occurred" qui inquiète les clients. Ici on
// affiche un fallback BBM avec bouton "réessayer" + ref erreur pour le
// support. Cette UI est rendue à l'intérieur du root layout (donc styles
// + globals.css déjà appliqués), pas besoin de re-déclarer html/body.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log côté Vercel Functions (visible dans le dashboard Vercel → Logs).
    console.error('[app/error.tsx]', error);
    // Persiste dans la table error_logs côté Supabase pour qu'on puisse
    // visualiser dans /dashboard/errors. Best-effort, fire-and-forget.
    reportClientError({
      digest: error.digest || null,
      message: error.message || null,
      stack: error.stack || null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata: { boundary: 'app/error.tsx' },
    });
  }, [error]);

  return (
    <div style={{
      background: 'var(--night)',
      color: 'var(--text)',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: 480, width: '100%',
        background: 'var(--night-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '32px 28px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56,
          borderRadius: '50%',
          background: 'rgba(239,68,68,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 18px',
          fontSize: '1.6rem',
        }} aria-hidden>⚠️</div>
        <h1 style={{
          fontFamily: '"Bricolage Grotesque", sans-serif',
          fontSize: '1.3rem', fontWeight: 700,
          color: 'var(--text)', margin: '0 0 10px',
        }}>
          Une erreur est survenue
        </h1>
        <p style={{
          fontSize: '0.92rem', color: 'var(--text-mid)',
          lineHeight: 1.6, margin: '0 0 24px',
        }}>
          Désolé, quelque chose s&apos;est mal passé. Vous pouvez réessayer
          ou contacter l&apos;équipe BourbonMédia si le problème persiste.
        </p>
        {error.digest && (
          <p style={{
            fontSize: '0.7rem', color: 'var(--text-muted)',
            fontFamily: 'monospace',
            padding: '6px 10px',
            background: 'rgba(255,255,255,.04)',
            borderRadius: 6,
            margin: '0 0 18px',
          }}>
            Réf : {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            padding: '12px 24px',
            borderRadius: 10,
            background: 'var(--orange)',
            color: '#fff', border: 'none',
            fontSize: '0.92rem', fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(232,105,43,.3)',
          }}
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
