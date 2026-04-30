import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';

// POST /api/csp-report — endpoint cible pour les violations CSP envoyées
// par les navigateurs quand le header Content-Security-Policy(-Report-Only)
// déclenche une violation. Format standardisé :
//   { "csp-report": { "violated-directive": "...", "blocked-uri": "...", ... } }
//
// On stocke chaque violation dans la même table error_logs avec
// source='client' et metadata.kind='csp_violation' pour qu'elles
// apparaissent dans /dashboard/errors filtrées si l'admin veut les voir.
//
// Rate-limit léger 30/min/IP : un user en violation déclenche en cascade
// (chaque ressource bloquée = 1 report) — éviter de saturer.

const RATE_LIMIT_PER_MINUTE = 30;
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
    // Le format du body varie : "application/csp-report" (legacy) ou
    // "application/reports+json" (Reporting API moderne). On accepte les deux.
    const body = await req.json().catch(() => null) as
      | { 'csp-report'?: Record<string, unknown> }
      | Array<{ body?: { violatedDirective?: string; blockedUri?: string } }>
      | null;

    let violation: Record<string, unknown> | null = null;
    if (Array.isArray(body)) {
      // Reporting API : array d'objets {type, body, ...}
      const cspEntry = body.find(e => e?.body) as { body?: Record<string, unknown> } | undefined;
      violation = (cspEntry?.body as Record<string, unknown>) || null;
    } else if (body && typeof body === 'object' && 'csp-report' in body) {
      violation = (body['csp-report'] as Record<string, unknown>) || null;
    }

    if (!violation) {
      return NextResponse.json({ skipped: true }, { status: 200 });
    }

    const directive = String(violation['violated-directive'] || violation.violatedDirective || '').slice(0, 256);
    const blockedUri = String(violation['blocked-uri'] || violation.blockedURL || '').slice(0, 1024);
    const documentUri = String(violation['document-uri'] || violation.documentURL || '').slice(0, 1024);
    const sourceFile = String(violation['source-file'] || violation.sourceFile || '').slice(0, 1024);

    await supaFetch('error_logs', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        source: 'client',
        message: `CSP violation: ${directive}`.slice(0, 1024),
        url: documentUri || null,
        user_agent: req.headers.get('user-agent')?.slice(0, 512) || null,
        metadata: {
          kind: 'csp_violation',
          directive,
          blockedUri,
          sourceFile: sourceFile || null,
        },
      }),
    }, true).catch(() => null);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
