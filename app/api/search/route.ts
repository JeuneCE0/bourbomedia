import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

interface SearchResult {
  type: 'client' | 'script' | 'comment' | 'script_content';
  id: string;
  client_id: string;
  title: string;
  subtitle: string;
  status?: string;
  highlight?: string;
}

// Recursively extract plain text from a TipTap document
function extractTipTapText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: string; content?: unknown[] };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) {
    for (const child of n.content) out += ' ' + extractTipTapText(child);
  }
  return out;
}

function snippetAround(text: string, query: string, span = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, span * 2) + '…';
  const start = Math.max(0, idx - span);
  const end = Math.min(text.length, idx + query.length + span);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    const encoded = encodeURIComponent(`%${q}%`);
    const results: SearchResult[] = [];

    const [clientsR, scriptsR, commentsR, allScriptsR] = await Promise.all([
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
      // Fetch up to 80 most-recent scripts with content for in-memory full-text search
      supaFetch(
        `scripts?select=id,client_id,title,version,status,content,clients(business_name)&order=updated_at.desc&limit=80`,
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

    // Full-text search inside script content (in-memory)
    if (allScriptsR.ok) {
      const all = await allScriptsR.json();
      const lowerQ = q.toLowerCase();
      const scriptIdsAlreadyMatched = new Set(results.filter(r => r.type === 'script').map(r => r.id));
      for (const s of all) {
        if (scriptIdsAlreadyMatched.has(s.id)) continue;
        const text = extractTipTapText(s.content);
        if (text.toLowerCase().includes(lowerQ)) {
          results.push({
            type: 'script_content',
            id: s.id,
            client_id: s.client_id,
            title: s.clients?.business_name || s.title,
            subtitle: snippetAround(text, q),
            status: s.status,
          });
          if (results.filter(r => r.type === 'script_content').length >= 8) break;
        }
      }
    }

    return NextResponse.json(results);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
