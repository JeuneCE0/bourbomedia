import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, getPaymentReceipt } from '@/lib/stripe';
import { supaFetch } from '@/lib/supabase';
import { notifyClientStatusChange } from '@/lib/slack';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') || '';

  const event = await verifyWebhookSignature(body, sig);
  if (!event) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });

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

    const cr = await supaFetch(`clients?id=eq.${clientId}&select=business_name`, {}, true);
    if (cr.ok) {
      const clients = await cr.json();
      if (clients.length) {
        notifyClientStatusChange(clients[0].business_name, 'Étape 3', 'Paiement reçu');
      }
    }
  }

  return NextResponse.json({ received: true });
}
