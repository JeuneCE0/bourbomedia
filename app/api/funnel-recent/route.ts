import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/funnel-recent?limit=20
// Liste les funnel_events récents joints aux clients pour qu'on affiche
// "Marie a signé son contrat il y a 5 min" sur le dashboard home. Reste
// admin-only (requireAuth). Petit volume, pas besoin de pagination.

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') || '20'));
    // Récupère les events récents avec un JOIN inline sur clients pour
    // avoir business_name + contact_name dispo côté frontend sans 2e fetch.
    const r = await supaFetch(
      `funnel_events?select=event,source,metadata,created_at,client_id,client_token_prefix,clients(business_name,contact_name)&order=created_at.desc&limit=${limit}`,
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
