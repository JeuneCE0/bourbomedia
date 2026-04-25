import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { findNextAvailableSlot, bookFilmingSlot, computePublicationDeadline } from '@/lib/filming';
import { notifyScriptValidated, notifyFilmingScheduled, notifyAnnotationsSent } from '@/lib/slack';
import { triggerWorkflow } from '@/lib/ghl-workflows';
import { sendWhatsAppMessage, sendEmailMessage } from '@/lib/ghl';

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('client_id');
  const portalToken = req.nextUrl.searchParams.get('token');

  if (portalToken) {
    try {
      const cr = await supaFetch(
        `clients?portal_token=eq.${portalToken}&select=id,business_name,contact_name,video_url,video_thumbnail_url,delivery_notes,delivered_at,status,filming_date,publication_deadline,contract_pdf_url,contract_signature_link`,
        {},
        true
      );
      if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const clients = await cr.json();
      if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const c = clients[0];

      const [scriptR, videosR, paymentsR] = await Promise.all([
        supaFetch(`scripts?client_id=eq.${c.id}&select=*,script_comments(*)`, {}, true),
        supaFetch(`videos?client_id=eq.${c.id}&status=eq.delivered&select=*&order=created_at.desc`, {}, true),
        supaFetch(`payments?client_id=eq.${c.id}&status=eq.completed&select=id,amount,currency,description,receipt_url,invoice_pdf_url,invoice_number,created_at&order=created_at.desc`, {}, true),
      ]);

      const scriptData = scriptR.ok ? await scriptR.json() : [];
      const videos = videosR.ok ? await videosR.json() : [];
      const payments = paymentsR.ok ? await paymentsR.json() : [];

      return NextResponse.json({
        script: scriptData[0] || null,
        client: {
          business_name: c.business_name,
          contact_name: c.contact_name,
          status: c.status,
          video_url: c.video_url,
          video_thumbnail_url: c.video_thumbnail_url,
          delivery_notes: c.delivery_notes,
          delivered_at: c.delivered_at,
          filming_date: c.filming_date,
          publication_deadline: c.publication_deadline,
          contract_pdf_url: c.contract_pdf_url,
          contract_signature_link: c.contract_signature_link,
        },
        videos,
        payments,
      });
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

    const existingR = await supaFetch(`scripts?client_id=eq.${body.client_id}&select=id`, {}, true);
    const existing = existingR.ok ? await existingR.json() : [];

    if (existing.length) {
      const { client_id: _cid, ...fields } = body;
      fields.updated_at = new Date().toISOString();
      const r = await supaFetch(`scripts?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }, true);
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();
      return NextResponse.json(data[0]);
    }

    const r = await supaFetch('scripts', {
      method: 'POST',
      body: JSON.stringify(body),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();

    // Log script creation event (non-blocking)
    try {
      await supaFetch('client_events', {
        method: 'POST',
        body: JSON.stringify({
          client_id: body.client_id,
          type: 'script_created',
          payload: { title: body.title || null },
          actor: 'admin',
        }),
      }, true);
    } catch { /* non-blocking */ }

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

      async function logEvent(type: string, payload: Record<string, unknown> = {}) {
        try {
          await supaFetch('client_events', {
            method: 'POST',
            body: JSON.stringify({ client_id: cid, type, payload, actor: 'client' }),
          }, true);
        } catch { /* */ }
      }

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
        logEvent('script_validated', filmingDate ? { filming_date: filmingDate } : {});
        // GHL workflows
        triggerWorkflow(client.ghl_contact_id, 'script_validated').catch(() => {});
        if (filmingDate) triggerWorkflow(client.ghl_contact_id, 'filming_scheduled').catch(() => {});

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

        // Pull current annotations to enrich the Slack ping
        try {
          const cR = await supaFetch(`clients?id=eq.${cid}&select=business_name`, {}, true);
          const clientArr = cR.ok ? await cR.json() : [];
          const clientName = clientArr[0]?.business_name || 'Client';
          const sIdR = await supaFetch(`scripts?client_id=eq.${cid}&select=id`, {}, true);
          const sArr = sIdR.ok ? await sIdR.json() : [];
          const sid = sArr[0]?.id;
          if (sid) {
            const aR = await supaFetch(`script_annotations?script_id=eq.${sid}&resolved=eq.false&select=quote,note&order=created_at.desc`, {}, true);
            const annots = aR.ok ? await aR.json() : [];
            if (annots.length) {
              notifyAnnotationsSent(
                clientName,
                annots.length,
                annots.map((a: { quote: string; note: string }) => `« ${a.quote.slice(0, 60)}${a.quote.length > 60 ? '…' : ''} » → ${a.note.slice(0, 80)}${a.note.length > 80 ? '…' : ''}`),
              ).catch(() => {});
            }
          }
        } catch { /* non-blocking */ }

        logEvent('script_changes_requested');

        // GHL workflow: notify the client we received their changes
        try {
          const cR = await supaFetch(`clients?id=eq.${cid}&select=ghl_contact_id`, {}, true);
          const cArr = cR.ok ? await cR.json() : [];
          if (cArr[0]?.ghl_contact_id) {
            triggerWorkflow(cArr[0].ghl_contact_id, 'script_changes_requested').catch(() => {});
          }
        } catch { /* */ }

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
