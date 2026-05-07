import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { requireAuth, hashPassword, verifyPassword } from '@/lib/auth';
import { createEmbeddedCheckoutSession, findPaidSessionForClient, getPaymentReceipt } from '@/lib/stripe';
import { markProspectContracted } from '@/lib/mark-contracted';
import { listCalendarEvents } from '@/lib/ghl-opportunities';
import { findGhlContactByEmailOrPhone } from '@/lib/ghl';
import { notifyClientStatusChange } from '@/lib/slack';
import { trackFunnelServer } from '@/lib/funnel';
import { sendPushToAll } from '@/lib/push';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (token) {
    try {
      // Accept either onboarding_token or portal_token — le portail veut pouvoir
      // appeler les actions onboarding sans avoir à connaître les deux jetons.
      const r = await supaFetch(`clients?or=(onboarding_token.eq.${token},portal_token.eq.${token})&select=id,business_name,contact_name,email,phone,onboarding_step,portal_token,contract_signature_link,contract_signed_at,paid_at,onboarding_call_booked,onboarding_call_date,filming_date,filming_date_confirmed,publication_date,publication_date_confirmed,status,scripts(id,status)`, {}, true);
      if (!r.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const data = await r.json();
      if (!data.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      return NextResponse.json(data[0]);
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const r = await supaFetch('clients?onboarding_step=not.is.null&select=id,business_name,contact_name,onboarding_step,email,created_at&order=created_at.desc', {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const body = await req.json();
  const action = body.action;

  // Step 1: Client creates account (no auth needed, it's the first step)
  if (action === 'create_account') {
    try {
      const { business_name, contact_name, email, phone, password } = body;
      if (!business_name || !contact_name || !email || !password) {
        return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 });
      }
      if (password.length < 6) return NextResponse.json({ error: 'Mot de passe : 6 caractères minimum' }, { status: 400 });

      const ghlContactId = await findGhlContactByEmailOrPhone(email, phone);
      if (!ghlContactId) {
        return NextResponse.json({ error: 'Aucun prospect trouvé avec cet email ou téléphone. Contactez BourbonMédia pour commencer.' }, { status: 403 });
      }

      const onboardingToken = crypto.randomBytes(24).toString('hex');
      const portalToken = crypto.randomBytes(24).toString('hex');

      const r = await supaFetch('clients', {
        method: 'POST',
        body: JSON.stringify({
          business_name, contact_name, email, phone,
          password_hash: hashPassword(password),
          onboarding_token: onboardingToken,
          portal_token: portalToken,
          onboarding_step: 2,
          status: 'onboarding',
          ghl_contact_id: ghlContactId,
        }),
      }, true);

      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();

      notifyClientStatusChange(business_name, '—', 'Compte créé (onboarding)');
      void sendPushToAll({
        title: '📝 Nouveau signup',
        body: `${business_name} (${contact_name}) vient de créer son compte onboarding.`,
        url: data?.[0]?.id ? `/dashboard/clients/${data[0].id}?tab=journey` : '/dashboard',
        tag: data?.[0]?.id ? `signup-${data[0].id}` : 'signup',
      });

      return NextResponse.json({ token: onboardingToken, portalToken, client: data[0] }, { status: 201 });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Login: client resumes onboarding with email + password
  if (action === 'login') {
    try {
      const { email, password } = body;
      if (!email || !password) return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 });
      const r = await supaFetch(`clients?email=eq.${encodeURIComponent(email)}&select=id,onboarding_token,password_hash`, {}, true);
      if (!r.ok) return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
      const results = await r.json();
      if (!results.length) return NextResponse.json({ error: 'Aucun compte trouvé avec cet email' }, { status: 404 });
      const found = results[0];
      const { ok, needsUpgrade } = verifyPassword(password, found.password_hash || '');
      if (!ok) {
        return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });
      }
      // Upgrade transparent du hash legacy → scrypt sur les comptes client
      // historiques. Best-effort, non-bloquant.
      if (needsUpgrade) {
        try {
          await supaFetch(`clients?id=eq.${found.id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ password_hash: hashPassword(password) }),
          }, true);
        } catch { /* tolerate */ }
      }
      return NextResponse.json({ token: found.onboarding_token });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // All other actions require a valid onboarding OR portal token. On accepte
  // les deux pour que /portal puisse driver le funnel sans connaître l'onboarding_token.
  if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 400 });

  const cr = await supaFetch(`clients?or=(onboarding_token.eq.${token},portal_token.eq.${token})&select=*`, {}, true);
  if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  const clients = await cr.json();
  if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  const client = clients[0];

  // (init_contract retiré : action plus appelée depuis le strip du funnel
  // /onboarding inline. Le portail utilise désormais directement
  // NEXT_PUBLIC_GHL_CONTRACT_URL en iframe, sans passer par GHL Documents.)

  // Step 2: Client confirms contract signed
  if (action === 'check_contract') {
    try {
      await supaFetch(`clients?id=eq.${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ contract_signed_at: new Date().toISOString(), onboarding_step: 3 }),
      }, true);
      notifyClientStatusChange(client.business_name, 'Étape 2', 'Contrat signé');
      void trackFunnelServer({ event: 'contract_signed', source: 'portal', clientId: client.id });
      void sendPushToAll({
        title: '✍️ Contrat signé',
        body: `${client.business_name} vient de signer le contrat.`,
        url: `/dashboard/clients/${client.id}?tab=journey`,
        tag: `contract-${client.id}`,
      });
      return NextResponse.json({ signed: true });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Step 3: Create embedded Stripe checkout
  if (action === 'create_payment') {
    try {
      const amount = body.amount || 50000; // 500€ HT in cents
      const baseUrl = req.nextUrl.origin;
      // Le caller indique où revenir après paiement (/onboarding pour le funnel
      // historique, /portal depuis la migration). Liste blanche pour éviter
      // qu'un attaquant force une redirection arbitraire via le clientSecret.
      const requestedPath = typeof body.returnPath === 'string' ? body.returnPath : '/onboarding';
      const returnPath = ['/portal', '/onboarding'].includes(requestedPath) ? requestedPath : '/onboarding';
      const clientSecret = await createEmbeddedCheckoutSession({
        clientId: client.id,
        clientEmail: client.email,
        clientName: client.business_name,
        amount,
        description: 'Production vidéo BourbonMédia',
        returnUrl: `${baseUrl}${returnPath}?token=${token}&payment=success`,
        productId: process.env.STRIPE_PRODUCT_ID || undefined,
      });
      if (!clientSecret) return NextResponse.json({ error: 'Erreur Stripe' }, { status: 500 });
      return NextResponse.json({ clientSecret });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Step 3 (fallback) : vérifie côté Stripe que le client a bien payé,
  // appelé en boucle par le portail après redirect ?payment=success quand
  // le webhook /api/webhooks/stripe ne tombe pas (config manquante côté
  // Stripe Dashboard, ou retry en cours). Idempotent : si paid_at déjà
  // posé, sort vite. Sinon, cherche une session Stripe payée matchant
  // metadata.client_id et réplique les side effects du webhook.
  if (action === 'verify_payment') {
    try {
      if (client.paid_at) {
        return NextResponse.json({ paid: true, source: 'cached' });
      }
      const session = await findPaidSessionForClient(client.id);
      if (!session) {
        return NextResponse.json({ paid: false });
      }
      const receipt = session.paymentIntentId
        ? await getPaymentReceipt(session.paymentIntentId)
        : null;
      // PATCH client : paid_at + bump step + amount + ids Stripe (idem webhook)
      await supaFetch(`clients?id=eq.${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          stripe_session_id: session.sessionId,
          stripe_payment_id: session.paymentIntentId,
          paid_at: new Date().toISOString(),
          payment_amount: session.amountTotal,
          onboarding_step: 4,
        }),
      }, true);
      // Insert dans payments si pas déjà présent (matche sur session_id)
      const dup = await supaFetch(
        `payments?stripe_session_id=eq.${encodeURIComponent(session.sessionId)}&select=id&limit=1`,
        {}, true,
      );
      const dupArr = dup.ok ? await dup.json() : [];
      if (!dupArr.length) {
        await supaFetch('payments', {
          method: 'POST',
          body: JSON.stringify({
            client_id: client.id,
            stripe_session_id: session.sessionId,
            stripe_payment_intent: session.paymentIntentId,
            amount: session.amountTotal,
            currency: 'eur',
            status: 'completed',
            description: 'Production vidéo BourbonMédia',
            receipt_url: receipt?.receipt_url || null,
            invoice_pdf_url: receipt?.invoice_pdf || null,
            invoice_number: receipt?.invoice_number || null,
          }),
        }, true);
      }
      // Notif portail + Slack + push admin (best-effort, ne bloque pas la réponse)
      void supaFetch('client_notifications', {
        method: 'POST',
        body: JSON.stringify({
          client_id: client.id,
          type: 'payment_received',
          title: 'Paiement reçu ✓',
          body: `Merci ! Votre paiement de ${(session.amountTotal / 100).toLocaleString('fr-FR')} € a bien été enregistré.`,
        }),
      }, true);
      notifyClientStatusChange(client.business_name, 'Étape 3', 'Paiement reçu (vérif portail)');
      void sendPushToAll({
        title: '💸 Paiement reçu',
        body: `${client.business_name} — ${(session.amountTotal / 100).toLocaleString('fr-FR')} € (vérif portail)`,
        url: `/dashboard/clients/${client.id}?tab=payments`,
        tag: `payment-${session.sessionId}`,
      });
      void trackFunnelServer({
        event: 'payment_completed',
        source: 'portal',
        clientId: client.id,
        metadata: { amount_cents: session.amountTotal, via: 'verify_payment' },
      });
      void markProspectContracted(client.id, client.email || null);
      return NextResponse.json({ paid: true, source: 'verified' });
    } catch (e: unknown) {
      return NextResponse.json({ paid: false, error: (e as Error).message }, { status: 200 });
    }
  }

  // Step 4 (fallback) : vérifie côté GHL que le client a bien réservé un
  // créneau onboarding, appelé en boucle par le portail après que l'iframe
  // a été chargée (l'embed ne navigue pas, donc le détecteur "justBooked"
  // par referrer ne se déclenche jamais et le webhook GHL peut ne pas être
  // configuré). Idempotent : sort vite si déjà flagué.
  if (action === 'verify_call_booked') {
    try {
      if (client.onboarding_call_booked) {
        return NextResponse.json({ booked: true, source: 'cached' });
      }
      const onboardingCalendarId = process.env.GHL_ONBOARDING_CALENDAR_ID || '';
      if (!onboardingCalendarId || !client.ghl_contact_id) {
        return NextResponse.json({ booked: false, reason: 'no_calendar_or_contact' });
      }
      // Window : 14j en arrière (au cas où le user prend un créneau passé en
      // test) et 60j en avant (couvre la plupart des bookings onboarding).
      const fromIso = new Date(Date.now() - 14 * 86400000).toISOString();
      const toIso = new Date(Date.now() + 60 * 86400000).toISOString();
      const { events } = await listCalendarEvents(onboardingCalendarId, fromIso, toIso);
      const match = events.find(e => e.contactId === client.ghl_contact_id
        && (!e.appointmentStatus || !/cancel/i.test(e.appointmentStatus)));
      if (!match) {
        return NextResponse.json({ booked: false });
      }
      await supaFetch(`clients?id=eq.${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          onboarding_call_booked: true,
          onboarding_call_date: match.startTime,
          onboarding_step: 5,
          status: 'onboarding_call',
        }),
      }, true);
      notifyClientStatusChange(client.business_name, 'Étape 4', 'Appel onboarding réservé (vérif portail)');
      void trackFunnelServer({
        event: 'call_booked',
        source: 'portal',
        clientId: client.id,
        metadata: { via: 'verify_call_booked', appointment_id: match.id },
      });
      void sendPushToAll({
        title: '📞 Appel onboarding réservé',
        body: `${client.business_name} a réservé son appel onboarding (vérif portail).`,
        url: `/dashboard/clients/${client.id}?tab=journey`,
        tag: `call-${client.id}`,
      });
      return NextResponse.json({ booked: true, source: 'verified', date: match.startTime });
    } catch (e: unknown) {
      return NextResponse.json({ booked: false, error: (e as Error).message }, { status: 200 });
    }
  }

  // Step 4: Mark onboarding call as booked
  if (action === 'call_booked') {
    await supaFetch(`clients?id=eq.${client.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        onboarding_call_booked: true,
        onboarding_call_date: body.date || null,
        onboarding_step: 5,
        // Faire avancer la carte sur le kanban admin "Onboarding" → "Appel onboarding".
        // Le funnel garde son écran "Script en préparation" côté client (step 5),
        // mais l'équipe voit que l'appel est planifié.
        status: 'onboarding_call',
      }),
    }, true);
    notifyClientStatusChange(client.business_name, 'Étape 4', 'Appel onboarding réservé');
    void trackFunnelServer({ event: 'call_booked', source: 'portal', clientId: client.id });
    void sendPushToAll({
      title: '📞 Appel onboarding réservé',
      body: `${client.business_name} a réservé son appel onboarding${body.date ? ` (${new Date(body.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}.`,
      url: `/dashboard/clients/${client.id}?tab=journey`,
      tag: `call-${client.id}`,
    });
    return NextResponse.json({ success: true });
  }

  // (confirm_filming et confirm_publication retirés : ces actions étaient
  // appelées depuis les steps 6/7 du funnel /onboarding inline qui a été
  // strippé. Le portail utilise désormais /api/scripts confirm_filming_booked
  // et confirm_publication_date qui font le même travail avec en plus la
  // validation jour-de-semaine + détection de conflits sur la deadline.)

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
