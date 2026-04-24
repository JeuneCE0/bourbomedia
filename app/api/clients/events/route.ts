import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const clientId = req.nextUrl.searchParams.get('client_id');
    if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
    const r = await supaFetch(
      `client_events?client_id=eq.${clientId}&select=*&order=created_at.desc&limit=200`,
      {},
      true
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.client_id || !body.type) {
      return NextResponse.json({ error: 'client_id et type requis' }, { status: 400 });
    }
    const r = await supaFetch('client_events', {
      method: 'POST',
      body: JSON.stringify({
        client_id: body.client_id,
        type: body.type,
        payload: body.payload || null,
        actor: body.actor || 'admin',
      }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
