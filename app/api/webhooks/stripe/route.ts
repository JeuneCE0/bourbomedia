import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, getPaymentReceipt } from '@/lib/stripe';
import { supaFetch } from '@/lib/supabase';
import { notifyClientStatusChange } from '@/lib/slack';
import { sendPushToAll } from '@/lib/push';
import { resolveMapping, prospectStatusToStageId, updateOpportunityStage } from '@/lib/ghl-opportunities';

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

    // Auto-flip the matching gh_appointment(s) to "Contracté" — closing won.
    // Match by client_id first, fall back to email.
    try {
      const matchPath = clientEmail
        ? `gh_appointments?or=(client_id.eq.${clientId},contact_email.ilike.${encodeURIComponent(clientEmail.toLowerCase().trim())})`
        : `gh_appointments?client_id=eq.${clientId}`;
      const lookup = await supaFetch(`${matchPath}&prospect_status=in.(awaiting_signature,reflection,follow_up,ghosting)&select=id,opportunity_id,prospect_status`, {}, true);
      if (lookup.ok) {
        const appts = await lookup.json();
        if (appts.length) {
          const { mapping } = await resolveMapping();
          const target = prospectStatusToStageId(mapping, 'contracted');
          for (const appt of appts) {
            // Mark as contracted + auto-document so it leaves the "to do" lists
            await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(appt.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                prospect_status: 'contracted',
                client_id: clientId,
                notes_completed_at: new Date().toISOString(),
                notes: '✅ Auto: contrat finalisé + paiement Stripe reçu',
                ghl_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }),
            }, true);
            // Push the new stage to GHL pipeline (best effort)
            if (appt.opportunity_id && target.pipelineId && target.stageId) {
              await updateOpportunityStage(appt.opportunity_id, target.pipelineId, target.stageId).catch(() => null);
            }
          }
        }
      }
    } catch { /* tolerate */ }
  }

  return NextResponse.json({ received: true });
}
