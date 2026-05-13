import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'videos';
// 5 GB — couvre les rendus admin habituels (vidéos courtes 1080p, parfois 4K).
// Doit aussi être autorisé côté projet Supabase (Settings → Storage → Max file size).
const FILE_SIZE_LIMIT = 5 * 1024 * 1024 * 1024;

// Le bucket doit exister avec une limite de taille suffisante AVANT le PUT signé.
// On crée à la première utilisation, puis on PATCH pour s'assurer que la limite
// reste à jour si on change FILE_SIZE_LIMIT plus tard (Supabase ne permet pas
// d'override par fichier, c'est la limite du bucket qui s'applique).
//
// Historique du bug : la version précédente faisait `.catch(() => null)` sur
// le PUT/POST → si Supabase répondait 4xx (mauvaise clé, RLS, etc.), le
// bucket n'était jamais réellement créé. Le signed upload était quand même
// émis mais retombait sur le plafond par défaut (50 Mo) → 413 dès que
// l'admin uploadait une vidéo client (>50 Mo systématique). On log
// maintenant le détail dans la console Vercel pour ne plus rater ça.
async function ensureBucket(): Promise<void> {
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const head = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers });
  if (head.ok) {
    const upd = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ public: true, file_size_limit: FILE_SIZE_LIMIT }),
    });
    if (!upd.ok) {
      console.error(`[videos/upload-url] Update bucket failed ${upd.status}: ${await upd.text()}`);
    }
    return;
  }
  const create = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: FILE_SIZE_LIMIT }),
  });
  if (!create.ok) {
    console.error(`[videos/upload-url] Create bucket failed ${create.status}: ${await create.text()}`);
  }
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
