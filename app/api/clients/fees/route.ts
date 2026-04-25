import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import crypto from 'crypto';

// Provider fees per client — stored as a JSONB array on the clients row.
// Each entry: { id, type, amount_cents, description, paid_at, created_at }
// type ∈ 'filmmaker' | 'editor' | 'voiceover' | 'other'

interface Fee {
  id: string;
  type: 'filmmaker' | 'editor' | 'voiceover' | 'other';
  amount_cents: number;
  description?: string;
  paid_at?: string | null;
  created_at: string;
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    const clientId = body.client_id as string;
    if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
    const type = (['filmmaker', 'editor', 'voiceover', 'other'] as const).includes(body.type) ? body.type : 'other';
    const amountCents = Math.max(0, Math.round(Number(body.amount_cents || 0)));
    if (!amountCents) return NextResponse.json({ error: 'amount_cents > 0 requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${clientId}&select=provider_fees`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const current: Fee[] = Array.isArray(data[0].provider_fees) ? data[0].provider_fees : [];
    const newFee: Fee = {
      id: crypto.randomUUID(),
      type,
      amount_cents: amountCents,
      description: body.description ? String(body.description).slice(0, 500) : undefined,
      paid_at: body.paid_at || null,
      created_at: new Date().toISOString(),
    };
    const updated = [newFee, ...current];

    const ur = await supaFetch(`clients?id=eq.${clientId}`, {
      method: 'PATCH',
      body: JSON.stringify({ provider_fees: updated, updated_at: new Date().toISOString() }),
    }, true);
    if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });

    return NextResponse.json({ ok: true, fee: newFee });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const clientId = req.nextUrl.searchParams.get('client_id');
    const feeId = req.nextUrl.searchParams.get('fee_id');
    if (!clientId || !feeId) return NextResponse.json({ error: 'client_id et fee_id requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${clientId}&select=provider_fees`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const current: Fee[] = Array.isArray(data[0].provider_fees) ? data[0].provider_fees : [];
    const updated = current.filter(f => f.id !== feeId);

    const ur = await supaFetch(`clients?id=eq.${clientId}`, {
      method: 'PATCH',
      body: JSON.stringify({ provider_fees: updated, updated_at: new Date().toISOString() }),
    }, true);
    if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
