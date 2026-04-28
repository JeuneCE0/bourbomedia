import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { ghlRequest } from '@/lib/ghl';

// POST /api/clients/link-ghl
//   body : { client_id, ghl_contact_id }
//   - Set clients.ghl_contact_id
//   - Récupère les infos du contact GHL pour enrichir email/phone/business_name
//     manquants côté local (sans écraser les valeurs existantes)
//   - Trouve les opportunités GHL liées à ce contact et patch leur
//     gh_opportunities.client_id pour les lier en retour
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let body: { client_id?: string; ghl_contact_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const { client_id, ghl_contact_id } = body;
  if (!client_id || !ghl_contact_id) return NextResponse.json({ error: 'client_id + ghl_contact_id requis' }, { status: 400 });

  // 1. Vérifie que le client existe
  const cR = await supaFetch(`clients?id=eq.${encodeURIComponent(client_id)}&select=id,business_name,contact_name,email,phone&limit=1`, {}, true);
  if (!cR.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const clients = await cR.json();
  if (!clients[0]) return NextResponse.json({ error: 'client not found' }, { status: 404 });
  const client = clients[0];

  // 2. Fetch le contact GHL pour récupérer les infos manquantes
  let ghlContact: { firstName?: string; lastName?: string; name?: string; companyName?: string; email?: string; phone?: string; city?: string } = {};
  try {
    const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(ghl_contact_id)}`);
    ghlContact = data?.contact || data || {};
  } catch (e: unknown) {
    return NextResponse.json({ error: 'GHL contact fetch failed: ' + (e as Error).message }, { status: 500 });
  }

  // 3. Patch le client : ghl_contact_id + complète les champs vides
  const patch: Record<string, unknown> = { ghl_contact_id };
  const ghlName = ghlContact.companyName
    || ghlContact.name
    || [ghlContact.firstName, ghlContact.lastName].filter(Boolean).join(' ').trim();
  // Ne complète QUE les champs vides — pas écraser ce qui est déjà rempli
  if (!client.business_name || client.business_name === client.email) {
    if (ghlName) patch.business_name = ghlName;
  }
  if (!client.contact_name && ghlName) patch.contact_name = ghlName;
  if (!client.email && ghlContact.email) patch.email = ghlContact.email;
  if (!client.phone && ghlContact.phone) patch.phone = ghlContact.phone;
  if (!client.city && ghlContact.city) patch.city = ghlContact.city;

  const ur = await supaFetch(`clients?id=eq.${encodeURIComponent(client_id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }, true);
  if (!ur.ok) {
    const txt = await ur.text().catch(() => '');
    return NextResponse.json({ error: 'update failed', detail: txt }, { status: 500 });
  }

  // 4. Lie les opportunités GHL au client local (gh_opportunities.client_id)
  let linkedOpps = 0;
  try {
    const oR = await supaFetch(
      `gh_opportunities?ghl_contact_id=eq.${encodeURIComponent(ghl_contact_id)}&client_id=is.null&select=id`,
      {}, true,
    );
    if (oR.ok) {
      const opps = await oR.json();
      for (const o of opps) {
        await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(o.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ client_id }),
        }, true).catch(() => null);
        linkedOpps++;
      }
    }
  } catch { /* tolerate */ }

  // 5. Lie les RDV GHL au client local
  let linkedAppts = 0;
  try {
    const aR = await supaFetch(
      `gh_appointments?ghl_contact_id=eq.${encodeURIComponent(ghl_contact_id)}&client_id=is.null&select=id`,
      {}, true,
    );
    if (aR.ok) {
      const appts = await aR.json();
      for (const a of appts) {
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ client_id }),
        }, true).catch(() => null);
        linkedAppts++;
      }
    }
  } catch { /* tolerate */ }

  return NextResponse.json({
    ok: true,
    client_id,
    ghl_contact_id,
    business_name_updated: !!patch.business_name,
    linked_opportunities: linkedOpps,
    linked_appointments: linkedAppts,
    message: `Client lié à GHL · ${linkedOpps} opportunité${linkedOpps > 1 ? 's' : ''} + ${linkedAppts} RDV rattaché${linkedAppts > 1 ? 's' : ''}`,
  });
}
