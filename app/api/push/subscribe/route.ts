import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// POST /api/push/subscribe
//   body: { endpoint, keys: { p256dh, auth }, userAgent? }
//   Upserts the browser push subscription so the server can fanout pushes.
//
// GET /api/push/subscribe
//   Returns the VAPID public key (needed by the browser to subscribe).
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const pub = process.env.VAPID_PUBLIC_KEY || '';
  if (!pub) return NextResponse.json({ error: 'push_disabled', reason: 'VAPID_PUBLIC_KEY not configured' }, { status: 503 });
  return NextResponse.json({ publicKey: pub });
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'endpoint + keys.p256dh + keys.auth required' }, { status: 400 });
  }

  // Upsert by endpoint (unique)
  const r = await supaFetch('push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      endpoint,
      p256dh,
      auth,
      user_agent: body.userAgent || null,
    }),
  }, true);

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return NextResponse.json({ error: 'subscribe failed', detail: txt }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const endpoint = req.nextUrl.searchParams.get('endpoint');
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await supaFetch(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
  }, true);
  return NextResponse.json({ ok: true });
}
