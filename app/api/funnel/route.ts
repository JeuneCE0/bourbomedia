import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// POST /api/funnel — endpoint public (pas de Bearer requis) qui reçoit
// les events tracking depuis le frontend. Stocke dans funnel_events après
// résolution du client_id via le portal_token (best-effort).
//
// GET /api/funnel?client_id=<uuid>&limit=N — endpoint admin (requireAuth)
// pour la fiche client : remonte les funnel_events liés à un client donné.
// Permet à l'admin de voir l'historique chronologique des actions
// (signup, contract, payment, etc.) sans devoir requeter directement la DB.

const VALID_SOURCES = new Set(['portal', 'onboarding', 'admin', 'webhook']);
// Whitelist du vocabulaire pour ne pas accepter du garbage si un dev
// fait une typo ou un attaquant flood la table.
const VALID_EVENTS = new Set([
  'onboarding_landed', 'signup_completed', 'contract_signed',
  'payment_completed', 'call_booked', 'script_proposed',
  'script_validated', 'filming_booked', 'video_delivered',
  'video_validated', 'video_changes_requested',
  'publication_booked', 'project_published',
]);

// Rate limit : 60 events/min/IP. Plus généreux que /api/errors car le
// volume normal d'events est plus élevé (un signup = 1 event, contract = 1,
// etc.) mais ça reste un cap pour éviter le flood.
const RATE_LIMIT_PER_MINUTE = 60;
const ipBuckets = new Map<string, number[]>();

function shouldRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const bucket = (ipBuckets.get(ip) || []).filter(t => t > cutoff);
  if (bucket.length >= RATE_LIMIT_PER_MINUTE) return true;
  bucket.push(now);
  ipBuckets.set(ip, bucket);
  if (ipBuckets.size > 1000) {
    for (const [k, v] of ipBuckets.entries()) {
      const filtered = v.filter(t => t > cutoff);
      if (filtered.length === 0) ipBuckets.delete(k);
      else ipBuckets.set(k, filtered);
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  if (shouldRateLimit(ip)) {
    return NextResponse.json({ rateLimited: true }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const event = typeof body.event === 'string' ? body.event : null;
    const source = typeof body.source === 'string' ? body.source : null;
    const token = typeof body.token === 'string' ? body.token : null;
    const metadata = (typeof body.metadata === 'object' && body.metadata !== null)
      ? body.metadata as Record<string, unknown>
      : null;

    if (!event || !VALID_EVENTS.has(event)) {
      return NextResponse.json({ error: 'invalid event' }, { status: 400 });
    }
    if (!source || !VALID_SOURCES.has(source)) {
      return NextResponse.json({ error: 'invalid source' }, { status: 400 });
    }

    // Best-effort : résout le client_id via le portal_token si fourni.
    let clientId: string | null = null;
    let tokenPrefix: string | null = null;
    if (token && /^[a-f0-9]{16,}$/i.test(token)) {
      tokenPrefix = token.slice(0, 8);
      try {
        const r = await supaFetch(
          `clients?or=(portal_token.eq.${token},onboarding_token.eq.${token})&select=id&limit=1`,
          {}, true,
        );
        if (r.ok) {
          const arr = await r.json();
          if (arr[0]?.id) clientId = arr[0].id;
        }
      } catch { /* tolerate */ }
    }

    await supaFetch('funnel_events', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        event,
        source,
        client_id: clientId,
        client_token_prefix: tokenPrefix,
        metadata: metadata && JSON.stringify(metadata).length < 3500 ? metadata : null,
      }),
    }, true).catch(() => null);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const clientId = req.nextUrl.searchParams.get('client_id');
    const limit = Math.min(200, Number(req.nextUrl.searchParams.get('limit') || '50'));
    if (!clientId) {
      return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
    }
    const r = await supaFetch(
      `funnel_events?client_id=eq.${encodeURIComponent(clientId)}&select=event,source,metadata,created_at&order=created_at.desc&limit=${limit}`,
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
