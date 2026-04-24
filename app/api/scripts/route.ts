import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { findNextAvailableSlot, bookFilmingSlot, computePublicationDeadline } from '@/lib/filming';
import { notifyScriptValidated, notifyFilmingScheduled } from '@/lib/slack';
import { sendWhatsAppMessage, sendEmailMessage } from '@/lib/ghl';

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('client_id');
  const portalToken = req.nextUrl.searchParams.get('token');

  if (portalToken) {
    try {
      const cr = await supaFetch(`clients?portal_token=eq.${portalToken}&select=id`, {}, true);
      if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const clients = await cr.json();
      if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const cid = clients[0].id;
      const r = await supaFetch(`scripts?client_id=eq.${cid}&select=*,script_comments(*)`, {}, true);
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();
      return NextResponse.json(data[0] || null);
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const path = clientId
      ? `scripts?client_id=eq.${clientId}&select=*,script_comments(*)`
      : 'scripts?select=*,clients(business_name)&order=updated_at.desc';
    const r = await supaFetch(path, {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(clientId ? data[0] || null : data);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 });
    const r = await supaFetch('scripts', {
      method: 'POST',
      body: JSON.stringify(body),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0], { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const portalToken = req.nextUrl.searchParams.get('token');

  if (portalToken) {
    try {
      const cr = await supaFetch(`clients?portal_token=eq.${portalToken}&select=id`, {}, true);
      if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const clients = await cr.json();
      if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const cid = clients[0].id;

      const { action } = await req.json();

      if (action === 'validate') {
        const sr = await supaFetch(`scripts?client_id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() }),
        }, true);
        if (!sr.ok) return NextResponse.json({ error: await sr.text() }, { status: sr.status });

        // Fetch client info for notifications
        const clientR = await supaFetch(`clients?id=eq.${cid}&select=*`, {}, true);
        const clientData = clientR.ok ? await clientR.json() : [];
        const client = clientData[0] || {};

        // Auto-book first available filming slot
        const filmingDate = await findNextAvailableSlot();
        const updateFields: Record<string, unknown> = { status: 'script_validated', updated_at: new Date().toISOString() };

        if (filmingDate) {
          await bookFilmingSlot(filmingDate, cid);
          updateFields.status = 'filming_scheduled';
          updateFields.filming_date = filmingDate;
          updateFields.publication_deadline = computePublicationDeadline(filmingDate);
        }

        await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify(updateFields),
        }, true);

        // Slack notification
        notifyScriptValidated(client.business_name || 'Client', client.contact_name || '');
        if (filmingDate) {
          notifyFilmingScheduled(client.business_name || 'Client', filmingDate);
        }

        // GHL WhatsApp + Email notifications
        if (client.ghl_contact_id) {
          const dateFormatted = filmingDate
            ? new Date(filmingDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
            : '';

          sendWhatsAppMessage(client.ghl_contact_id,
            filmingDate
              ? `Bonjour ${client.contact_name} ! Votre script a été validé. Votre tournage est prévu le ${dateFormatted}. L'équipe BourbonMédia vous contactera pour les détails. À bientôt !`
              : `Bonjour ${client.contact_name} ! Votre script a été validé. Nous allons planifier votre tournage très prochainement. À bientôt !`
          );

          sendEmailMessage(client.ghl_contact_id,
            'Script validé — BourbonMédia',
            `<p>Bonjour ${client.contact_name},</p>
            <p>Votre script vidéo a été <strong>validé avec succès</strong> !</p>
            ${filmingDate ? `<p>Votre tournage est prévu le <strong>${dateFormatted}</strong>.</p>` : '<p>Nous planifions votre tournage et reviendrons vers vous rapidement.</p>'}
            <p>L'équipe BourbonMédia</p>`
          );
        }

        const data = await sr.json();
        return NextResponse.json(data[0]);
      }

      if (action === 'request_changes') {
        const sr = await supaFetch(`scripts?client_id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'awaiting_changes', updated_at: new Date().toISOString() }),
        }, true);
        if (!sr.ok) return NextResponse.json({ error: await sr.text() }, { status: sr.status });

        await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'script_review', updated_at: new Date().toISOString() }),
        }, true);

        const data = await sr.json();
        return NextResponse.json(data[0]);
      }

      return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id, ...fields } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    // Save version before updating
    const currentR = await supaFetch(`scripts?id=eq.${id}&select=*`, {}, true);
    let prev: { status?: string; version?: number; content?: unknown; created_by?: string } | null = null;
    if (currentR.ok) {
      const current = await currentR.json();
      if (current.length) {
        prev = current[0];
        await supaFetch('script_versions', {
          method: 'POST',
          body: JSON.stringify({
            script_id: id,
            version: prev?.version,
            content: prev?.content,
            status: prev?.status,
            created_by: prev?.created_by,
          }),
        }, true);
      }
    }

    fields.updated_at = new Date().toISOString();
    if (fields.content) {
      fields.version = (prev?.version || 1) + 1;
      // If client had asked for changes and admin didn't pass explicit status,
      // mark as 'modified' automatically
      if (!fields.status && prev?.status === 'awaiting_changes') {
        fields.status = 'modified';
      }
    }

    const r = await supaFetch(`scripts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data[0]);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
