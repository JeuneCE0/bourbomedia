import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const limit = req.nextUrl.searchParams.get('limit') || '50';
    const r = await supaFetch(
      `client_events?select=*,clients(business_name)&order=created_at.desc&limit=${limit}`,
      {}, true
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
