// Resolve or auto-create a Bourbomedia client from an email address.
// Used by Stripe webhooks + sync to link incoming payments even when the client
// only existed as a GHL prospect.
//
// Lookup chain :
//   1. clients.email (case-insensitive)
//   2. gh_opportunities.contact_email → if found, fetch GHL contact + create
//      a local client row, link the opportunity to it, return the new id.
//
// Returns { clientId, businessName, created } or null when no match anywhere.

import crypto from 'crypto';
import { supaFetch } from './supabase';
import { ghlRequest } from './ghl';

export interface ResolvedClient {
  clientId: string;
  businessName: string;
  email: string;
  created: boolean;
}

export async function findOrCreateClientByEmail(rawEmail: string | null | undefined): Promise<ResolvedClient | null> {
  if (!rawEmail) return null;
  const email = rawEmail.toLowerCase().trim();
  if (!email) return null;

  // 1. Existing local client (email match — ilike pour gérer la casse)
  const localR = await supaFetch(
    `clients?email=ilike.${encodeURIComponent(email)}&select=id,business_name,email&limit=1`,
    {}, true,
  );
  if (localR.ok) {
    const arr = await localR.json();
    if (arr[0]) return { clientId: arr[0].id, businessName: arr[0].business_name || 'Client', email: arr[0].email, created: false };
  }

  // 2. GHL opportunity → contact
  const oppR = await supaFetch(
    `gh_opportunities?contact_email=ilike.${encodeURIComponent(email)}&select=id,client_id,ghl_contact_id,name,contact_name,contact_phone,contact_email&limit=1`,
    {}, true,
  );
  if (!oppR.ok) return null;
  const opps = await oppR.json();
  const opp = opps[0];
  if (!opp) return null;

  // 2bis. Si l'opportunité est DÉJÀ liée à un client local (cas où l'email
  // GHL diffère légèrement de l'email local — ex: alias, ancien email, etc.)
  // on réutilise directement ce client. ZÉRO doublon.
  if (opp.client_id) {
    const linkR = await supaFetch(
      `clients?id=eq.${encodeURIComponent(opp.client_id)}&select=id,business_name,email&limit=1`,
      {}, true,
    );
    if (linkR.ok) {
      const arr = await linkR.json();
      if (arr[0]) return { clientId: arr[0].id, businessName: arr[0].business_name || 'Client', email: arr[0].email, created: false };
    }
  }

  // 2ter. Match par ghl_contact_id (au cas où un autre client local pointe sur
  // ce contact GHL avec un email différent dans clients.email).
  if (opp.ghl_contact_id) {
    const byGhlR = await supaFetch(
      `clients?ghl_contact_id=eq.${encodeURIComponent(opp.ghl_contact_id)}&select=id,business_name,email&limit=1`,
      {}, true,
    );
    if (byGhlR.ok) {
      const arr = await byGhlR.json();
      if (arr[0]) {
        // Lie l'opp à ce client si pas déjà fait (rétro-compat)
        await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(opp.id)}&client_id=is.null`, {
          method: 'PATCH', body: JSON.stringify({ client_id: arr[0].id }),
        }, true).catch(() => null);
        return { clientId: arr[0].id, businessName: arr[0].business_name || 'Client', email: arr[0].email || email, created: false };
      }
    }
  }

  // 3. Aucun client local trouvé — on en crée un depuis le contact GHL.
  let firstName = '';
  let lastName = '';
  let companyName = '';
  let city: string | null = null;
  let phone: string | null = opp.contact_phone || null;
  let contactName: string | null = opp.contact_name || null;

  if (opp.ghl_contact_id) {
    try {
      const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(opp.ghl_contact_id)}`);
      const c = data?.contact || data;
      if (c) {
        firstName = c.firstName || '';
        lastName = c.lastName || '';
        companyName = c.companyName || '';
        city = c.city || null;
        phone = phone || c.phone || null;
        contactName = contactName || c.contactName || c.name || [firstName, lastName].filter(Boolean).join(' ').trim() || null;
      }
    } catch { /* tolerate */ }
  }

  // Pick a usable business_name : companyName > opportunity name > contact name > email
  const businessName = companyName.trim()
    || (opp.name || '').trim()
    || (contactName || '').trim()
    || email;

  // 4. Last-chance race-check : si entre temps un autre process a créé le
  // client (webhook simultané), on prend l'existant.
  const raceR = await supaFetch(
    `clients?or=(email.ilike.${encodeURIComponent(email)}${opp.ghl_contact_id ? `,ghl_contact_id.eq.${encodeURIComponent(opp.ghl_contact_id)}` : ''})&select=id,business_name,email&limit=1`,
    {}, true,
  );
  if (raceR.ok) {
    const arr = await raceR.json();
    if (arr[0]) return { clientId: arr[0].id, businessName: arr[0].business_name || 'Client', email: arr[0].email || email, created: false };
  }

  // 5. Create
  const portalToken = crypto.randomBytes(24).toString('hex');
  const insertBody: Record<string, unknown> = {
    business_name: businessName,
    contact_name: contactName || businessName,
    email,
    phone,
    city,
    status: 'onboarding',
    portal_token: portalToken,
    ghl_contact_id: opp.ghl_contact_id || null,
  };
  const createR = await supaFetch('clients?select=id,business_name,email', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(insertBody),
  }, true);
  if (!createR.ok) return null;
  const createdRows = await createR.json();
  const newClient = createdRows[0];
  if (!newClient) return null;

  // 6. Link gh_opportunity to the new local client
  await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(opp.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ client_id: newClient.id }),
  }, true).catch(() => null);

  return {
    clientId: newClient.id,
    businessName: newClient.business_name,
    email: newClient.email,
    created: true,
  };
}
