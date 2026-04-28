import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, getPaymentReceipt } from '@/lib/stripe';
import { supaFetch } from '@/lib/supabase';
import { notifyClientStatusChange } from '@/lib/slack';
import { sendPushToAll } from '@/lib/push';
import { findOrCreateClientByEmail } from '@/lib/client-resolver';
import { markProspectContracted } from '@/lib/mark-contracted';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') || '';

  const event = await verifyWebhookSignature(body, sig);
  if (!event) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });

  // Map "extra" Stripe events vers checkout.session.completed-like payload :
  //  - invoice.paid          → factures Stripe (Invoicing / abonnements)
  //  - payment_intent.succeeded → paiements directs (Payment Links sans Checkout,
  //                              Stripe Pay, charges API)
  // On retrouve le client par metadata.client_id si défini ; sinon par email.
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
    return await handleInvoicePaid(event);
  }
  if (event.type === 'payment_intent.succeeded') {
    return await handlePaymentIntentSucceeded(event);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      id: string;
      payment_intent: string | null;
      amount_total: number | null;
      metadata: { client_id?: string };
    };

    const clientId = session.metadata?.client_id;
    if (!clientId) return NextResponse.json({ error: 'No client_id' }, { status: 400 });

    await supaFetch(`clients?id=eq.${clientId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        stripe_session_id: session.id,
        stripe_payment_id: session.payment_intent,
        paid_at: new Date().toISOString(),
        payment_amount: session.amount_total,
        onboarding_step: 4,
      }),
    }, true);

    // Fetch the receipt + invoice URLs from Stripe
    const receipt = session.payment_intent ? await getPaymentReceipt(session.payment_intent) : null;

    await supaFetch('payments', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent,
        amount: session.amount_total || 0,
        currency: 'eur',
        status: 'completed',
        description: 'Production vidéo BourbonMédia',
        receipt_url: receipt?.receipt_url || null,
        invoice_pdf_url: receipt?.invoice_pdf || null,
        invoice_number: receipt?.invoice_number || null,
      }),
    }, true);

    // Push portal notification
    try {
      await supaFetch('client_notifications', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          type: 'payment_received',
          title: 'Paiement reçu ✓',
          body: `Merci ! Votre paiement de ${((session.amount_total || 0) / 100).toLocaleString('fr-FR')} € a bien été enregistré.`,
        }),
      }, true);
    } catch { /* */ }

    const cr = await supaFetch(`clients?id=eq.${clientId}&select=business_name,email`, {}, true);
    let clientEmail: string | null = null;
    if (cr.ok) {
      const clients = await cr.json();
      if (clients.length) {
        notifyClientStatusChange(clients[0].business_name, 'Étape 3', 'Paiement reçu');
        sendPushToAll({
          title: '💸 Paiement reçu',
          body: `${clients[0].business_name} — ${((session.amount_total || 0) / 100).toLocaleString('fr-FR')} €`,
          url: `/dashboard/clients/${clientId}?tab=payments`,
          tag: `payment-${session.id}`,
        }).catch(() => null);
        clientEmail = clients[0].email || null;
      }
    }

    // Bascule l'opportunité + les appointments liés en "Contracté"
    await markProspectContracted(clientId, clientEmail);
  }

  return NextResponse.json({ received: true });
}

// ── Helpers for non-Checkout payment events ───────────────────────────────

interface StripeEventLike {
  data: { object: unknown };
}

async function findClientByEmail(
  email: string | null | undefined,
  fallback?: { contact_name?: string | null; phone?: string | null; company_name?: string | null },
): Promise<{ id: string; business_name: string; email: string } | null> {
  // Délègue au resolver partagé (clients.email puis gh_opportunities, puis
  // fallback billing si fourni — pour ne pas perdre les Stripe hors GHL).
  const r = await findOrCreateClientByEmail(email, fallback);
  if (!r) return null;
  return { id: r.clientId, business_name: r.businessName, email: r.email };
}

async function paymentAlreadyImported(stripeId: string): Promise<boolean> {
  const r = await supaFetch(
    `payments?or=(stripe_payment_intent.eq.${encodeURIComponent(stripeId)},stripe_session_id.eq.${encodeURIComponent(stripeId)})&select=id&limit=1`,
    {}, true,
  );
  if (!r.ok) return false;
  const arr = await r.json();
  return arr.length > 0;
}

async function recordPayment(opts: {
  clientId: string;
  amountCents: number;
  stripePaymentIntentId?: string | null;
  stripeSessionId?: string | null;
  description: string;
  receiptUrl?: string | null;
  invoicePdfUrl?: string | null;
  invoiceNumber?: string | null;
  businessName: string;
  email?: string | null;
}) {
  await supaFetch('payments', {
    method: 'POST',
    body: JSON.stringify({
      client_id: opts.clientId,
      stripe_session_id: opts.stripeSessionId || null,
      stripe_payment_intent: opts.stripePaymentIntentId || null,
      amount: opts.amountCents,
      currency: 'eur',
      status: 'completed',
      description: opts.description,
      receipt_url: opts.receiptUrl || null,
      invoice_pdf_url: opts.invoicePdfUrl || null,
      invoice_number: opts.invoiceNumber || null,
    }),
  }, true);

  // Si le client n'a pas encore paid_at, l'initialiser pour rester rétro-compat
  // avec l'ancien calcul (clients.payment_amount).
  await supaFetch(`clients?id=eq.${opts.clientId}&paid_at=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({
      paid_at: new Date().toISOString(),
      payment_amount: opts.amountCents,
    }),
  }, true).catch(() => null);

  // Auto-flip GHL : opportunité + appointments → "Contracté"
  await markProspectContracted(opts.clientId, opts.email || null);

  // Slack + push
  notifyClientStatusChange(opts.businessName, 'Paiement', `${(opts.amountCents / 100).toLocaleString('fr-FR')} €`).catch(() => null);
  sendPushToAll({
    title: '💸 Paiement reçu',
    body: `${opts.businessName} — ${(opts.amountCents / 100).toLocaleString('fr-FR')} €`,
    url: `/dashboard/clients/${opts.clientId}?tab=payments`,
    tag: `payment-${opts.stripePaymentIntentId || opts.stripeSessionId}`,
  }).catch(() => null);
}

async function handleInvoicePaid(event: StripeEventLike): Promise<NextResponse> {
  const inv = event.data.object as {
    id: string;
    payment_intent: string | null;
    amount_paid: number | null;
    customer_email: string | null;
    customer_name: string | null;
    number: string | null;
    invoice_pdf: string | null;
    hosted_invoice_url: string | null;
    metadata: { client_id?: string };
  };

  const stripeId = inv.payment_intent || inv.id;
  if (await paymentAlreadyImported(stripeId)) {
    return NextResponse.json({ received: true, skipped: 'already imported' });
  }

  // Trouve le client par metadata.client_id (si défini), sinon par email avec
  // fallback billing (nom client Stripe) pour ne pas perdre les paiements.
  let clientId: string | null = inv.metadata?.client_id || null;
  let businessName = inv.customer_name || 'Client';
  if (!clientId) {
    const found = await findClientByEmail(inv.customer_email, {
      contact_name: inv.customer_name,
    });
    if (found) { clientId = found.id; businessName = found.business_name; }
  } else {
    const cR = await supaFetch(`clients?id=eq.${clientId}&select=business_name`, {}, true);
    if (cR.ok) { const a = await cR.json(); if (a[0]) businessName = a[0].business_name; }
  }

  if (!clientId) {
    return NextResponse.json({
      received: true, skipped: 'no matching client',
      hint: `email=${inv.customer_email}`,
    });
  }

  await recordPayment({
    clientId,
    amountCents: inv.amount_paid || 0,
    stripePaymentIntentId: inv.payment_intent,
    description: inv.number ? `Facture Stripe ${inv.number}` : 'Facture Stripe',
    invoicePdfUrl: inv.invoice_pdf,
    invoiceNumber: inv.number,
    receiptUrl: inv.hosted_invoice_url,
    businessName,
    email: inv.customer_email,
  });

  return NextResponse.json({ received: true, imported: true });
}

async function handlePaymentIntentSucceeded(event: StripeEventLike): Promise<NextResponse> {
  const pi = event.data.object as {
    id: string;
    amount: number;
    receipt_email: string | null;
    metadata: { client_id?: string };
    invoice: string | null;
    customer: string | null;
    latest_charge: string | null;
    shipping?: { name?: string; phone?: string } | null;
  };

  // Si lié à une invoice, le handler invoice.paid s'en occupe → skip pour éviter double-comptage
  if (pi.invoice) return NextResponse.json({ received: true, skipped: 'has invoice' });

  if (await paymentAlreadyImported(pi.id)) {
    return NextResponse.json({ received: true, skipped: 'already imported' });
  }

  let clientId: string | null = pi.metadata?.client_id || null;
  let businessName = 'Client';
  if (!clientId) {
    const found = await findClientByEmail(pi.receipt_email, {
      contact_name: pi.shipping?.name || null,
      phone: pi.shipping?.phone || null,
    });
    if (found) { clientId = found.id; businessName = found.business_name; }
  } else {
    const cR = await supaFetch(`clients?id=eq.${clientId}&select=business_name`, {}, true);
    if (cR.ok) { const a = await cR.json(); if (a[0]) businessName = a[0].business_name; }
  }

  if (!clientId) {
    return NextResponse.json({
      received: true, skipped: 'no matching client',
      hint: `email=${pi.receipt_email}`,
    });
  }

  // Récupère receipt_url + invoice_pdf via getPaymentReceipt (best effort)
  const receipt = await getPaymentReceipt(pi.id);

  await recordPayment({
    clientId,
    amountCents: pi.amount,
    stripePaymentIntentId: pi.id,
    description: 'Paiement Stripe',
    receiptUrl: receipt?.receipt_url || null,
    invoicePdfUrl: receipt?.invoice_pdf || null,
    invoiceNumber: receipt?.invoice_number || null,
    businessName,
    email: pi.receipt_email,
  });

  return NextResponse.json({ received: true, imported: true });
}
