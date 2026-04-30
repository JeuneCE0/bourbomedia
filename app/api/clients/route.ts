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
    if (id) {
      const r = await supaFetch(`clients?id=eq.${id}&select=*,scripts(*,script_comments(*)),videos(*)`, {}, true);
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();
      return NextResponse.json(data[0] || null);
    }

    // List path with optional pagination
    const limit = Number(req.nextUrl.searchParams.get('limit') || '0');
    const offset = Number(req.nextUrl.searchParams.get('offset') || '0');
    const search = req.nextUrl.searchParams.get('q');
    const status = req.nextUrl.searchParams.get('status');

    // Par défaut on exclut les clients archivés (soft-delete). ?include_archived=1
    // pour les inclure (page archives, audit, etc.).
    const includeArchived = req.nextUrl.searchParams.get('include_archived') === '1';
    let path = 'clients?select=*&order=created_at.desc';
    if (!includeArchived) path += `&archived_at=is.null`;
    if (status) path += `&status=eq.${encodeURIComponent(status)}`;
    if (search && search.trim()) {
      const enc = encodeURIComponent(`%${search.trim()}%`);
      path += `&or=(business_name.ilike.${enc},contact_name.ilike.${enc},email.ilike.${enc},city.ilike.${enc})`;
    }
    if (limit > 0) {
      path += `&limit=${limit}&offset=${offset}`;
    }

    // When paginated, also return total count via PostgREST exact-count header
    const r = await supaFetch(path, {
      headers: limit > 0 ? { 'Prefer': 'count=exact' } : {},
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();

    // If client requested pagination, send pagination envelope
    if (limit > 0) {
      const contentRange = r.headers.get('content-range') || '';
      const totalMatch = contentRange.match(/\/(\d+)$/);
      const total = totalMatch ? Number(totalMatch[1]) : data.length;
      return NextResponse.json({ data, total, limit, offset, hasMore: offset + data.length < total });
    }

    // Back-compat : raw array when no pagination requested
    return NextResponse.json(data);
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

    // When admin manually moves the client past 'video_review' on the kanban,
    // auto-set the validation flags so the portal flows correctly :
    //   - publication_pending → video is implicitly validated
    //   - published → video validated AND publication date confirmed
    // Without this, the portal shows the stale "validate your video" banner
    // and the publication date picker never appears.
    if (fields.status === 'publication_pending' && prev && !prev.video_validated_at) {
      fields.video_validated_at = new Date().toISOString();
      fields.video_changes_requested = false;
    }
    if (fields.status === 'published' && prev) {
      if (!prev.video_validated_at) fields.video_validated_at = new Date().toISOString();
      if (!prev.publication_date_confirmed) {
        fields.publication_date_confirmed = true;
        if (!prev.publication_deadline && !fields.publication_deadline) {
          fields.publication_deadline = new Date().toISOString().slice(0, 10);
        }
      }
      fields.video_changes_requested = false;
    }

    // Rollback automatique : quand l'admin déplace un client vers une étape
    // antérieure dans le kanban onboarding, on purge tout ce qui appartient
    // aux étapes "futures" pour que le portail affiche réellement l'étape
    // courante (le calendrier de booking ne pouvait pas s'afficher tant que
    // delivered_at / video_url / script.status='confirmed' restaient set).
    // On clear également les vidéos livrées et on remet le script à 'draft'
    // pour repartir d'une page propre — la donnée brute (script.content,
    // versions) est préservée, seul le statut bouge.
    if (
      prev
      && typeof fields.onboarding_step === 'number'
      && typeof prev.onboarding_step === 'number'
      && fields.onboarding_step < prev.onboarding_step
    ) {
      const ns = fields.onboarding_step as number;
      // Step 2 (Contrat)
      if (ns < 2) {
        fields.contract_signed_at = null;
        fields.contract_signature_link = null;
        fields.contract_yousign_id = null;
      }
      // Step 3 (Paiement)
      if (ns < 3) {
        fields.paid_at = null;
      }
      // Step 4 (Appel onboarding) — milestone à refaire
      if (ns < 4) {
        fields.onboarding_call_booked = false;
        fields.onboarding_call_date = null;
      }
      // Step 5 (Script) — script à réécrire/revalider
      if (ns < 5) {
        // On reset le statut du script existant à 'draft' (préserve le contenu).
        // Le portail check `if (!script)` puis script.status pour l'affichage,
        // mais NoScriptStage est aussi déclenché côté portal quand status est
        // dans onboarding/onboarding_call (ajouté en parallèle).
        await supaFetch(`scripts?client_id=eq.${id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'draft', updated_at: new Date().toISOString() }),
        }, true);
      }
      // Step 6 (Tournage)
      if (ns < 6) {
        fields.filming_date = null;
        fields.filming_date_confirmed = false;
      }
      // Step 7 (Publication) + post-livraison vidéo
      if (ns < 7) {
        fields.publication_date = null;
        fields.publication_date_confirmed = false;
        fields.publication_deadline = null;
        fields.video_validated_at = null;
        fields.video_review_comment = null;
        fields.video_changes_requested = false;
      }
      // Step 7 ou avant (pré-livraison vidéo)
      if (ns < 7) {
        fields.video_url = null;
        fields.video_thumbnail_url = null;
        fields.delivered_at = null;
        fields.delivery_notes = null;
        // On ne touche PAS les rows de la table videos (statut 'delivered'/'draft'
        // CHECK contraint, pas d'archive). Le portail short-circuite via le test
        // earlyOnboarding (status='onboarding'/'onboarding_call') donc les vidéos
        // ne s'affichent pas pour le client. Si l'admin re-promote plus tard,
        // les vidéos d'origine sont toujours en DB.
      }
      // Status revient à un statut early-onboarding
      if (ns < 5) fields.status = 'onboarding';
      else if (ns < 6) fields.status = 'script_writing';
    }

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
        pushNotification(id, 'video_delivered', 'Votre vidéo est prête 🎬', 'Découvrez-la et validez-la dans votre espace.');
        // Auto-bump status to video_review so the client sees the validation flow.
        // Don't override an explicit status update (e.g. admin set published manually).
        if (!fields.status && prev.status !== 'video_review' && prev.status !== 'publication_pending' && prev.status !== 'published') {
          await supaFetch(`clients?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'video_review' }),
          }, true);
        }
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

// DELETE /api/clients
//   body : { id, hard?: boolean }
//   - hard=false (défaut) : SOFT delete → archived_at = now()
//     L'opportunité GHL liée et l'historique commercial restent intacts —
//     le client disparaît juste des vues onboarding / liste clients.
//   - hard=true : suppression définitive (hard delete) — usage rare, audit only.
export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id, hard } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    if (hard) {
      const r = await supaFetch(`clients?id=eq.${id}`, { method: 'DELETE' }, true);
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      return NextResponse.json({ success: true, hard: true });
    }

    // Soft delete : marque archived_at + délie l'opportunité GHL pour qu'elle
    // ne reste pas pointée sur un client invisible (mais reste dans gh_opportunities)
    const r = await supaFetch(`clients?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json({ success: true, archived: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
