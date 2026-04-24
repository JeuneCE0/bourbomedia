import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

async function clientFromToken(token: string) {
  const r = await supaFetch(`clients?portal_token=eq.${token}&select=id`, {}, true);
  if (!r.ok) return null;
  const d = await r.json();
  return d[0] || null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  let clientId = req.nextUrl.searchParams.get('client_id');

  if (token) {
    const client = await clientFromToken(token);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    clientId = client.id;
  } else if (!requireAuth(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });

  const r = await supaFetch(
    `client_notifications?client_id=eq.${clientId}&select=*&order=created_at.desc&limit=50`,
    {}, true
  );
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
  return NextResponse.json(await r.json());
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.client_id || !body.type || !body.title) {
      return NextResponse.json({ error: 'client_id, type, title requis' }, { status: 400 });
    }
    const r = await supaFetch('client_notifications', {
      method: 'POST',
      body: JSON.stringify({
        client_id: body.client_id,
        type: body.type,
        title: body.title,
        body: body.body || null,
        link: body.link || null,
      }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const d = await r.json();
    return NextResponse.json(d[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH: mark as read (client via token)
export async function PATCH(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const body = await req.json();

  if (token) {
    const client = await clientFromToken(token);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
      // Mark all unread as read
      const r = await supaFetch(
        `client_notifications?client_id=eq.${client.id}&read_at=is.null`,
        { method: 'PATCH', body: JSON.stringify({ read_at: new Date().toISOString() }) },
        true
      );
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    } else {
      const r = await supaFetch(
        `client_notifications?id=in.(${ids.map(i => `"${i}"`).join(',')})&client_id=eq.${client.id}`,
        { method: 'PATCH', body: JSON.stringify({ read_at: new Date().toISOString() }) },
        true
      );
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    }
    return NextResponse.json({ success: true });
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  return NextResponse.json({ error: 'Token requis pour marquer comme lu' }, { status: 400 });
}
