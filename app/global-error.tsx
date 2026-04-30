'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/error-log';

// global-error.tsx capture les erreurs qui s'échappent du root layout
// (très rare — typiquement un crash dans le layout lui-même). Doit
// inclure html/body car remplace tout le rendu. Pas de globals.css ici
// pour éviter une dépendance circulaire — on inline les couleurs BBM.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/global-error.tsx]', error);
    reportClientError({
      digest: error.digest || null,
      message: error.message || null,
      stack: error.stack || null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata: { boundary: 'app/global-error.tsx' },
    });
  }, [error]);

  return (
    <html lang="fr">
      <body style={{
        margin: 0,
        background: '#0F0F12',
        color: '#F5F5F7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{
          maxWidth: 480, width: '100%',
          background: '#1F1F24',
          border: '1px solid rgba(255,255,255,.08)',
          borderRadius: 16,
          padding: '32px 28px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 16 }} aria-hidden>⚠️</div>
          <h1 style={{
            fontSize: '1.3rem', fontWeight: 700,
            margin: '0 0 10px',
          }}>
            Erreur critique
          </h1>
          <p style={{
            fontSize: '0.92rem', color: '#B8B8BD',
            lineHeight: 1.6, margin: '0 0 24px',
          }}>
            Une erreur inattendue est survenue. Veuillez recharger la page.
            Si le problème persiste, contactez l&apos;équipe BourbonMédia.
          </p>
          {error.digest && (
            <p style={{
              fontSize: '0.7rem', color: '#8A8A90',
              fontFamily: 'monospace',
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
              background: '#E8692B',
              color: '#fff', border: 'none',
              fontSize: '0.92rem', fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
        </div>
      </body>
    </html>
  );
}
