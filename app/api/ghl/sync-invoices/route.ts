import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { listGhlInvoices } from '@/lib/ghl-invoices';
import { findOrCreateClientByEmail } from '@/lib/client-resolver';
import { markProspectContracted } from '@/lib/mark-contracted';

// POST /api/ghl/sync-invoices?days=180
//   Importe les factures GHL en statut 'paid' dans la table payments locale.
//   Match le client par email (auto-création depuis le contact GHL si absent).
//   Dédup via stripe_session_id = 'ghl_inv_<id>' (le champ existe déjà, on
//   l'utilise comme clé d'idempotence pour les sources non-Stripe).
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  if (!process.env.GHL_API_KEY) return NextResponse.json({ error: 'GHL_API_KEY manquant' }, { status: 503 });

  const days = Math.max(1, Math.min(730, parseInt(req.nextUrl.searchParams.get('days') || '180', 10)));

  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  let createdClients = 0;
  const issues: string[] = [];

  let invoices;
  try {
    invoices = await listGhlInvoices({ status: 'paid', daysBack: days, limit: 500 });
  } catch (e: unknown) {
    return NextResponse.json({ error: 'GHL fetch failed: ' + (e as Error).message }, { status: 500 });
  }

  for (const inv of invoices) {
    if (!inv.id) { skipped++; continue; }
    if (inv.amountPaid <= 0) { skipped++; continue; }

    const dedupeKey = `ghl_inv_${inv.id}`;

    // Skip si déjà importé
    const existsR = await supaFetch(
      `payments?stripe_session_id=eq.${encodeURIComponent(dedupeKey)}&select=id&limit=1`,
      {}, true,
    );
    if (existsR.ok) {
      const arr = await existsR.json();
      if (arr.length > 0) { skipped++; continue; }
    }

    const email = inv.contactDetails.email;
    if (!email) {
      unmatched++;
      if (issues.length < 10) issues.push(`Facture ${inv.invoiceNumber || inv.id} : aucun email sur la fiche contact GHL`);
      continue;
    }

    const resolved = await findOrCreateClientByEmail(email);
    if (!resolved) {
      unmatched++;
      if (issues.length < 10) issues.push(`Facture ${inv.invoiceNumber || inv.id} : email ${email} introuvable`);
      continue;
    }
    if (resolved.created) createdClients++;

    // GHL retourne amountPaid en unités majeures (EUR), pas en cents — on convertit
    const amountCents = Math.round(inv.amountPaid * 100);
    const paidAtIso = inv.paidAt ? new Date(inv.paidAt).toISOString() : (inv.updatedAt ? new Date(inv.updatedAt).toISOString() : new Date().toISOString());

    await supaFetch('payments', {
      method: 'POST',
      body: JSON.stringify({
        client_id: resolved.clientId,
        stripe_session_id: dedupeKey, // clé d'idempotence
        stripe_payment_intent: null,
        amount: amountCents,
        currency: inv.currency.toLowerCase(),
        status: 'completed',
        description: inv.invoiceNumber ? `Facture GHL ${inv.invoiceNumber}` : (inv.name || 'Facture GHL'),
        receipt_url: null,
        invoice_pdf_url: null,
        invoice_number: inv.invoiceNumber,
        created_at: paidAtIso,
      }),
    }, true);

    // Bumpe clients.paid_at si null
    const cR = await supaFetch(
      `clients?id=eq.${encodeURIComponent(resolved.clientId)}&select=paid_at&limit=1`,
      {}, true,
    );
    if (cR.ok) {
      const arr = await cR.json();
      if (arr[0] && !arr[0].paid_at) {
        await supaFetch(`clients?id=eq.${encodeURIComponent(resolved.clientId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            paid_at: paidAtIso,
            payment_amount: amountCents,
          }),
        }, true).catch(() => null);
      }
    }

    // Bascule l'opportunité GHL + appointments en "Contracté"
    await markProspectContracted(resolved.clientId, email);

    imported++;
  }

  const created = createdClients > 0 ? `, ${createdClients} client${createdClients > 1 ? 's' : ''} créé${createdClients > 1 ? 's' : ''}` : '';
  return NextResponse.json({
    days,
    imported,
    skipped,
    unmatched,
    createdClients,
    total_seen: invoices.length,
    issues,
    message: `${imported} facture${imported > 1 ? 's' : ''} GHL importée${imported > 1 ? 's' : ''}, ${skipped} déjà présente${skipped > 1 ? 's' : ''}${created}, ${unmatched} sans correspondance.`,
  });
}
