'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  scope?: string; // pour distinguer dans les logs : 'dashboard', 'pipeline', 'closing'…
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log côté navigateur — Vercel ne capture pas les erreurs client par défaut
    // mais l'admin verra dans la console + on peut envoyer à un endpoint si
    // besoin d'agréger côté serveur plus tard.
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(this.state.error || new Error('Unknown'), this.reset);
    }

    return <DefaultFallback error={this.state.error} reset={this.reset} scope={this.props.scope} />;
  }
}

function DefaultFallback({ error, reset, scope }: { error: Error | null; reset: () => void; scope?: string }) {
  return (
    <div style={{
      margin: 'clamp(20px, 4vw, 40px) auto',
      maxWidth: 540,
      padding: 'clamp(24px, 4vw, 32px)',
      borderRadius: 14,
      background: 'var(--night-card)',
      border: '1px solid rgba(239,68,68,.3)',
      boxShadow: '0 8px 24px rgba(0,0,0,.3)',
    }}>
      <div style={{ fontSize: '2.2rem', marginBottom: 12 }} aria-hidden>⚠️</div>
      <h2 style={{
        fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
        fontSize: '1.3rem', color: 'var(--text)', margin: '0 0 6px',
      }}>
        Une erreur s&apos;est glissée
      </h2>
      <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
        Le reste de l&apos;application reste utilisable. Tu peux essayer de recharger ce
        composant ou rafraîchir la page entière.
      </p>

      {error?.message && (
        <details style={{
          padding: 12, borderRadius: 8,
          background: 'var(--night-mid)', border: '1px solid var(--border)',
          marginBottom: 16,
        }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-mid)', fontWeight: 600 }}>
            Détails techniques{scope && ` (${scope})`}
          </summary>
          <pre style={{
            margin: '8px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontFamily: 'monospace',
          }}>{error.message}{error.stack ? '\n\n' + error.stack.slice(0, 600) : ''}</pre>
        </details>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={reset} style={{
          padding: '10px 18px', borderRadius: 8, background: 'var(--orange)',
          border: 'none', color: '#fff', fontSize: '0.86rem', fontWeight: 700,
          cursor: 'pointer',
        }}>↻ Réessayer</button>
        <button onClick={() => window.location.reload()} style={{
          padding: '10px 18px', borderRadius: 8, background: 'var(--night-mid)',
          border: '1px solid var(--border-md)', color: 'var(--text-mid)',
          fontSize: '0.86rem', fontWeight: 600, cursor: 'pointer',
        }}>Recharger la page</button>
      </div>
    </div>
  );
}
