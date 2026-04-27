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

  // 1. Existing local client
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
    `gh_opportunities?contact_email=ilike.${encodeURIComponent(email)}&select=id,ghl_contact_id,name,contact_name,contact_phone,contact_email&limit=1`,
    {}, true,
  );
  if (!oppR.ok) return null;
  const opps = await oppR.json();
  const opp = opps[0];
  if (!opp) return null;

  // Fetch full contact details from GHL when possible (better business_name + city)
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

  // 3. Create local client
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

  // 4. Link gh_opportunity to the new local client (best effort)
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
