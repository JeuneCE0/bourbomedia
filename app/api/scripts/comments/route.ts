import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { notifyNewComment } from '@/lib/slack';

export async function POST(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');
  const body = await req.json();

  if (portalToken) {
    try {
      const cr = await supaFetch(`clients?portal_token=eq.${portalToken}&select=id,contact_name,business_name`, {}, true);
      if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const clients = await cr.json();
      if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });

      const sr = await supaFetch(`scripts?client_id=eq.${clients[0].id}&select=id`, {}, true);
      if (!sr.ok) return NextResponse.json({ error: await sr.text() }, { status: sr.status });
      const scripts = await sr.json();
      if (!scripts.length) return NextResponse.json({ error: 'Script non trouvé' }, { status: 404 });

      const r = await supaFetch('script_comments', {
        method: 'POST',
        body: JSON.stringify({
          script_id: scripts[0].id,
          author_name: clients[0].contact_name,
          author_type: 'client',
          content: body.content,
        }),
      }, true);
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();
      notifyNewComment(clients[0].business_name || 'Client', clients[0].contact_name, 'client', body.content);
      return NextResponse.json(data[0], { status: 201 });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    if (!body.script_id || !body.content) {
      return NextResponse.json({ error: 'script_id et content requis' }, { status: 400 });
    }
    const r = await supaFetch('script_comments', {
      method: 'POST',
      body: JSON.stringify({
        script_id: body.script_id,
        author_name: body.author_name || 'Admin',
        author_type: 'admin',
        content: body.content,
      }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
