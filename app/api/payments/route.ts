import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const clientId = req.nextUrl.searchParams.get('client_id');
    const path = clientId
      ? `payments?client_id=eq.${clientId}&select=*&order=created_at.desc`
      : 'payments?select=*,clients(business_name,contact_name,email,ghl_contact_id)&order=created_at.desc&limit=2000';
    const r = await supaFetch(path, {}, true);
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
    if (!body.client_id || !body.amount) {
      return NextResponse.json({ error: 'client_id et amount requis' }, { status: 400 });
    }
    const r = await supaFetch('payments', {
      method: 'POST',
      body: JSON.stringify({
        client_id: body.client_id,
        amount: body.amount,
        currency: body.currency || 'eur',
        status: body.status || 'completed',
        description: body.description || '',
        stripe_session_id: body.stripe_session_id || null,
        stripe_payment_intent: body.stripe_payment_intent || null,
        receipt_url: body.receipt_url || null,
      }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
