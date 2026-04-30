import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/error-logs?limit=100&source=client|server&since=YYYY-MM-DD
// Liste les erreurs runtime persistées dans la table error_logs. Réservé
// à l'admin (requireAuth). Tri par date desc, limit configurable.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const url = req.nextUrl;
    const limit = Math.min(500, Number(url.searchParams.get('limit') || '100'));
    const source = url.searchParams.get('source');
    const since = url.searchParams.get('since');

    let path = `error_logs?select=*&order=created_at.desc&limit=${limit}`;
    if (source === 'client' || source === 'server') {
      path += `&source=eq.${source}`;
    }
    if (since) {
      path += `&created_at=gte.${encodeURIComponent(since)}`;
    }
    const r = await supaFetch(path, {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
