import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { computePublicationDeadline } from '@/lib/filming';
import { notifyScriptValidated, notifyFilmingScheduled, notifyAnnotationsSent } from '@/lib/slack';
import { triggerWorkflow } from '@/lib/ghl-workflows';
import { trackFunnelServer } from '@/lib/funnel';
import { sendPushToAll } from '@/lib/push';
import { listCalendarEvents } from '@/lib/ghl-opportunities';

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('client_id');
  const portalToken = req.nextUrl.searchParams.get('token');

  if (portalToken) {
    try {
      const cr = await supaFetch(
        `clients?portal_token=eq.${portalToken}&select=id,business_name,contact_name,email,phone,video_url,video_thumbnail_url,delivery_notes,delivered_at,status,filming_date,filming_date_confirmed,publication_deadline,publication_date_confirmed,video_validated_at,video_review_comment,video_changes_requested,contract_pdf_url,contract_signature_link,contract_signed_at,paid_at,onboarding_call_booked`,
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
          email: c.email,
          phone: c.phone,
          status: c.status,
          video_url: c.video_url,
          video_thumbnail_url: c.video_thumbnail_url,
          delivery_notes: c.delivery_notes,
          delivered_at: c.delivered_at,
          filming_date: c.filming_date,
          publication_deadline: c.publication_deadline,
          publication_date_confirmed: c.publication_date_confirmed,
          video_validated_at: c.video_validated_at,
          video_review_comment: c.video_review_comment,
          video_changes_requested: c.video_changes_requested,
          contract_pdf_url: c.contract_pdf_url,
          contract_signature_link: c.contract_signature_link,
          contract_signed_at: c.contract_signed_at,
          paid_at: c.paid_at,
          onboarding_call_booked: c.onboarding_call_booked,
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

      const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
      const action = reqBody.action as string | undefined;

      async function logEvent(type: string, payload: Record<string, unknown> = {}) {
        try {
          await supaFetch('client_events', {
            method: 'POST',
            body: JSON.stringify({ client_id: cid, type, payload, actor: 'client' }),
          }, true);
        } catch { /* */ }
      }

      if (action === 'validate') {
        // Mark the script as confirmed. We do NOT auto-book the filming slot
        // anymore — the client chooses the date themselves on the GHL calendar
        // (3h block) right after validation. We also do NOT send a direct
        // confirmation email/WA from here; the GHL workflow listening on the
        // `bbm_script_validated` tag is the single source of truth for that
        // copy, so the user can edit the message in their GHL UI.
        const sr = await supaFetch(`scripts?client_id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() }),
        }, true);
        if (!sr.ok) return NextResponse.json({ error: await sr.text() }, { status: sr.status });

        const clientR = await supaFetch(`clients?id=eq.${cid}&select=*`, {}, true);
        const clientData = clientR.ok ? await clientR.json() : [];
        const client = clientData[0] || {};

        // Move the client to script_validated — filming_date stays null until
        // they pick a slot via the GHL calendar embed in the portal.
        await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'script_validated', updated_at: new Date().toISOString() }),
        }, true);

        notifyScriptValidated(client.business_name || 'Client', client.contact_name || '');
        logEvent('script_validated');
        triggerWorkflow(client.ghl_contact_id, 'script_validated').catch(() => {});
        void trackFunnelServer({ event: 'script_validated', source: 'portal', clientId: client.id });
        void sendPushToAll({
          title: '✅ Script validé',
          body: `${client.business_name || 'Un client'} a validé son script. Prêt à shooter.`,
          url: `/dashboard/clients/${client.id}?tab=script`,
          tag: `script-${client.id}`,
        });

        const data = await sr.json();
        return NextResponse.json(data[0]);
      }

      // Vérification GHL côté portail : appelée en boucle par
      // FilmingBookingPanel après que l'iframe est chargée. L'embed iframe
      // ne navigue pas, donc useJustBookedFromGhl ne se déclenche jamais
      // et le webhook GHL peut ne pas être configuré → le portail
      // restait coincé sur l'écran de réservation. On pull les events GHL
      // du calendrier tournage et on matche par ghl_contact_id. Idempotent.
      if (action === 'verify_filming_booked') {
        try {
          // Lookup client info nécessaire pour le match
          const cR2 = await supaFetch(`clients?id=eq.${cid}&select=filming_date,filming_date_confirmed,ghl_contact_id,business_name&limit=1`, {}, true);
          const cArr = cR2.ok ? await cR2.json() : [];
          const cl2 = cArr[0];
          if (!cl2) return NextResponse.json({ booked: false, reason: 'no_client' });
          if (cl2.filming_date_confirmed) {
            return NextResponse.json({ booked: true, source: 'cached' });
          }
          const filmingCalendarId = process.env.GHL_FILMING_CALENDAR_ID || '';
          if (!filmingCalendarId || !cl2.ghl_contact_id) {
            return NextResponse.json({ booked: false, reason: 'no_calendar_or_contact' });
          }
          const fromIso = new Date(Date.now() - 7 * 86400000).toISOString();
          const toIso = new Date(Date.now() + 90 * 86400000).toISOString();
          const { events } = await listCalendarEvents(filmingCalendarId, fromIso, toIso);
          const match = events.find(e => e.contactId === cl2.ghl_contact_id
            && (!e.appointmentStatus || !/cancel/i.test(e.appointmentStatus)));
          if (!match) return NextResponse.json({ booked: false });
          await supaFetch(`clients?id=eq.${cid}`, {
            method: 'PATCH',
            body: JSON.stringify({
              filming_date: match.startTime,
              filming_date_confirmed: true,
              status: 'filming_scheduled',
              updated_at: new Date().toISOString(),
            }),
          }, true);
          notifyFilmingScheduled(cl2.business_name || 'Client', match.startTime);
          logEvent('filming_scheduled', { date: match.startTime, via: 'verify_filming_booked' });
          void trackFunnelServer({
            event: 'filming_booked',
            source: 'portal',
            clientId: cid,
            metadata: { via: 'verify_filming_booked', date: match.startTime, appointment_id: match.id },
          });
          void sendPushToAll({
            title: '🎬 Tournage réservé',
            body: `${cl2.business_name || 'Un client'} a réservé son tournage le ${new Date(match.startTime).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} (vérif portail).`,
            url: `/dashboard/clients/${cid}?tab=journey`,
            tag: `filming-${cid}`,
          });
          return NextResponse.json({ booked: true, source: 'verified', date: match.startTime });
        } catch (e: unknown) {
          return NextResponse.json({ booked: false, error: (e as Error).message }, { status: 200 });
        }
      }

      // Client confirms they booked their tournage slot on the GHL calendar.
      // Optional: pass `date` (ISO string) to record it on the client record;
      // otherwise the admin reads it from GHL and updates the client manually.
      if (action === 'confirm_filming_booked') {
        const date = typeof reqBody.date === 'string' ? (reqBody.date as string) : null;
        const updates: Record<string, unknown> = {
          status: 'filming_scheduled',
          filming_date_confirmed: true,
          updated_at: new Date().toISOString(),
        };
        if (date) {
          const d = new Date(date);
          if (!Number.isNaN(d.getTime())) {
            // Uniqueness check : only 1 tournage slot per day (3h block)
            const dayIso = d.toISOString().slice(0, 10);
            try {
              const conflictR = await supaFetch(
                `clients?filming_date=gte.${dayIso}T00:00:00&filming_date=lte.${dayIso}T23:59:59&id=neq.${cid}&select=id`,
                {}, true,
              );
              if (conflictR.ok) {
                const conflicts = await conflictR.json();
                if (conflicts.length > 0) {
                  return NextResponse.json({
                    error: 'Ce jour de tournage est déjà pris par un autre projet. Choisissez une autre date.',
                    conflict: true,
                  }, { status: 409 });
                }
              }
            } catch { /* */ }
            updates.filming_date = d.toISOString();
            // Note: we no longer auto-set publication_deadline here — the client
            // will pick it explicitly after video validation.
          }
        }
        await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }, true);

        const cR = await supaFetch(`clients?id=eq.${cid}&select=business_name,ghl_contact_id`, {}, true);
        const arr = cR.ok ? await cR.json() : [];
        const cl = arr[0] || {};
        if (date) notifyFilmingScheduled(cl.business_name || 'Client', date);
        logEvent('filming_scheduled', date ? { date } : {});
        triggerWorkflow(cl.ghl_contact_id || null, 'filming_scheduled').catch(() => {});
        void trackFunnelServer({ event: 'filming_booked', source: 'portal', clientId: cid, metadata: date ? { date } : null });
        void sendPushToAll({
          title: '🎬 Tournage réservé',
          body: `${cl.business_name || 'Un client'} a réservé son tournage${date ? ` le ${new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}.`,
          url: `/dashboard/clients/${cid}?tab=journey`,
          tag: `filming-${cid}`,
        });

        return NextResponse.json({ ok: true, filming_date: updates.filming_date || null });
      }

      // Client validates the delivered video (no further changes needed).
      // Moves the project from "video_review" to "publication_pending" — the
      // client will then pick a publication date in the next step.
      if (action === 'validate_video') {
        const updates: Record<string, unknown> = {
          status: 'publication_pending',
          video_validated_at: new Date().toISOString(),
          video_changes_requested: false,
          video_review_comment: typeof reqBody.comment === 'string' ? (reqBody.comment as string) : null,
          updated_at: new Date().toISOString(),
        };
        const r = await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }, true);
        if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });

        const cR = await supaFetch(`clients?id=eq.${cid}&select=business_name,ghl_contact_id`, {}, true);
        const arr = cR.ok ? await cR.json() : [];
        const cl = arr[0] || {};
        logEvent('video_validated');
        // Reuse the satisfaction workflow tag — the user can branch on it in GHL
        triggerWorkflow(cl.ghl_contact_id || null, 'feedback_requested').catch(() => {});
        void trackFunnelServer({ event: 'video_validated', source: 'portal', clientId: cid });
        void sendPushToAll({
          title: '👍 Vidéo validée',
          body: `${cl.business_name || 'Un client'} a validé sa vidéo. Prochaine étape : choix de la date de publication.`,
          url: `/dashboard/clients/${cid}?tab=delivery`,
          tag: `video-validated-${cid}`,
        });
        return NextResponse.json({ ok: true });
      }

      // Client requests changes on the delivered video.
      if (action === 'request_video_changes') {
        const comment = typeof reqBody.comment === 'string' ? (reqBody.comment as string).trim() : '';
        const updates: Record<string, unknown> = {
          status: 'video_review',
          video_changes_requested: true,
          video_review_comment: comment || null,
          updated_at: new Date().toISOString(),
        };
        const r = await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }, true);
        if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });

        const cR = await supaFetch(`clients?id=eq.${cid}&select=business_name`, {}, true);
        const arr = cR.ok ? await cR.json() : [];
        const cl = arr[0] || {};
        logEvent('video_changes_requested', { comment_preview: comment.slice(0, 80) });
        void trackFunnelServer({ event: 'video_changes_requested', source: 'portal', clientId: cid, metadata: comment ? { comment_preview: comment.slice(0, 120) } : null });
        void sendPushToAll({
          title: '✏️ Modifications demandées',
          body: `${cl.business_name || 'Un client'} demande des changements sur sa vidéo${comment ? ` : « ${comment.slice(0, 60)}${comment.length > 60 ? '…' : ''} »` : '.'}`,
          url: `/dashboard/clients/${cid}?tab=delivery`,
          tag: `video-changes-${cid}`,
        });
        return NextResponse.json({ ok: true });
      }

      // Client picks a publication date (must be a Tuesday or Thursday).
      if (action === 'confirm_publication_date') {
        // Date optionnelle : si le client la fournit on valide jour-de-semaine /
        // unicité ; sinon on flag juste publication_date_confirmed et l'admin
        // remplira publication_deadline depuis GHL (cohérent avec confirm_filming_booked).
        const dateStr = typeof reqBody.date === 'string' ? (reqBody.date as string) : '';
        const updates: Record<string, unknown> = {
          publication_date_confirmed: true,
          updated_at: new Date().toISOString(),
        };

        if (dateStr) {
          const d = new Date(dateStr);
          if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Date invalide' }, { status: 400 });
          const dow = d.getDay(); // 0=Sun .. 6=Sat
          if (dow !== 2 && dow !== 4) {
            return NextResponse.json({ error: 'Les publications ne sont planifiées que le mardi ou le jeudi.' }, { status: 400 });
          }
          const isoDate = d.toISOString().slice(0, 10);
          try {
            const conflictR = await supaFetch(
              `clients?publication_deadline=eq.${isoDate}&publication_date_confirmed=eq.true&id=neq.${cid}&select=id`,
              {}, true,
            );
            if (conflictR.ok) {
              const conflicts = await conflictR.json();
              if (conflicts.length > 0) {
                return NextResponse.json({
                  error: 'Cette date est déjà réservée par un autre projet. Choisissez un autre créneau.',
                  conflict: true,
                }, { status: 409 });
              }
            }
          } catch { /* fall through — the unique constraint isn't critical */ }
          updates.publication_deadline = isoDate;
        }

        const r = await supaFetch(`clients?id=eq.${cid}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }, true);
        if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });

        const cR = await supaFetch(`clients?id=eq.${cid}&select=business_name,ghl_contact_id`, {}, true);
        const arr = cR.ok ? await cR.json() : [];
        const cl = arr[0] || {};
        logEvent('publication_scheduled', dateStr ? { date: dateStr } : {});
        triggerWorkflow(cl.ghl_contact_id || null, 'project_published').catch(() => {});
        void trackFunnelServer({ event: 'publication_booked', source: 'portal', clientId: cid, metadata: dateStr ? { date: dateStr } : null });
        void sendPushToAll({
          title: '🗓️ Date de publication choisie',
          body: `${cl.business_name || 'Un client'} a choisi sa date de publication${dateStr ? ` (${new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })})` : ''}.`,
          url: `/dashboard/clients/${cid}?tab=delivery`,
          tag: `publication-${cid}`,
        });
        return NextResponse.json({ ok: true, publication_deadline: updates.publication_deadline || null });
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
