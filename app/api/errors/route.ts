import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';

// POST /api/errors — endpoint public (pas de Bearer requis) qui reçoit les
// erreurs runtime côté client via reportClientError() / sendBeacon. Stocke
// dans la table error_logs pour visualisation par l'admin via
// /dashboard/errors. Volontairement permissif pour ne pas perdre des
// erreurs en production, MAIS rate-limit basique par IP pour éviter le
// flood (surtout si une erreur boucle).

// Rate limit : max 10 erreurs / minute / IP. In-memory donc pas idéal sur
// Vercel cold start (chaque instance a son compteur), mais suffisant pour
// éviter qu'un client en boucle infinie sature la table.
const RATE_LIMIT_PER_MINUTE = 10;
const ipBuckets = new Map<string, number[]>();

function shouldRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const bucket = (ipBuckets.get(ip) || []).filter(t => t > cutoff);
  if (bucket.length >= RATE_LIMIT_PER_MINUTE) return true;
  bucket.push(now);
  ipBuckets.set(ip, bucket);
  // Garbage collect tous les 1000 inserts pour pas faire fuir la map.
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
    const message = typeof body.message === 'string' ? body.message.slice(0, 1024) : null;
    const stack = typeof body.stack === 'string' ? body.stack.slice(0, 16384) : null;
    const digest = typeof body.digest === 'string' ? body.digest.slice(0, 64) : null;
    const url = typeof body.url === 'string' ? body.url.slice(0, 1024) : null;
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 512) : null;
    const metadata = (typeof body.metadata === 'object' && body.metadata !== null)
      ? body.metadata as Record<string, unknown>
      : null;

    // Extrait un préfixe du token portal pour pouvoir corréler les erreurs
    // au client concerné, sans exposer le token complet (qui donnerait un
    // accès au portail). Le token est dans l'URL en query string.
    let clientTokenPrefix: string | null = null;
    if (url) {
      const tokenMatch = url.match(/[?&]token=([a-f0-9]+)/i);
      if (tokenMatch?.[1]) clientTokenPrefix = tokenMatch[1].slice(0, 8);
    }

    // Skip totalement si pas de message ET pas de stack (probablement un
    // body vide, garbage, ou un client-side aborted fetch).
    if (!message && !stack) {
      return NextResponse.json({ skipped: 'empty' }, { status: 400 });
    }

    await supaFetch('error_logs', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        source: 'client',
        digest,
        message,
        stack,
        url,
        user_agent: userAgent,
        client_token_prefix: clientTokenPrefix,
        metadata: metadata && JSON.stringify(metadata).length < 7000 ? metadata : null,
      }),
    }, true).catch(() => null);

    return NextResponse.json({ ok: true });
  } catch {
    // L'endpoint est best-effort ; ne JAMAIS retourner 500 ici car ça
    // ferait que les clients en boucle d'erreur déclenchent encore plus
    // d'erreurs en réessayant.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
