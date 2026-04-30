import { supaFetch } from '@/lib/supabase';

// Helpers pour log les erreurs runtime dans la table error_logs.
// Côté client : POST /api/errors (cf. app/api/errors/route.ts).
// Côté server : appel direct via supaFetch() avec service key.

interface LogServerErrorInput {
  error: unknown;
  url?: string;
  metadata?: Record<string, unknown>;
}

export async function logServerError({ error, url, metadata }: LogServerErrorInput): Promise<void> {
  // Best-effort : on ne propage jamais une erreur ici pour ne pas masquer
  // l'erreur d'origine du caller. Truncate stack/message à 16 KB pour
  // ne pas dépasser la check size de 8 KB sur metadata + colonne TEXT
  // raisonnable.
  try {
    const e = error as { message?: string; stack?: string; digest?: string };
    await supaFetch('error_logs', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        source: 'server',
        digest: e?.digest?.slice(0, 64) || null,
        message: (e?.message || String(error)).slice(0, 1024),
        stack: e?.stack?.slice(0, 16384) || null,
        url: url?.slice(0, 1024) || null,
        metadata: metadata && JSON.stringify(metadata).length < 7000 ? metadata : null,
      }),
    }, true);
  } catch {
    // tolerate — la log doit jamais cause un cascade error.
  }
}

// Côté browser : envoie l'erreur à /api/errors. Appelé depuis app/error.tsx
// et app/global-error.tsx. Le payload est minimaliste pour ne pas exposer
// des infos sensibles (le stack trace seul suffit pour debug).
export interface ClientErrorPayload {
  digest?: string | null;
  message?: string | null;
  stack?: string | null;
  url?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function reportClientError(payload: ClientErrorPayload): void {
  if (typeof window === 'undefined') return;
  // Fire-and-forget. navigator.sendBeacon est plus robuste qu'un fetch
  // classique car il survit à un unload de page (ex: l'erreur a fermé
  // le tab). On retombe sur fetch() en fallback navigateurs anciens.
  try {
    const body = JSON.stringify({
      digest: payload.digest?.slice(0, 64) || null,
      message: payload.message?.slice(0, 1024) || null,
      stack: payload.stack?.slice(0, 16384) || null,
      url: payload.url?.slice(0, 1024) || null,
      userAgent: payload.userAgent?.slice(0, 512) || null,
      metadata: payload.metadata && JSON.stringify(payload.metadata).length < 7000 ? payload.metadata : null,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/errors', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => null);
    }
  } catch { /* tolerate */ }
}
