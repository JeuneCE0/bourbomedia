import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/scripts/versions?script_id=...        (admin auth)
// GET /api/scripts/versions?token=<portal_token> (client portal — auto-resolves script_id)
export async function GET(req: NextRequest) {
  try {
    const portalToken = req.nextUrl.searchParams.get('token');
    let scriptId = req.nextUrl.searchParams.get('script_id');

    if (portalToken) {
      // Portal access — resolve script_id from the client's portal token
      const cR = await supaFetch(
        `clients?portal_token=eq.${encodeURIComponent(portalToken)}&select=id&limit=1`,
        {}, true,
      );
      if (!cR.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const cArr = await cR.json();
      if (!cArr[0]?.id) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const sR = await supaFetch(
        `scripts?client_id=eq.${cArr[0].id}&select=id&limit=1`,
        {}, true,
      );
      if (!sR.ok) return NextResponse.json({ error: 'Script introuvable' }, { status: 404 });
      const sArr = await sR.json();
      if (!sArr[0]?.id) return NextResponse.json([]);
      scriptId = sArr[0].id;
    } else {
      if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    if (!scriptId) return NextResponse.json({ error: 'script_id requis' }, { status: 400 });
    const r = await supaFetch(
      `script_versions?script_id=eq.${scriptId}&select=*&order=version.desc`,
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
