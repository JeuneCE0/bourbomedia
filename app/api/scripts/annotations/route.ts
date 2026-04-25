import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { notifyAnnotationCreated } from '@/lib/slack';
import crypto from 'crypto';

// Inline script annotations (highlight + note from the client).
//
// Auth model:
// - Portal: ?token=<portal_token>  → client may CRUD their own annotations
// - Admin:  Bearer admin token     → admin may list / mark resolved
//
// The frontend has a graceful fallback: if the script_annotations table does
// not exist (migration not applied yet), endpoints return an empty list and
// errors are non-fatal.

async function resolveClientFromToken(token: string) {
  const r = await supaFetch(`clients?portal_token=eq.${token}&select=id,contact_name,business_name`, {}, true);
  if (!r.ok) return null;
  const arr = await r.json();
  return arr[0] || null;
}

async function getScriptIdForClient(clientId: string): Promise<string | null> {
  const r = await supaFetch(`scripts?client_id=eq.${clientId}&select=id,version`, {}, true);
  if (!r.ok) return null;
  const arr = await r.json();
  return arr[0]?.id || null;
}

export async function GET(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');
  const scriptId = req.nextUrl.searchParams.get('script_id');
  const clientIdParam = req.nextUrl.searchParams.get('client_id');

  // --- Portal path: client viewing their own annotations ---
  if (portalToken) {
    const client = await resolveClientFromToken(portalToken);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    const sid = await getScriptIdForClient(client.id);
    if (!sid) return NextResponse.json([]);
    const r = await supaFetch(`script_annotations?script_id=eq.${sid}&select=*&order=created_at.asc`, {}, true);
    if (!r.ok) return NextResponse.json([]); // table may not exist yet — graceful fallback
    return NextResponse.json(await r.json());
  }

  // --- Admin path ---
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  let sid = scriptId;
  if (!sid && clientIdParam) {
    sid = await getScriptIdForClient(clientIdParam);
  }
  if (!sid) return NextResponse.json([]);
  const r = await supaFetch(`script_annotations?script_id=eq.${sid}&select=*&order=created_at.asc`, {}, true);
  if (!r.ok) return NextResponse.json([]);
  return NextResponse.json(await r.json());
}

export async function POST(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');
  const body = await req.json();

  // --- Portal: client creates an annotation ---
  if (portalToken) {
    const client = await resolveClientFromToken(portalToken);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    if (!body.quote || !body.note) {
      return NextResponse.json({ error: 'quote et note requis' }, { status: 400 });
    }
    const sid = await getScriptIdForClient(client.id);
    if (!sid) return NextResponse.json({ error: 'Script introuvable' }, { status: 404 });
    // Get current script version
    const sR = await supaFetch(`scripts?id=eq.${sid}&select=version`, {}, true);
    const sJson = sR.ok ? await sR.json() : [];
    const version = sJson[0]?.version || 1;

    const r = await supaFetch('script_annotations', {
      method: 'POST',
      body: JSON.stringify({
        script_id: sid,
        client_id: client.id,
        quote: String(body.quote).slice(0, 2000),
        pos_from: typeof body.pos_from === 'number' ? body.pos_from : null,
        pos_to: typeof body.pos_to === 'number' ? body.pos_to : null,
        note: String(body.note).slice(0, 4000),
        author_type: 'client',
        author_name: client.contact_name || 'Client',
        script_version: version,
      }),
    }, true);
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      const migrationMissing = /relation|PGRST205|Could not find the table|does not exist|schema cache/i.test(errText);
      // Try to extract a clean message from JSON-style errors
      let cleanMessage = errText;
      try {
        const parsed = JSON.parse(errText);
        cleanMessage = parsed.message || parsed.error || parsed.details || errText;
      } catch { /* not JSON */ }
      return NextResponse.json({
        error: migrationMissing
          ? "La fonctionnalité d'annotation n'est pas encore activée côté serveur."
          : cleanMessage || "Impossible d'enregistrer l'annotation",
        migration_missing: migrationMissing,
      }, { status: migrationMissing ? 503 : (r.status || 500) });
    }
    const data = await r.json();

    // Slack ping (non-blocking)
    notifyAnnotationCreated(
      client.business_name || 'Client',
      client.contact_name || 'Client',
      String(body.quote),
      String(body.note),
    ).catch(() => {});

    // Activity log
    try {
      await supaFetch('client_events', {
        method: 'POST',
        body: JSON.stringify({
          client_id: client.id,
          type: 'script_annotation_added',
          payload: { quote_preview: String(body.quote).slice(0, 80) },
          actor: 'client',
        }),
      }, true);
    } catch { /* */ }

    return NextResponse.json(data[0], { status: 201 });
  }

  // --- Admin: not used for now (annotations are client-driven) ---
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  return NextResponse.json({ error: 'Use the portal token to create annotations' }, { status: 400 });
}

interface AnnotationReply {
  id: string;
  author_type: 'client' | 'admin';
  author_name: string;
  text: string;
  created_at: string;
}

async function fetchAnnotationById(id: string): Promise<{ replies?: AnnotationReply[] } | null> {
  const r = await supaFetch(`script_annotations?id=eq.${id}&select=replies`, {}, true);
  if (!r.ok) return null;
  const arr = await r.json();
  return arr[0] || null;
}

export async function PATCH(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.note === 'string') fields.note = body.note.slice(0, 4000);
  if (typeof body.resolved === 'boolean') {
    fields.resolved = body.resolved;
    fields.resolved_at = body.resolved ? new Date().toISOString() : null;
  }

  // --- Reply branch (works for both client and admin) ---
  if (typeof body.add_reply === 'string' && body.add_reply.trim()) {
    let authorType: 'client' | 'admin' = 'admin';
    let authorName = 'Admin';
    if (portalToken) {
      const client = await resolveClientFromToken(portalToken);
      if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      authorType = 'client';
      authorName = client.contact_name || 'Client';
    } else if (!requireAuth(req)) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }
    const existing = await fetchAnnotationById(body.id);
    const currentReplies: AnnotationReply[] = Array.isArray(existing?.replies) ? existing!.replies as AnnotationReply[] : [];
    const newReply: AnnotationReply = {
      id: crypto.randomUUID(),
      author_type: authorType,
      author_name: authorName,
      text: String(body.add_reply).slice(0, 2000).trim(),
      created_at: new Date().toISOString(),
    };
    fields.replies = [...currentReplies, newReply];
  }

  // --- Portal: client edits their own annotation ---
  if (portalToken) {
    const client = await resolveClientFromToken(portalToken);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    const r = await supaFetch(`script_annotations?id=eq.${body.id}&client_id=eq.${client.id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json((await r.json())[0]);
  }

  // --- Admin ---
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const r = await supaFetch(`script_annotations?id=eq.${body.id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  }, true);
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
  return NextResponse.json((await r.json())[0]);
}

export async function DELETE(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  if (portalToken) {
    const client = await resolveClientFromToken(portalToken);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    const r = await supaFetch(`script_annotations?id=eq.${body.id}&client_id=eq.${client.id}`, {
      method: 'DELETE',
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json({ success: true });
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const r = await supaFetch(`script_annotations?id=eq.${body.id}`, { method: 'DELETE' }, true);
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
  return NextResponse.json({ success: true });
}
