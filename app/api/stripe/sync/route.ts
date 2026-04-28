import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { findOrCreateClientByEmail } from '@/lib/client-resolver';
import { markProspectContracted } from '@/lib/mark-contracted';

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
  let createdClients = 0;
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
      if (!email) {
        unmatched++;
        if (issues.length < 10) issues.push(`Charge ${ch.id} : pas d'email sur la transaction Stripe`);
        continue;
      }

      // Resolve : (1) clients.email, (2) gh_opportunities.contact_email,
      // (3) fallback billing Stripe (nom + tel) si pas de GHL → on crée
      // quand même le client pour ne pas perdre le paiement.
      const billingName = ch.billing_details?.name || null;
      const billingPhone = ch.billing_details?.phone || null;
      const resolved = await findOrCreateClientByEmail(email, {
        contact_name: billingName,
        phone: billingPhone,
      });
      if (!resolved) {
        unmatched++;
        if (issues.length < 10) issues.push(`Charge ${ch.id} : email ${email} introuvable (pas de nom dans Stripe billing pour fallback)`);
        continue;
      }
      if (resolved.created) createdClients++;

      // Re-récupère le paid_at pour décider si on bumpe
      const paidAtR = await supaFetch(
        `clients?id=eq.${encodeURIComponent(resolved.clientId)}&select=paid_at&limit=1`,
        {}, true,
      );
      const client = {
        id: resolved.clientId,
        business_name: resolved.businessName,
        paid_at: paidAtR.ok ? (await paidAtR.json())[0]?.paid_at || null : null,
      };

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

      // Bascule l'opportunité GHL + appointments en "Contracté"
      await markProspectContracted(client.id, email);

      imported++;
    }
  } catch (e: unknown) {
    return NextResponse.json({
      error: 'Erreur Stripe : ' + (e as Error).message,
      partial: { imported, skipped, unmatched, issues },
    }, { status: 500 });
  }

  const created = createdClients > 0 ? `, ${createdClients} client${createdClients > 1 ? 's' : ''} créé${createdClients > 1 ? 's' : ''} depuis GHL` : '';
  return NextResponse.json({
    days,
    imported,
    skipped,
    unmatched,
    createdClients,
    issues,
    message: `${imported} paiement${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}, ${skipped} déjà présent${skipped > 1 ? 's' : ''}${created}, ${unmatched} sans correspondance.`,
  });
}
