import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// POST /api/stripe/sync?days=90
//   Backfille la table payments depuis Stripe pour les charges des N derniers
//   jours (par défaut 90). Utile quand le webhook n'a pas tourné, ou pour les
//   factures Stripe émises avant l'ajout des handlers invoice.paid /
//   payment_intent.succeeded.
//
//   Pour chaque charge réussie :
//     1. Cherche un client local par email (clients.email)
//     2. Skip si une ligne payments existe déjà (matching stripe_payment_intent
//        ou stripe_session_id)
//     3. Insère un row payments + bumpe clients.paid_at si null
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return NextResponse.json({ error: 'STRIPE_SECRET_KEY manquant' }, { status: 503 });

  const days = Math.max(1, Math.min(365, parseInt(req.nextUrl.searchParams.get('days') || '90', 10)));
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  const issues: string[] = [];

  try {
    // Pull successful charges via auto-pagination
    for await (const ch of stripe.charges.list({ created: { gte: since }, limit: 100 })) {
      if (ch.status !== 'succeeded' || ch.refunded) { skipped++; continue; }
      const piId = typeof ch.payment_intent === 'string' ? ch.payment_intent : (ch.payment_intent?.id || null);
      const stripeId = piId || ch.id;

      // Skip si déjà importé (par PI ou par session)
      const existsR = await supaFetch(
        `payments?or=(stripe_payment_intent.eq.${encodeURIComponent(stripeId)},stripe_session_id.eq.${encodeURIComponent(stripeId)})&select=id&limit=1`,
        {}, true,
      );
      if (existsR.ok) {
        const arr = await existsR.json();
        if (arr.length > 0) { skipped++; continue; }
      }

      const email = ch.billing_details?.email || ch.receipt_email;
      if (!email) { unmatched++; continue; }

      const clientR = await supaFetch(
        `clients?email=ilike.${encodeURIComponent(email.toLowerCase().trim())}&select=id,business_name,paid_at&limit=1`,
        {}, true,
      );
      if (!clientR.ok) { unmatched++; continue; }
      const clients = await clientR.json();
      if (clients.length === 0) {
        unmatched++;
        if (issues.length < 10) issues.push(`Charge ${ch.id} : aucun client avec email ${email}`);
        continue;
      }
      const client = clients[0];

      // Récupère le receipt + numéro de facture si possible
      // (charge.invoice peut être absent du type Stripe selon la version SDK,
      // on cast pour rester tolérant)
      let invoicePdf: string | null = null;
      let invoiceNumber: string | null = null;
      const chWithInvoice = ch as Stripe.Charge & { invoice?: string | { id: string } | null };
      if (chWithInvoice.invoice) {
        try {
          const invId = typeof chWithInvoice.invoice === 'string' ? chWithInvoice.invoice : chWithInvoice.invoice.id;
          if (invId) {
            const inv = await stripe.invoices.retrieve(invId);
            invoicePdf = inv.invoice_pdf || null;
            invoiceNumber = inv.number || null;
          }
        } catch { /* tolerate */ }
      }

      await supaFetch('payments', {
        method: 'POST',
        body: JSON.stringify({
          client_id: client.id,
          stripe_session_id: null,
          stripe_payment_intent: piId,
          amount: ch.amount,
          currency: ch.currency || 'eur',
          status: 'completed',
          description: ch.description || (invoiceNumber ? `Facture Stripe ${invoiceNumber}` : 'Paiement Stripe'),
          receipt_url: ch.receipt_url || null,
          invoice_pdf_url: invoicePdf,
          invoice_number: invoiceNumber,
          created_at: new Date(ch.created * 1000).toISOString(),
        }),
      }, true);

      // Bumpe clients.paid_at uniquement si null (pour cumuler les paiements
      // multiples sans écraser la première date)
      if (!client.paid_at) {
        await supaFetch(`clients?id=eq.${client.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            paid_at: new Date(ch.created * 1000).toISOString(),
            payment_amount: ch.amount,
          }),
        }, true).catch(() => null);
      }

      imported++;
    }
  } catch (e: unknown) {
    return NextResponse.json({
      error: 'Erreur Stripe : ' + (e as Error).message,
      partial: { imported, skipped, unmatched, issues },
    }, { status: 500 });
  }

  return NextResponse.json({
    days,
    imported,
    skipped,
    unmatched,
    issues,
    message: `${imported} paiement${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}, ${skipped} déjà présent${skipped > 1 ? 's' : ''}, ${unmatched} sans client correspondant.`,
  });
}
