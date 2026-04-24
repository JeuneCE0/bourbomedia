import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const scriptId = req.nextUrl.searchParams.get('script_id');
    if (!scriptId) return NextResponse.json({ error: 'script_id requis' }, { status: 400 });
    const r = await supaFetch(
      `script_versions?script_id=eq.${scriptId}&select=*&order=version.desc`,
      {},
      true
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
