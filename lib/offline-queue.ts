// Outbox pattern : quand l'utilisateur PATCH/POST en offline, on queue la
// mutation dans localStorage. Au retour online, on flush dans l'ordre.
//
// Usage côté UI :
//   import { queueIfOffline, useOnlineStatus } from '@/lib/offline-queue';
//   const r = await queueIfOffline('PATCH', '/api/gh-appointments', { id, notes });
//   if (r.queued) toast('Sauvegardé localement, sync au retour réseau');

const QUEUE_KEY = 'bbm_offline_outbox_v1';

export interface QueuedMutation {
  id: string;          // uuid local
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url: string;
  body?: string;       // JSON stringifié
  contentType?: string;
  queuedAt: number;
  description?: string; // pour l'UI ('Notes RDV X', 'Statut prospect Y')
}

function loadQueue(): QueuedMutation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQueue(q: QueuedMutation[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* */ }
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export interface QueueResult<T = unknown> {
  ok: boolean;
  queued: boolean;
  data?: T;
  error?: string;
}

// Tente fetch normalement. Si offline (network error), enqueue + retourne queued=true.
// Si en ligne mais erreur HTTP, retourne ok=false avec l'erreur (PAS de queue,
// pour ne pas masquer un bug applicatif).
export async function queueIfOffline<T = unknown>(
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  body?: Record<string, unknown>,
  options?: { description?: string },
): Promise<QueueResult<T>> {
  const bodyStr = body ? JSON.stringify(body) : undefined;
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  if (!isOnline) {
    enqueue({
      id: uid(),
      method, url,
      body: bodyStr,
      contentType: 'application/json',
      queuedAt: Date.now(),
      description: options?.description,
    });
    return { ok: true, queued: true };
  }

  try {
    const r = await fetch(url, {
      method,
      headers: authHeaders(),
      body: bodyStr,
    });
    if (!r.ok) return { ok: false, queued: false, error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => undefined);
    return { ok: true, queued: false, data };
  } catch {
    // Network error pendant qu'on était online : on queue quand même
    enqueue({
      id: uid(),
      method, url,
      body: bodyStr,
      contentType: 'application/json',
      queuedAt: Date.now(),
      description: options?.description,
    });
    return { ok: true, queued: true };
  }
}

export function enqueue(m: QueuedMutation) {
  const q = loadQueue();
  q.push(m);
  saveQueue(q);
  // Notifie les listeners (banner + indicator)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bbm-outbox-changed'));
}

export function getQueue(): QueuedMutation[] {
  return loadQueue();
}

export function clearQueue() {
  saveQueue([]);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bbm-outbox-changed'));
}

// Flush sequentially. Si une mutation échoue (HTTP error non-network), on la
// laisse en queue + log un warn. Network errors → on stoppe (probablement
// re-déconnecté) et on garde le reste en queue.
export async function flushQueue(): Promise<{ flushed: number; remaining: number; errors: string[] }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, remaining: getQueue().length, errors: [] };
  }
  const q = loadQueue();
  if (q.length === 0) return { flushed: 0, remaining: 0, errors: [] };

  let flushed = 0;
  const errors: string[] = [];
  const remaining: QueuedMutation[] = [];

  for (let i = 0; i < q.length; i++) {
    const m = q[i];
    try {
      const r = await fetch(m.url, {
        method: m.method,
        headers: authHeaders(),
        body: m.body,
      });
      if (r.ok) {
        flushed++;
      } else {
        errors.push(`${m.description || m.url} → HTTP ${r.status}`);
        remaining.push(m); // on garde pour réessai manuel
      }
    } catch {
      // Network error : on s'arrête, on remet le reste en queue
      remaining.push(...q.slice(i));
      saveQueue(remaining);
      window.dispatchEvent(new CustomEvent('bbm-outbox-changed'));
      return { flushed, remaining: remaining.length, errors };
    }
  }

  saveQueue(remaining);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bbm-outbox-changed'));
  return { flushed, remaining: remaining.length, errors };
}
