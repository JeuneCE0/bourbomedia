// Server-side helper to fanout web push notifications to every subscribed
// admin device. Pulls subscriptions from the push_subscriptions table and
// gracefully prunes endpoints that return 410 (Gone).
//
// Requires env vars VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Generate with: npx web-push generate-vapid-keys --json

import webpush from 'web-push';
import { supaFetch } from './supabase';

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:rudy.bonte@scalecorp.fr';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
}

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };

  const r = await supaFetch('push_subscriptions?select=id,endpoint,p256dh,auth&limit=200', {}, true);
  if (!r.ok) return { sent: 0, pruned: 0 };
  const subs: Subscription[] = await r.json();

  let sent = 0;
  let pruned = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );
      sent++;
      // best-effort last_used_at touch
      supaFetch(`push_subscriptions?id=eq.${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_used_at: new Date().toISOString() }),
      }, true).catch(() => {});
    } catch (e: unknown) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Endpoint gone — prune
        await supaFetch(`push_subscriptions?id=eq.${encodeURIComponent(s.id)}`, {
          method: 'DELETE',
        }, true).catch(() => {});
        pruned++;
      }
    }
  }));

  return { sent, pruned };
}
