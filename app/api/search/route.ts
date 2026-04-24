import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

interface SearchResult {
  type: 'client' | 'script' | 'comment';
  id: string;
  client_id: string;
  title: string;
  subtitle: string;
  status?: string;
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    const encoded = encodeURIComponent(`%${q}%`);
    const results: SearchResult[] = [];

    const [clientsR, scriptsR, commentsR] = await Promise.all([
      supaFetch(
        `clients?or=(business_name.ilike.${encoded},contact_name.ilike.${encoded},email.ilike.${encoded},city.ilike.${encoded},phone.ilike.${encoded})&select=id,business_name,contact_name,status,city&limit=10&order=created_at.desc`,
        {}, true
      ),
      supaFetch(
        `scripts?title.ilike=${encoded}&select=id,client_id,title,status,version&limit=10&order=created_at.desc`,
        {}, true
      ),
      supaFetch(
        `script_comments?content.ilike=${encoded}&select=id,script_id,author_name,content,scripts(client_id)&limit=10&order=created_at.desc`,
        {}, true
      ),
    ]);

    if (clientsR.ok) {
      const clients = await clientsR.json();
      for (const c of clients) {
        results.push({
          type: 'client',
          id: c.id,
          client_id: c.id,
          title: c.business_name,
          subtitle: `${c.contact_name}${c.city ? ` — ${c.city}` : ''}`,
          status: c.status,
        });
      }
    }

    if (scriptsR.ok) {
      const scripts = await scriptsR.json();
      for (const s of scripts) {
        results.push({
          type: 'script',
          id: s.id,
          client_id: s.client_id,
          title: s.title,
          subtitle: `v${s.version}`,
          status: s.status,
        });
      }
    }

    if (commentsR.ok) {
      const comments = await commentsR.json();
      for (const c of comments) {
        results.push({
          type: 'comment',
          id: c.id,
          client_id: c.scripts?.client_id || '',
          title: c.author_name,
          subtitle: c.content.slice(0, 80) + (c.content.length > 80 ? '…' : ''),
        });
      }
    }

    return NextResponse.json(results);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
