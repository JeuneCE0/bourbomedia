import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// Public submission via portal token
async function clientFromToken(token: string) {
  const r = await supaFetch(`clients?portal_token=eq.${token}&select=id`, {}, true);
  if (!r.ok) return null;
  const d = await r.json();
  return d[0] || null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const clientId = req.nextUrl.searchParams.get('client_id');

  if (token) {
    const client = await clientFromToken(token);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    const r = await supaFetch(`satisfaction_surveys?client_id=eq.${client.id}&select=*`, {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const d = await r.json();
    return NextResponse.json(d[0] || null);
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const path = clientId
    ? `satisfaction_surveys?client_id=eq.${clientId}&select=*`
    : 'satisfaction_surveys?select=*,clients(business_name,contact_name)&order=created_at.desc';
  const r = await supaFetch(path, {}, true);
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
  const d = await r.json();
  return NextResponse.json(clientId ? d[0] || null : d);
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const body = await req.json();

  let clientId = body.client_id;
  if (token) {
    const client = await clientFromToken(token);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    clientId = client.id;
  } else if (!requireAuth(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  if (!clientId || !body.rating) {
    return NextResponse.json({ error: 'client_id et rating requis' }, { status: 400 });
  }

  // Upsert: delete existing then insert (table has UNIQUE(client_id))
  await supaFetch(`satisfaction_surveys?client_id=eq.${clientId}`, { method: 'DELETE' }, true);

  const r = await supaFetch('satisfaction_surveys', {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      rating: body.rating,
      comment: body.comment || null,
      allow_testimonial: !!body.allow_testimonial,
    }),
  }, true);
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });

  // Log event + notify slack
  try {
    await supaFetch('client_events', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        type: 'satisfaction_submitted',
        payload: { rating: body.rating },
        actor: 'client',
      }),
    }, true);
  } catch { /* */ }

  const data = await r.json();
  return NextResponse.json(data[0], { status: 201 });
}
