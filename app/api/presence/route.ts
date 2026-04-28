import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// POST /api/presence — heartbeat (toutes les 15s côté client)
//   body : { user_id, user_name, scope }
//   Upsert sur (user_id, scope), updated_at = now()
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { user_id, user_name, scope } = await req.json().catch(() => ({}));
  if (!user_id || !user_name || !scope) return NextResponse.json({ error: 'user_id + user_name + scope requis' }, { status: 400 });

  const row = { user_id, user_name, scope, updated_at: new Date().toISOString() };
  const r = await supaFetch('presence?on_conflict=user_id,scope', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  }, true);
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return NextResponse.json({ error: 'presence failed', detail: txt }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// GET /api/presence?scope=...&exclude_user_id=...
//   Retourne les sessions actives (updated_at > now - 30s) pour ce scope,
//   excluant l'utilisateur qui requête.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const scope = req.nextUrl.searchParams.get('scope');
  const excludeUserId = req.nextUrl.searchParams.get('exclude_user_id') || '';
  if (!scope) return NextResponse.json({ users: [] });

  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const r = await supaFetch(
    `presence?scope=eq.${encodeURIComponent(scope)}&updated_at=gte.${encodeURIComponent(cutoff)}&select=user_id,user_name,updated_at`,
    {}, true,
  );
  if (!r.ok) return NextResponse.json({ users: [] });
  type Row = { user_id: string; user_name: string; updated_at: string };
  const users = (await r.json() as Row[]).filter(u => u.user_id !== excludeUserId);
  return NextResponse.json({ users });
}

// DELETE /api/presence  body : { user_id, scope }
//   Quand l'admin quitte la fiche (beforeunload), on retire son entrée.
export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { user_id, scope } = await req.json().catch(() => ({}));
  if (!user_id || !scope) return NextResponse.json({ error: 'user_id + scope requis' }, { status: 400 });
  await supaFetch(`presence?user_id=eq.${encodeURIComponent(user_id)}&scope=eq.${encodeURIComponent(scope)}`, {
    method: 'DELETE',
  }, true);
  return NextResponse.json({ ok: true });
}
