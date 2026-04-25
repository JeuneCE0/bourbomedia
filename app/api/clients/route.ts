import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { sendWhatsAppMessage, sendEmailMessage } from '@/lib/ghl';
import { triggerWorkflow } from '@/lib/ghl-workflows';
import crypto from 'crypto';

async function logEvent(clientId: string, type: string, payload?: Record<string, unknown>) {
  try {
    await supaFetch('client_events', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, type, payload: payload || null, actor: 'admin' }),
    }, true);
  } catch { /* non-blocking */ }
}

async function pushNotification(clientId: string, type: string, title: string, body?: string) {
  try {
    await supaFetch('client_notifications', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, type, title, body: body || null }),
    }, true);
  } catch { /* non-blocking */ }
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get('id');
    const path = id
      ? `clients?id=eq.${id}&select=*,scripts(*,script_comments(*)),videos(*)`
      : 'clients?select=*&order=created_at.desc';
    const r = await supaFetch(path, {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(id ? data[0] || null : data);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const body = await req.json();
    body.portal_token = crypto.randomBytes(24).toString('hex');
    const r = await supaFetch('clients', {
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
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id, ...fields } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    // Fetch previous state for change detection
    const prevR = await supaFetch(`clients?id=eq.${id}&select=*`, {}, true);
    const prev = prevR.ok ? (await prevR.json())[0] : null;

    fields.updated_at = new Date().toISOString();
    const r = await supaFetch(`clients?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    const updated = data[0];

    // --- Side effects: event logging (always) + notifications (gated by flag) ---
    const notifyEnabled = process.env.NOTIFICATIONS_ENABLED === 'true';
    const fireAndForget = async () => {
      // Status change: script sent to client
      if (prev && fields.status === 'script_review' && prev.status !== 'script_review') {
        logEvent(id, 'script_sent_to_client', { version: updated.script_version });
        pushNotification(id, 'script_ready', 'Votre script est prêt à relire ✍', 'Connectez-vous pour le consulter et le valider.');
        // GHL workflow trigger (tag-based) — runs whether or not direct sends are enabled
        triggerWorkflow(updated.ghl_contact_id, 'script_ready').catch(() => {});
        if (notifyEnabled && updated.ghl_contact_id) {
          const portalUrl = updated.portal_token ? `https://bourbonmedia.fr/portal?token=${updated.portal_token}` : '';
          await sendWhatsAppMessage(updated.ghl_contact_id,
            `Bonjour ${updated.contact_name} ! Votre script vidéo est prêt pour relecture. Consultez-le et donnez-nous votre feedback : ${portalUrl}`
          );
          await sendEmailMessage(updated.ghl_contact_id,
            'Votre script est prêt — BourbonMédia',
            `<p>Bonjour ${updated.contact_name},</p>
             <p>Votre script vidéo est prêt pour <strong>relecture</strong> !</p>
             <p>Consultez-le et donnez-nous votre feedback sur votre espace client :</p>
             <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#E8692B;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Ouvrir mon espace</a></p>
             <p>À très vite !<br>L'équipe BourbonMédia</p>`
          );
        }
      }

      // Delivery: video delivered
      if (prev && fields.delivered_at && !prev.delivered_at) {
        logEvent(id, 'video_delivered', { video_url: updated.video_url });
        pushNotification(id, 'video_delivered', 'Votre vidéo est prête 🎬', 'Découvrez le résultat final dans votre espace.');
        triggerWorkflow(updated.ghl_contact_id, 'video_delivered').catch(() => {});
        if (notifyEnabled && updated.ghl_contact_id) {
          const portalUrl = updated.portal_token ? `https://bourbonmedia.fr/portal?token=${updated.portal_token}` : '';
          await sendWhatsAppMessage(updated.ghl_contact_id,
            `🎉 ${updated.contact_name}, votre vidéo est prête ! Découvrez-la sur votre espace : ${portalUrl}`
          );
          await sendEmailMessage(updated.ghl_contact_id,
            '🎬 Votre vidéo est prête — BourbonMédia',
            `<p>Bonjour ${updated.contact_name},</p>
             <p>Grande nouvelle : <strong>votre vidéo est prête</strong> !</p>
             <p>Découvrez le résultat final sur votre espace client :</p>
             <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#E8692B;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Voir ma vidéo 🎬</a></p>
             ${updated.delivery_notes ? `<blockquote style="border-left:3px solid #E8692B;padding:8px 12px;color:#555">${updated.delivery_notes.replace(/\n/g, '<br>')}</blockquote>` : ''}
             <p>Merci de nous avoir fait confiance !<br>L'équipe BourbonMédia</p>`
          );
        }
      }

      // Filming date set/changed
      if (prev && fields.filming_date && prev.filming_date !== fields.filming_date) {
        const d = new Date(fields.filming_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        pushNotification(id, 'filming_scheduled', `Tournage planifié 🎥`, `Votre tournage est prévu le ${d}.`);
        logEvent(id, 'filming_scheduled', { date: fields.filming_date });
        triggerWorkflow(updated.ghl_contact_id, 'filming_scheduled').catch(() => {});
      }

      // Project published
      if (prev && fields.status === 'published' && prev.status !== 'published') {
        triggerWorkflow(updated.ghl_contact_id, 'project_published').catch(() => {});
      }

      // Generic status change logging
      if (prev && fields.status && prev.status !== fields.status) {
        logEvent(id, 'status_changed', { from: prev.status, to: fields.status });
      }
    };
    fireAndForget().catch(e => console.error('Notification error:', e));

    return NextResponse.json(updated);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });
    const r = await supaFetch(`clients?id=eq.${id}`, { method: 'DELETE' }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
