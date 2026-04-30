'use client';

import { useEffect } from 'react';

// Hook utilitaire qui :
//  1. Lance un setInterval(load, intervalMs) qui SKIP si l'onglet est en
//     arrière-plan (économise les requêtes Supabase / API quand l'admin
//     ou le client laisse une page ouverte sans la regarder).
//  2. Re-déclenche load() instantanément au retour de l'onglet pour
//     rattraper l'état courant après une absence.
//  3. Cleanup propre du setInterval + listener visibilitychange au unmount.
//
// Pattern utilisé dans portal/[[...step]], dashboard/clients/[id], inbox,
// NotificationBell, etc. — chaque caller avait son propre boilerplate
// quasi identique (~15 lignes). Extraction = gain de lignes + cohérence
// (si on change la sémantique, ça s'applique partout).
//
// Usage :
//   useVisibilityAwarePolling(loadClients, 30_000);     // poll + refresh
//   useVisibilityAwarePolling(loadClients, null);       // refresh only
//   useVisibilityAwarePolling(loadClients, 30_000, [tab]); // poll dep-aware
//
// `intervalMs = null` = pas de polling, juste le refresh-on-focus (utile
// pour les vues read-mostly comme /dashboard/errors qui n'ont pas besoin
// de poll continu mais doivent rattraper l'état après une absence).
//
// Le 3e arg `deps` est ajouté au useEffect dependency array — utile si
// load() change selon le state (ex : dépend du tab courant).
export function useVisibilityAwarePolling(
  load: () => void,
  intervalMs: number | null,
  deps: ReadonlyArray<unknown> = [],
): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let interval: number | null = null;
    if (intervalMs !== null && intervalMs > 0) {
      const tick = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        load();
      };
      interval = window.setInterval(tick, intervalMs);
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (interval !== null) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs, ...deps]);
}
