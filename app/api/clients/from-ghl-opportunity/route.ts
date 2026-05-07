import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import crypto from 'crypto';

// POST /api/clients/from-ghl-opportunity
//   body : { opportunity_id, onboarding_step }
//
// Crée un nouveau client en production à partir d'une opportunité GHL
// existante. Utile pour ajouter un client qui a contracté hors funnel
// (virement, contrat papier, etc.) directement à la bonne étape (Appel,
// Script, Tournage…) sans devoir re-saisir ses infos.
//
// L'étape choisie pose les bons flags rétroactivement :
//   step 1 (Compte)      : aucun flag
//   step 2 (Contrat)     : aucun flag (à signer)
//   step 3 (Paiement)    : contract_signed_at = now
//   step 4 (Appel)       : contract_signed_at + paid_at = now
//   step 5 (Script)      : + onboarding_call_booked + status='script_writing'
//   step 6 (Tournage)    : + status='script_validated'
//   step 7 (Publication) : + status='publication_pending'
//
// Idempotent : si un client avec le même ghl_contact_id existe déjà, on
// renvoie 409 plutôt que de créer un doublon.
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let body: { opportunity_id?: string; onboarding_step?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { opportunity_id, onboarding_step } = body;
  if (!opportunity_id) return NextResponse.json({ error: 'opportunity_id requis' }, { status: 400 });
  const step = typeof onboarding_step === 'number'
    ? Math.max(1, Math.min(7, onboarding_step))
    : 5;

  // 1. Pull l'opportunité depuis gh_opportunities (miroir local)
  const oppR = await supaFetch(
    `gh_opportunities?id=eq.${encodeURIComponent(opportunity_id)}`
    + `&select=ghl_opportunity_id,ghl_contact_id,client_id,name,contact_name,contact_email,contact_phone,monetary_value_cents&limit=1`,
    {}, true,
  );
  if (!oppR.ok) return NextResponse.json({ error: 'opportunité introuvable' }, { status: 500 });
  const opps = await oppR.json();
  const opp = opps[0];
  if (!opp) return NextResponse.json({ error: 'opportunité introuvable' }, { status: 404 });

  // 2. Garde-fou : si l'opp a déjà un client_id ou si un client existe déjà
  // pour ce ghl_contact_id, on renvoie une erreur explicite plutôt que de
  // créer un doublon.
  if (opp.client_id) {
    return NextResponse.json({ error: 'Cette opportunité est déjà liée à un client.', existing_client_id: opp.client_id }, { status: 409 });
  }
  if (opp.ghl_contact_id) {
    const dupR = await supaFetch(
      `clients?ghl_contact_id=eq.${encodeURIComponent(opp.ghl_contact_id)}&select=id,business_name&limit=1`,
      {}, true,
    );
    if (dupR.ok) {
      const arr = await dupR.json();
      if (arr[0]) {
        return NextResponse.json({
          error: `Un client existe déjà pour ce contact GHL (${arr[0].business_name || arr[0].id}).`,
          existing_client_id: arr[0].id,
        }, { status: 409 });
      }
    }
  }

  // 3. Compose le payload client à insérer
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = {
    business_name: opp.name || opp.contact_name || 'Client (à renommer)',
    contact_name: opp.contact_name || opp.name || 'Contact',
    email: opp.contact_email || null,
    phone: opp.contact_phone || null,
    ghl_contact_id: opp.ghl_contact_id || null,
    portal_token: crypto.randomBytes(24).toString('hex'),
    onboarding_token: crypto.randomBytes(24).toString('hex'),
    onboarding_step: step,
    payment_amount: opp.monetary_value_cents || null,
  };

  // Flags rétroactifs en fonction de l'étape choisie
  if (step >= 3) payload.contract_signed_at = nowIso;
  if (step >= 4) payload.paid_at = nowIso;
  if (step >= 5) {
    payload.onboarding_call_booked = true;
    payload.onboarding_call_date = nowIso;
  }

  // Mapping status (mêmes valeurs que le rollback dans /api/clients PUT)
  if (step <= 4) payload.status = 'onboarding';
  else if (step === 5) payload.status = 'script_writing';
  else if (step === 6) payload.status = 'script_validated';
  else if (step === 7) payload.status = 'publication_pending';

  // 4. Insert
  const ins = await supaFetch('clients', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  }, true);
  if (!ins.ok) {
    const txt = await ins.text().catch(() => '');
    return NextResponse.json({ error: 'insert failed', detail: txt }, { status: 500 });
  }
  const inserted = await ins.json();
  const client = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!client) return NextResponse.json({ error: 'insert failed' }, { status: 500 });

  // 5. Lie l'opportunité au client (back-pointer pour les analytics + GET)
  await supaFetch(`gh_opportunities?id=eq.${encodeURIComponent(opportunity_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ client_id: client.id, updated_at: nowIso }),
  }, true).catch(() => null);

  return NextResponse.json({ client, step }, { status: 201 });
}
