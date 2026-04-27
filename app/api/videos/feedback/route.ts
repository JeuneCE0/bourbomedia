import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// Per-video timestamped feedback API.
// Accepts both portal-token (client side) and admin auth (admin replies).

interface FeedbackEntry {
  id: string;
  time_seconds: number;
  comment: string;
  author: 'client' | 'admin';
  created_at: string;
  resolved?: boolean;
}

async function resolveAccess(req: NextRequest, bodyToken?: string): Promise<{ ok: boolean; clientId?: string; isAdmin?: boolean }> {
  const token = req.nextUrl.searchParams.get('token') || bodyToken || null;
  if (token) {
    const cr = await supaFetch(`clients?portal_token=eq.${token}&select=id&limit=1`, {}, true);
    if (!cr.ok) return { ok: false };
    const arr = await cr.json();
    if (!arr[0]?.id) return { ok: false };
    return { ok: true, clientId: arr[0].id };
  }
  if (requireAuth(req)) return { ok: true, isAdmin: true };
  return { ok: false };
}

async function loadVideo(videoId: string, scopedClientId?: string): Promise<{ id: string; client_id: string; feedback?: FeedbackEntry[] } | null> {
  const r = await supaFetch(`videos?id=eq.${encodeURIComponent(videoId)}&select=id,client_id,feedback&limit=1`, {}, true);
  if (!r.ok) return null;
  const arr = await r.json();
  const v = arr[0] || null;
  if (!v) return null;
  if (scopedClientId && v.client_id !== scopedClientId) return null;
  return v;
}

// GET /api/videos/feedback?token=...&video_id=... → list feedback entries
// GET /api/videos/feedback?video_id=... (admin) → same
export async function GET(req: NextRequest) {
  const access = await resolveAccess(req);
  if (!access.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const videoId = req.nextUrl.searchParams.get('video_id');
  if (!videoId) return NextResponse.json({ error: 'video_id requis' }, { status: 400 });
  const v = await loadVideo(videoId, access.clientId);
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ feedback: v.feedback || [] });
}

// POST { video_id, time_seconds, comment, token? } → adds a feedback entry
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const access = await resolveAccess(req, body.token as string | undefined);
  if (!access.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const videoId = body.video_id as string | undefined;
  const time_seconds = Number(body.time_seconds);
  const comment = String(body.comment || '').trim();
  if (!videoId || !comment) return NextResponse.json({ error: 'video_id et comment requis' }, { status: 400 });
  if (!Number.isFinite(time_seconds) || time_seconds < 0) {
    return NextResponse.json({ error: 'time_seconds invalide' }, { status: 400 });
  }
  const v = await loadVideo(videoId, access.clientId);
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const entry: FeedbackEntry = {
    id: crypto.randomUUID(),
    time_seconds,
    comment,
    author: access.isAdmin ? 'admin' : 'client',
    created_at: new Date().toISOString(),
  };
  const next = [...(v.feedback || []), entry].sort((a, b) => a.time_seconds - b.time_seconds);
  const r = await supaFetch(`videos?id=eq.${encodeURIComponent(videoId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ feedback: next }),
  }, true);
  if (!r.ok) return NextResponse.json({ error: 'update failed' }, { status: 500 });
  return NextResponse.json({ entry, feedback: next });
}

// DELETE { video_id, entry_id, token? } → removes a feedback entry (own only for client)
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const access = await resolveAccess(req, body.token as string | undefined);
  if (!access.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const videoId = body.video_id as string | undefined;
  const entryId = body.entry_id as string | undefined;
  if (!videoId || !entryId) return NextResponse.json({ error: 'video_id et entry_id requis' }, { status: 400 });
  const v = await loadVideo(videoId, access.clientId);
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const next = (v.feedback || []).filter(e => {
    if (e.id !== entryId) return true;
    // Clients can only delete their own entries; admin can delete any
    if (access.isAdmin) return false;
    return e.author !== 'client';
  });
  const r = await supaFetch(`videos?id=eq.${encodeURIComponent(videoId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ feedback: next }),
  }, true);
  if (!r.ok) return NextResponse.json({ error: 'update failed' }, { status: 500 });
  return NextResponse.json({ feedback: next });
}
