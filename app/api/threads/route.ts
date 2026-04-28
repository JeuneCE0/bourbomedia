import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/threads?scope_type=client&scope_id=<uuid>
// GET /api/threads?scope_type=opportunity&scope_id=<ghl_opportunity_id>
//   Returns the latest 100 messages for the thread.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const scope_type = req.nextUrl.searchParams.get('scope_type');
  const scope_id = req.nextUrl.searchParams.get('scope_id');
  if (!scope_type || !scope_id) return NextResponse.json({ error: 'scope_type + scope_id requis' }, { status: 400 });
  if (!['client', 'opportunity'].includes(scope_type)) return NextResponse.json({ error: 'scope_type invalide' }, { status: 400 });

  const r = await supaFetch(
    `internal_threads?scope_type=eq.${encodeURIComponent(scope_type)}&scope_id=eq.${encodeURIComponent(scope_id)}`
    + `&select=*&order=created_at.asc&limit=100`,
    {}, true,
  );
  if (!r.ok) return NextResponse.json({ messages: [] });
  const messages = await r.json();
  return NextResponse.json({ messages });
}

// POST /api/threads
//   body : { scope_type, scope_id, body, author_name }
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { scope_type, scope_id, body: text, author_name, author_id } = body;
  if (!scope_type || !scope_id || !text) return NextResponse.json({ error: 'scope_type + scope_id + body requis' }, { status: 400 });

  // Extract @mentions (texte simple, ex: '@Rudy va le rappeler')
  const mentions = Array.from(text.matchAll(/@(\w+)/g) as IterableIterator<RegExpMatchArray>).map((m) => m[1]);

  const r = await supaFetch('internal_threads?select=*', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      scope_type, scope_id,
      body: text,
      author_name: author_name || 'Admin',
      author_id: author_id || null,
      mentions: mentions.length > 0 ? mentions : null,
    }),
  }, true);
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return NextResponse.json({ error: 'insert failed', detail: txt }, { status: 500 });
  }
  const arr = await r.json();
  return NextResponse.json({ message: arr[0] || null });
}

// DELETE /api/threads?id=<uuid>
export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
  const r = await supaFetch(`internal_threads?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }, true);
  if (!r.ok) return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  return NextResponse.json({ success: true });
}
