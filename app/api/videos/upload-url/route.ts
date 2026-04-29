import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'videos';

// First call after a fresh DB needs the bucket to exist before signed uploads work.
// We create it lazily (idempotent — 409 on existing) so admins don't have to touch the dashboard.
async function ensureBucket() {
  const head = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (head.ok) return;
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  try {
    const { filename, contentType, clientId } = await req.json();
    if (!filename) return NextResponse.json({ error: 'filename requis' }, { status: 400 });
    if (!contentType || !contentType.startsWith('video/')) {
      return NextResponse.json({ error: 'Type non autorisé (vidéo uniquement)' }, { status: 400 });
    }

    await ensureBucket();

    const rawExt = filename.includes('.') ? filename.split('.').pop() : 'mp4';
    const ext = (rawExt || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'mp4';
    const folder = clientId ? `${String(clientId).replace(/[^a-z0-9-]/gi, '')}/` : '';
    const path = `${folder}${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const { url: relativeUploadUrl } = await r.json();

    const uploadUrl = `${SUPABASE_URL}/storage/v1${relativeUploadUrl}`;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return NextResponse.json({ uploadUrl, publicUrl, path });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
