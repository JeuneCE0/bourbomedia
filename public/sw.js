// Service worker for Bourbomedia PWA — push notifications + offline cache.
// Registered from app/dashboard/layout.tsx.

const CACHE_NAME = 'bbm-runtime-v1';
// API GETs cachés en stale-while-revalidate pour permettre l'usage offline.
// Les mutations (POST/PATCH/DELETE) sont gérées côté client par offline-queue.ts.
const CACHEABLE_API_PATTERNS = [
  '/api/clients',
  '/api/gh-opportunities',
  '/api/gh-appointments',
  '/api/inbox',
  '/api/closing-stats',
  '/api/contacts/lookup',
  '/api/ghl/contact',
  '/api/ghl/opportunity',
  '/api/scripts',
  '/api/payments',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purge des anciens caches non gérés
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Stale-while-revalidate sur les GETs API : retourne le cache immédiatement
// si présent, et met à jour en arrière-plan. Si pas de cache et offline →
// retourne une réponse d'erreur claire (le client peut display un fallback).
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLE_API_PATTERNS.some(p => url.pathname.startsWith(p))) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const networkPromise = fetch(request).then(async (resp) => {
      // Ne cache que les 200 OK
      if (resp.ok) cache.put(request, resp.clone()).catch(() => null);
      return resp;
    }).catch(() => null);

    if (cached) {
      // SWR : retourne le cache instant + revalide en background
      networkPromise.catch(() => null);
      return cached;
    }
    const fresh = await networkPromise;
    if (fresh) return fresh;
    return new Response(JSON.stringify({ error: 'offline', cached: false }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  })());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: event.data.text() }; }
  const title = payload.title || 'Bourbomedia';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.jpg',
    badge: '/favicon.jpg',
    tag: payload.tag,
    data: { url: payload.url || '/dashboard' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && 'focus' in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
