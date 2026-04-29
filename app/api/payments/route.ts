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

// DELETE /api/payments?id=...
//   Supprime une facture en attente. Refuse les paiements déjà encaissés
//   (sauf ?force=1) pour éviter la corruption du CA réel.
export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get('id');
    const force = req.nextUrl.searchParams.get('force') === '1';
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const fetchR = await supaFetch(`payments?id=eq.${encodeURIComponent(id)}&select=id,status`, {}, true);
    if (!fetchR.ok) return NextResponse.json({ error: await fetchR.text() }, { status: fetchR.status });
    const rows = await fetchR.json();
    if (!rows.length) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 });

    const status = rows[0].status as string;
    const isPaid = status === 'completed' || status === 'paid';
    if (isPaid && !force) {
      return NextResponse.json({
        error: 'Suppression refusée : ce paiement est déjà encaissé. Utilisez ?force=1 pour forcer.',
      }, { status: 409 });
    }

    const r = await supaFetch(`payments?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json({ ok: true });
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
