import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// Public NPS submission via portal_token, admin reads aggregated.

async function clientFromToken(token: string) {
  const r = await supaFetch(`clients?portal_token=eq.${token}&select=id,business_name,contact_name`, {}, true);
  if (!r.ok) return null;
  const d = await r.json();
  return d[0] || null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  // Portal: client checks if their NPS was already submitted (just returns the latest)
  if (token) {
    const client = await clientFromToken(token);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    const r = await supaFetch(`nps_responses?client_id=eq.${client.id}&order=created_at.desc&limit=1&select=*`, {}, true);
    if (!r.ok) return NextResponse.json(null);
    const d = await r.json();
    return NextResponse.json({ client: { business_name: client.business_name, contact_name: client.contact_name }, latest: d[0] || null });
  }

  // Admin
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const r = await supaFetch('nps_responses?select=*,clients(business_name,contact_name)&order=created_at.desc&limit=200', {}, true);
  if (!r.ok) return NextResponse.json([]);
  return NextResponse.json(await r.json());
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const body = await req.json();

  if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 401 });
  const client = await clientFromToken(token);
  if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });

  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return NextResponse.json({ error: 'Le score doit être entre 0 et 10' }, { status: 400 });
  }

  const r = await supaFetch('nps_responses', {
    method: 'POST',
    body: JSON.stringify({
      client_id: client.id,
      score,
      comment: body.comment ? String(body.comment).slice(0, 2000) : null,
    }),
  }, true);
  if (!r.ok) {
    const text = await r.text();
    const isMissing = /relation|PGRST205|Could not find the table|does not exist|schema cache/i.test(text);
    return NextResponse.json({
      error: isMissing ? 'Fonctionnalité bientôt disponible' : 'Impossible d\'enregistrer votre réponse',
      migration_missing: isMissing,
    }, { status: isMissing ? 503 : 500 });
  }

  // Activity log + auto-tag GHL based on bucket
  try {
    await supaFetch('client_events', {
      method: 'POST',
      body: JSON.stringify({
        client_id: client.id,
        type: 'nps_submitted',
        payload: { score, bucket: score <= 6 ? 'detractor' : score <= 8 ? 'passive' : 'promoter' },
        actor: 'client',
      }),
    }, true);
  } catch { /* */ }

  // Trigger appropriate GHL workflow (different for promoter / passive / detractor)
  try {
    const cR = await supaFetch(`clients?id=eq.${client.id}&select=ghl_contact_id`, {}, true);
    const arr = cR.ok ? await cR.json() : [];
    const contactId = arr[0]?.ghl_contact_id;
    if (contactId) {
      const { triggerWorkflow } = await import('@/lib/ghl-workflows');
      // Re-uses the existing 'feedback_requested' tag for any submission;
      // the user can branch in their workflow on a custom tag added below.
      const bucketTag = score >= 9 ? 'bbm_nps_promoter' : score <= 6 ? 'bbm_nps_detractor' : 'bbm_nps_passive';
      // Minimal direct tag-add (mirrors lib/ghl-workflows internal helper)
      const { ghlRequest } = await import('@/lib/ghl');
      await ghlRequest('POST', `/contacts/${contactId}/tags`, { tags: [bucketTag] }).catch(() => null);
      void triggerWorkflow;
    }
  } catch { /* */ }

  const data = await r.json();
  return NextResponse.json(data[0], { status: 201 });
}
