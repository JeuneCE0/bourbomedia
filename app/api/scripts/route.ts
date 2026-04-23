import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('client_id');
  const portalToken = req.nextUrl.searchParams.get('token');

  if (portalToken) {
    try {
      const cr = await supaFetch(`clients?portal_token=eq.${portalToken}&select=id`, {}, true);
      if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const clients = await cr.json();
      if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const cid = clients[0].id;
      const r = await supaFetch(`scripts?client_id=eq.${cid}&select=*,script_comments(*)`, {}, true);
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();
      return NextResponse.json(data[0] || null);
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const path = clientId
      ? `scripts?client_id=eq.${clientId}&select=*,script_comments(*)`
      : 'scripts?select=*,clients(business_name)&order=updated_at.desc';
    const r = await supaFetch(path, {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(clientId ? data[0] || null : data);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
    const r = await supaFetch('scripts', {
      method: 'POST',
      body: JSON.stringify(body),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');

  if (portalToken) {
    try {
      const cr = await supaFetch(`clients?portal_token=eq.${portalToken}&select=id`, {}, true);
      if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const clients = await cr.json();
      if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const cid = clients[0].id;

      const { action } = await req.json();

      if (action === 'validate') {
        const sr = await supaFetch(`scripts?client_id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() }),
        }, true);
        if (!sr.ok) return NextResponse.json({ error: await sr.text() }, { status: sr.status });

        await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'script_validated', updated_at: new Date().toISOString() }),
        }, true);

        const data = await sr.json();
        return NextResponse.json(data[0]);
      }

      if (action === 'request_changes') {
        const sr = await supaFetch(`scripts?client_id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'awaiting_changes', updated_at: new Date().toISOString() }),
        }, true);
        if (!sr.ok) return NextResponse.json({ error: await sr.text() }, { status: sr.status });

        await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'script_review', updated_at: new Date().toISOString() }),
        }, true);

        const data = await sr.json();
        return NextResponse.json(data[0]);
      }

      return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id, ...fields } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    // Save version before updating
    const currentR = await supaFetch(`scripts?id=eq.${id}&select=*`, {}, true);
    if (currentR.ok) {
      const current = await currentR.json();
      if (current.length) {
        await supaFetch('script_versions', {
          method: 'POST',
          body: JSON.stringify({
            script_id: id,
            version: current[0].version,
            content: current[0].content,
            status: current[0].status,
            created_by: current[0].created_by,
          }),
        }, true);
      }
    }

    fields.updated_at = new Date().toISOString();
    if (fields.content) fields.version = (fields.version || 1) + 1;

    const r = await supaFetch(`scripts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0]);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
