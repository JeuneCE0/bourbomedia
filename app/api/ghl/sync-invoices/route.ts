import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { listGhlInvoices } from '@/lib/ghl-invoices';
import { findOrCreateClientByEmail } from '@/lib/client-resolver';
import { markProspectContracted } from '@/lib/mark-contracted';
import { ghlRequest } from '@/lib/ghl';

// POST /api/ghl/sync-invoices?days=180
//   Importe les factures GHL en statut 'paid' dans la table payments locale.
//   Match le client par email (auto-création depuis le contact GHL si absent).
//   Dédup via stripe_session_id = 'ghl_inv_<id>' (le champ existe déjà, on
//   l'utilise comme clé d'idempotence pour les sources non-Stripe).
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  if (!process.env.GHL_API_KEY) return NextResponse.json({ error: 'GHL_API_KEY manquant' }, { status: 503 });

  const days = Math.max(1, Math.min(730, parseInt(req.nextUrl.searchParams.get('days') || '180', 10)));

  let skipped = 0;
  let unmatched = 0;
  let createdClients = 0;
  const issues: string[] = [];

  // Fetch en parallèle les factures payées ET non payées (sent / partially_paid)
  // pour distinguer 'Encaissé' vs 'En attente d'encaissement'.
  let invoices;
  try {
    const [paidInvoices, sentInvoices, partialInvoices] = await Promise.all([
      listGhlInvoices({ status: 'paid', daysBack: days, limit: 500 }).catch(() => []),
      listGhlInvoices({ status: 'sent', daysBack: days, limit: 500 }).catch(() => []),
      listGhlInvoices({ status: 'partially_paid', daysBack: days, limit: 500 }).catch(() => []),
    ]);
    invoices = [...paidInvoices, ...sentInvoices, ...partialInvoices];
    console.log(`[ghl-sync-invoices] Retrieved ${paidInvoices.length} paid + ${sentInvoices.length} sent + ${partialInvoices.length} partial (daysBack=${days})`);
  } catch (e: unknown) {
    console.error('[ghl-sync-invoices] GHL API error:', e);
    return NextResponse.json({
      error: 'GHL fetch failed: ' + (e as Error).message,
      hint: 'Vérifie GHL_API_KEY (scope invoices.readonly requis) et GHL_LOCATION_ID',
    }, { status: 500 });
  }

  if (invoices.length === 0) {
    return NextResponse.json({
      days,
      imported: 0, skipped: 0, unmatched: 0, createdClients: 0,
      total_seen: 0,
      issues: [`Aucune facture retournée par GHL sur les ${days} derniers jours. Vérifie : (1) qu'il y a bien des factures dans GHL · Payments · Invoices, (2) que la clé API a le scope 'invoices.readonly', (3) que GHL_LOCATION_ID pointe vers la bonne sous-location.`],
      message: `Aucune facture trouvée sur les ${days} derniers jours.`,
    });
  }

  let importedPaid = 0;
  let importedPending = 0;
  let updatedToPaid = 0;

  for (const inv of invoices) {
    if (!inv.id) { skipped++; continue; }

    const dedupeKey = `ghl_inv_${inv.id}`;
    const isPaid = inv.status === 'paid' && inv.amountPaid > 0;
    const isPartialOrSent = inv.status === 'sent' || inv.status === 'partially_paid';

    // Pour les factures pending, on prend le total (pas amountPaid qui peut être 0)
    const effectiveAmount = isPaid ? inv.amountPaid : inv.total;
    if (effectiveAmount <= 0) { skipped++; continue; }

    // Check existing row + update si statut a changé
    const existsR = await supaFetch(
      `payments?stripe_session_id=eq.${encodeURIComponent(dedupeKey)}&select=id,status,amount&limit=1`,
      {}, true,
    );
    if (existsR.ok) {
      const arr = await existsR.json();
      if (arr.length > 0) {
        const existing = arr[0];
        // Si on a maintenant 'paid' alors qu'avant c'était 'pending' → upgrade
        if (isPaid && existing.status !== 'completed') {
          const paidAtIso = inv.paidAt ? new Date(inv.paidAt).toISOString() : new Date().toISOString();
          await supaFetch(`payments?id=eq.${encodeURIComponent(existing.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'completed',
              amount: Math.round(inv.amountPaid * 100),
              created_at: paidAtIso,
            }),
          }, true).catch(() => null);
          updatedToPaid++;
          continue;
        }
        skipped++;
        continue;
      }
    }

    // 1. Email direct sur la facture
    let email = inv.contactDetails.email;

    // 2. Fallback : fetch le contact GHL via son contactId pour récupérer l'email
    if (!email && inv.contactDetails.id) {
      try {
        const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(inv.contactDetails.id)}`);
        const c = data?.contact || data;
        email = c?.email || null;
      } catch { /* tolerate */ }
    }

    if (!email) {
      unmatched++;
      if (issues.length < 10) issues.push(`Facture ${inv.invoiceNumber || inv.id} (${inv.status}) : aucun email (contactId=${inv.contactDetails.id || 'aucun'})`);
      continue;
    }

    const resolved = await findOrCreateClientByEmail(email);
    if (!resolved) {
      unmatched++;
      if (issues.length < 10) issues.push(`Facture ${inv.invoiceNumber || inv.id} (${inv.status}) : email ${email} introuvable (ni clients ni gh_opportunities)`);
      continue;
    }
    if (resolved.created) createdClients++;

    const amountCents = Math.round(effectiveAmount * 100);
    const dateIso = isPaid && inv.paidAt
      ? new Date(inv.paidAt).toISOString()
      : (inv.issueDate ? new Date(inv.issueDate).toISOString() : (inv.createdAt ? new Date(inv.createdAt).toISOString() : new Date().toISOString()));

    // Status normalisé : 'completed' = payé, 'pending' = facture envoyée non payée
    const dbStatus = isPaid ? 'completed' : 'pending';
    const descriptionPrefix = isPaid ? 'Facture GHL' : isPartialOrSent ? 'Facture GHL (en attente)' : 'Facture GHL';

    await supaFetch('payments', {
      method: 'POST',
      body: JSON.stringify({
        client_id: resolved.clientId,
        stripe_session_id: dedupeKey,
        stripe_payment_intent: null,
        amount: amountCents,
        currency: inv.currency.toLowerCase(),
        status: dbStatus,
        description: inv.invoiceNumber ? `${descriptionPrefix} ${inv.invoiceNumber}` : (inv.name || descriptionPrefix),
        receipt_url: null,
        invoice_pdf_url: null,
        invoice_number: inv.invoiceNumber,
        created_at: dateIso,
      }),
    }, true);

    if (isPaid) {
      importedPaid++;
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
              paid_at: dateIso,
              payment_amount: amountCents,
            }),
          }, true).catch(() => null);
        }
      }
      // Bascule l'opportunité GHL + appointments en "Contracté"
      await markProspectContracted(resolved.clientId, email);
    } else {
      importedPending++;
    }
  }

  const imported = importedPaid + importedPending;
  const summaryParts: string[] = [];
  if (importedPaid > 0) summaryParts.push(`${importedPaid} payée${importedPaid > 1 ? 's' : ''}`);
  if (importedPending > 0) summaryParts.push(`${importedPending} en attente`);
  if (updatedToPaid > 0) summaryParts.push(`${updatedToPaid} passée${updatedToPaid > 1 ? 's' : ''} à payée`);
  if (createdClients > 0) summaryParts.push(`${createdClients} client${createdClients > 1 ? 's' : ''} créé${createdClients > 1 ? 's' : ''}`);

  return NextResponse.json({
    days,
    imported,
    importedPaid,
    importedPending,
    updatedToPaid,
    skipped,
    unmatched,
    createdClients,
    total_seen: invoices.length,
    issues,
    message: `${summaryParts.join(', ') || 'Aucune nouveauté'}, ${skipped} déjà présente${skipped > 1 ? 's' : ''}, ${unmatched} sans correspondance.`,
  });
}
