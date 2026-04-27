import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { sendSlackNotification } from '@/lib/slack';
import { sendPushToAll } from '@/lib/push';

async function clientFromToken(token: string) {
  const r = await supaFetch(`clients?portal_token=eq.${token}&select=id`, {}, true);
  if (!r.ok) return null;
  const d = await r.json();
  return d[0] || null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  let clientId = req.nextUrl.searchParams.get('client_id');
  const onlyDelivered = !!token;

  if (token) {
    const client = await clientFromToken(token);
    if (!client) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    clientId = client.id;
  } else if (!requireAuth(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  if (!clientId) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });

  const filter = onlyDelivered ? '&status=eq.delivered' : '';
  const r = await supaFetch(
    `videos?client_id=eq.${clientId}${filter}&select=*&order=created_at.desc`,
    {}, true
  );
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
  return NextResponse.json(await r.json());
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.client_id || !body.video_url) {
      return NextResponse.json({ error: 'client_id et video_url requis' }, { status: 400 });
    }
    const r = await supaFetch('videos', {
      method: 'POST',
      body: JSON.stringify({
        client_id: body.client_id,
        title: body.title || null,
        video_url: body.video_url,
        thumbnail_url: body.thumbnail_url || null,
        delivery_notes: body.delivery_notes || null,
        status: body.status || 'draft',
        delivered_at: body.status === 'delivered' ? new Date().toISOString() : null,
      }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const d = await r.json();
    return NextResponse.json(d[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id, ...fields } = await req.json();
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const prevR = await supaFetch(`videos?id=eq.${id}&select=*`, {}, true);
    const prev = prevR.ok ? (await prevR.json())[0] : null;

    if (fields.status === 'delivered' && (!prev || prev.status !== 'delivered')) {
      fields.delivered_at = new Date().toISOString();
    }

    const r = await supaFetch(`videos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const d = await r.json();
    const updated = d[0];

    // If newly delivered, push portal notification + log event
    if (updated && fields.status === 'delivered' && (!prev || prev.status !== 'delivered')) {
      try {
        await supaFetch('client_notifications', {
          method: 'POST',
          body: JSON.stringify({
            client_id: updated.client_id,
            type: 'video_delivered',
            title: 'Nouvelle vidéo disponible 🎬',
            body: updated.title || 'Votre vidéo est prête',
          }),
        }, true);
        await supaFetch('client_events', {
          method: 'POST',
          body: JSON.stringify({
            client_id: updated.client_id,
            type: 'video_delivered',
            payload: { video_id: updated.id, title: updated.title },
            actor: 'admin',
          }),
        }, true);

        // Slack + push to admins
        const cR = await supaFetch(`clients?id=eq.${updated.client_id}&select=business_name`, {}, true);
        const cName = cR.ok ? (await cR.json())[0]?.business_name || 'Client' : 'Client';
        sendSlackNotification({
          text: `🎬 Vidéo livrée — ${cName}`,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Vidéo livrée 🎬', emoji: true } },
            { type: 'section', fields: [
              { type: 'mrkdwn', text: `*Commerce:*\n${cName}` },
              { type: 'mrkdwn', text: `*Vidéo:*\n${updated.title || '—'}` },
            ]},
          ],
        }).catch(() => null);
        sendPushToAll({
          title: '🎬 Vidéo livrée',
          body: `${cName} — ${updated.title || 'Vidéo prête'}`,
          url: `/dashboard/clients/${updated.client_id}?tab=delivery`,
          tag: `video-${updated.id}`,
        }).catch(() => null);
      } catch { /* */ }
    }

    return NextResponse.json(updated);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const r = await supaFetch(`videos?id=eq.${id}`, { method: 'DELETE' }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
