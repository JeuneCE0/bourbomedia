// Vocabulaire fixe des events funnel onboarding. À garder en sync avec la
// migration 028_funnel_events.sql (pas de check-constraint enum côté DB
// pour permettre l'ajout d'events sans migration, mais on évite les
// strings libres côté code via ce type union).

export type FunnelEvent =
  | 'onboarding_landed'        // Visiteur arrivé sur /onboarding (sans token)
  | 'signup_completed'         // Inscription créée avec succès
  | 'contract_signed'          // contract_signed_at posé en DB
  | 'payment_completed'        // paid_at posé (webhook Stripe ou manuel)
  | 'call_booked'              // onboarding_call_booked = true
  | 'script_proposed'          // Admin pousse v1 du script au client
  | 'script_validated'         // Client valide le script
  | 'filming_booked'           // filming_date posé
  | 'video_delivered'          // delivered_at posé sur clients
  | 'video_validated'          // Client valide la vidéo livrée
  | 'video_changes_requested'  // Client demande des modifs
  | 'publication_booked'       // publication_date_confirmed + deadline
  | 'project_published';       // status='published'

export type FunnelSource = 'portal' | 'onboarding' | 'admin' | 'webhook';

interface TrackOptions {
  event: FunnelEvent;
  source: FunnelSource;
  token?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Côté browser : fire-and-forget vers /api/funnel. Utilise sendBeacon
// pour survivre à la navigation (typiquement après signup le user est
// redirect → l'event doit partir avant que la page se ferme).
export function trackFunnel({ event, source, token, metadata }: TrackOptions): void {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({
      event,
      source,
      token: token || null,
      metadata: metadata && JSON.stringify(metadata).length < 3500 ? metadata : null,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/funnel', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/funnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => null);
    }
  } catch { /* tolerate — track ne doit jamais break l'UX */ }
}

interface TrackServerOptions {
  event: FunnelEvent;
  source?: FunnelSource;
  clientId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Côté server (route handlers / webhooks) : insert direct dans
// funnel_events via supaFetch + service key. Pas de re-validation du
// vocabulaire ici : c'est censé être appelé avec les types FunnelEvent
// stricts. Best-effort, jamais bloquant.
export async function trackFunnelServer({ event, source = 'admin', clientId, metadata }: TrackServerOptions): Promise<void> {
  try {
    const { supaFetch } = await import('@/lib/supabase');
    await supaFetch('funnel_events', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        event,
        source,
        client_id: clientId || null,
        metadata: metadata && JSON.stringify(metadata).length < 3500 ? metadata : null,
      }),
    }, true);
  } catch { /* tolerate */ }
}
