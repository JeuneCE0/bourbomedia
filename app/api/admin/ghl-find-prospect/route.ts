import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { findGhlContactByEmailOrPhone, ghlRequest } from '@/lib/ghl';
import { listOpportunitiesByContact, resolveMapping, stageIdToProspectStatus, getContact } from '@/lib/ghl-opportunities';

const LOCATION_ID = process.env.GHL_LOCATION_ID || '';

// GET /api/admin/ghl-find-prospect?q=<email_or_phone>
//
// Recherche un prospect directement côté GHL (bypass de la mirror locale)
// quand le picker "Ajouter" du Pipeline > Production retourne 0 résultat
// alors que l'admin sait que le prospect existe.
//
// Stratégie :
//   1. Trouve le contact GHL par email ou phone (query libre)
//   2. Récupère ses opportunités (listOpportunitiesByContact)
//   3. Filtre celles dans notre pipeline Bourbon Media
//   4. Pour chacune : upsert dans gh_opportunities locale (pour qu'elle
//      apparaisse aux prochains chargements du picker) + retourne la row
//   5. Best-effort : enrichi avec contact_email/phone/name dans la foulée
//
// Réponse :
//   { opportunities: [{ id, name, contact_email, ..., client_id }] }
//   où id est l'UUID local de gh_opportunities (compatible avec le picker
//   et /api/clients/from-ghl-opportunity).
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ opportunities: [] });
  if (!LOCATION_ID) return NextResponse.json({ opportunities: [], error: 'GHL_LOCATION_ID manquant' });

  // 1. Cherche le contact côté GHL — query libre couvre email + phone +
  //    nom selon le moteur GHL.
  let contactId: string | null = null;
  try {
    contactId = await findGhlContactByEmailOrPhone(q, q);
  } catch { /* tolerate */ }
  if (!contactId) {
    // Essai supplémentaire : query par texte libre si le contact n'a pas
    // matché email/phone exact (ex : recherche par nom).
    try {
      const data = await ghlRequest('GET', `/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(q)}&limit=5`);
      const arr = (data?.contacts || []) as { id: string }[];
      contactId = arr[0]?.id || null;
    } catch { /* tolerate */ }
  }
  if (!contactId) return NextResponse.json({ opportunities: [] });

  // 2. Pull les détails du contact pour enrichissement
  const contact = await getContact(contactId).catch(() => null);
  const email = contact?.email || null;
  const phone = contact?.phone || null;
  const name = contact?.name
    || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim()
    || null;

  // 3. Pull les opps GHL pour ce contact
  const ghlOpps = await listOpportunitiesByContact(contactId).catch(() => []);
  if (ghlOpps.length === 0) return NextResponse.json({ opportunities: [] });

  // 4. Filtre celles dans notre pipeline Bourbon Media
  const { mapping, pipeline } = await resolveMapping();
  const inPipeline = pipeline ? ghlOpps.filter(o => o.pipelineId === pipeline.id) : ghlOpps;

  // 5. Upsert chaque opp dans gh_opportunities locale + récupère la row
  //    correspondante (UUID local) pour la réponse picker-ready.
  const ids: string[] = [];
  await Promise.all(inPipeline.map(async (o) => {
    const stage = pipeline?.stages.find(s => s.id === o.pipelineStageId);
    // Lookup client lié best-effort
    let linkedClientId: string | null = null;
    try {
      const r = await supaFetch(
        `clients?ghl_contact_id=eq.${encodeURIComponent(contactId!)}&select=id&limit=1`,
        {}, true,
      );
      const arr = r.ok ? await r.json() : [];
      linkedClientId = arr[0]?.id || null;
    } catch { /* tolerate */ }

    await supaFetch('gh_opportunities?on_conflict=ghl_opportunity_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        ghl_opportunity_id: o.id,
        ghl_contact_id: contactId,
        client_id: linkedClientId,
        pipeline_id: o.pipelineId,
        pipeline_stage_id: o.pipelineStageId,
        pipeline_stage_name: stage?.name || null,
        name: o.name || null,
        contact_email: email,
        contact_phone: phone,
        contact_name: name,
        monetary_value_cents: o.monetaryValue ? Math.round(o.monetaryValue * 100) : null,
        prospect_status: stageIdToProspectStatus(mapping, o.pipelineStageId),
        ghl_created_at: o.createdAt ? new Date(o.createdAt).toISOString() : null,
        ghl_updated_at: o.updatedAt ? new Date(o.updatedAt).toISOString() : null,
        updated_at: new Date().toISOString(),
      }),
    }, true).catch(() => null);
    ids.push(o.id);
  }));

  // 6. Re-pull les rows locales (pour avoir les UUIDs `id` que le picker utilise)
  if (ids.length === 0) return NextResponse.json({ opportunities: [] });
  const idsParam = ids.map(id => `"${id}"`).join(',');
  const rowsR = await supaFetch(
    `gh_opportunities?ghl_opportunity_id=in.(${encodeURIComponent(idsParam)})&select=*`,
    {}, true,
  );
  const opportunities = rowsR.ok ? await rowsR.json() : [];
  return NextResponse.json({ opportunities, contact: { id: contactId, email, phone, name } });
}
