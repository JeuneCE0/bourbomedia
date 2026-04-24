import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { createCheckoutSession } from '@/lib/stripe';
import { findContractTemplateId, sendDocumentFromTemplate, getDocumentStatus, createGhlContact } from '@/lib/ghl';
import { notifyClientStatusChange } from '@/lib/slack';
import crypto from 'crypto';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (token) {
    try {
      const r = await supaFetch(`clients?onboarding_token=eq.${token}&select=id,business_name,contact_name,email,phone,onboarding_step,contract_signature_link,contract_signed_at,paid_at,onboarding_call_booked,onboarding_call_date,filming_date,filming_date_confirmed,publication_date,publication_date_confirmed,status,scripts(id,status)`, {}, true);
      if (!r.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      const data = await r.json();
      if (!data.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
      return NextResponse.json(data[0]);
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const r = await supaFetch('clients?onboarding_step=not.is.null&select=id,business_name,contact_name,onboarding_step,email,created_at&order=created_at.desc', {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const body = await req.json();
  const action = body.action;

  // Step 1: Client creates account (no auth needed, it's the first step)
  if (action === 'create_account') {
    try {
      const { business_name, contact_name, email, phone, password } = body;
      if (!business_name || !contact_name || !email || !password) {
        return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 });
      }
      if (password.length < 6) return NextResponse.json({ error: 'Mot de passe : 6 caractères minimum' }, { status: 400 });

      const onboardingToken = crypto.randomBytes(24).toString('hex');
      const portalToken = crypto.randomBytes(24).toString('hex');

      const r = await supaFetch('clients', {
        method: 'POST',
        body: JSON.stringify({
          business_name, contact_name, email, phone,
          password_hash: hashPassword(password),
          onboarding_token: onboardingToken,
          portal_token: portalToken,
          onboarding_step: 2,
          status: 'onboarding',
        }),
      }, true);

      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      const data = await r.json();

      notifyClientStatusChange(business_name, '—', 'Compte créé (onboarding)');

      return NextResponse.json({ token: onboardingToken, client: data[0] }, { status: 201 });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // All other actions require a valid onboarding token
  if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 400 });

  const cr = await supaFetch(`clients?onboarding_token=eq.${token}&select=*`, {}, true);
  if (!cr.ok) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  const clients = await cr.json();
  if (!clients.length) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  const client = clients[0];

  // Step 2: Initiate contract signing via GHL Documents
  if (action === 'init_contract') {
    try {
      const templateId = await findContractTemplateId();
      if (!templateId) return NextResponse.json({ error: 'Modèle de contrat introuvable dans GHL' }, { status: 400 });

      // Create GHL contact if not already linked
      let ghlContactId = client.ghl_contact_id;
      if (!ghlContactId) {
        const nameParts = client.contact_name.trim().split(' ');
        ghlContactId = await createGhlContact({
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || nameParts[0],
          email: client.email,
          phone: client.phone || undefined,
          companyName: client.business_name,
        });
        if (ghlContactId) {
          await supaFetch(`clients?id=eq.${client.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ghl_contact_id: ghlContactId }),
          }, true);
        }
      }
      if (!ghlContactId) return NextResponse.json({ error: 'Erreur création contact GHL' }, { status: 500 });

      const ghlUserId = process.env.GHL_USER_ID || '';
      const result = await sendDocumentFromTemplate(templateId, ghlContactId, ghlUserId);
      if (!result) return NextResponse.json({ error: 'Erreur envoi contrat GHL' }, { status: 500 });

      await supaFetch(`clients?id=eq.${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          contract_yousign_id: result.documentId,
          contract_signature_link: result.signingUrl,
        }),
      }, true);

      return NextResponse.json({ signatureLink: result.signingUrl, documentId: result.documentId });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Step 2: Check contract status via GHL
  if (action === 'check_contract') {
    try {
      if (!client.contract_yousign_id) return NextResponse.json({ signed: false });
      const doc = await getDocumentStatus(client.contract_yousign_id);
      if (doc && (doc.status === 'completed' || doc.status === 'signed')) {
        await supaFetch(`clients?id=eq.${client.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ contract_signed_at: doc.signedAt || new Date().toISOString(), onboarding_step: 3 }),
        }, true);
        notifyClientStatusChange(client.business_name, 'Étape 2', 'Contrat signé');
        return NextResponse.json({ signed: true });
      }
      return NextResponse.json({ signed: false, status: doc?.status || 'pending' });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Step 3: Create Stripe checkout
  if (action === 'create_payment') {
    try {
      const amount = body.amount || 49900; // default 499€ in cents
      const baseUrl = req.nextUrl.origin;
      const url = await createCheckoutSession({
        clientId: client.id,
        clientEmail: client.email,
        clientName: client.business_name,
        amount,
        description: 'Production vidéo BourbonMédia',
        successUrl: `${baseUrl}/onboarding?token=${token}&payment=success`,
        cancelUrl: `${baseUrl}/onboarding?token=${token}&payment=cancel`,
      });
      if (!url) return NextResponse.json({ error: 'Erreur Stripe' }, { status: 500 });
      return NextResponse.json({ checkoutUrl: url });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // Step 4: Mark onboarding call as booked
  if (action === 'call_booked') {
    await supaFetch(`clients?id=eq.${client.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        onboarding_call_booked: true,
        onboarding_call_date: body.date || null,
        onboarding_step: 5,
      }),
    }, true);
    notifyClientStatusChange(client.business_name, 'Étape 4', 'Appel onboarding réservé');
    return NextResponse.json({ success: true });
  }

  // Step 6: Confirm filming date
  if (action === 'confirm_filming') {
    await supaFetch(`clients?id=eq.${client.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ filming_date_confirmed: true, onboarding_step: 7 }),
    }, true);
    notifyClientStatusChange(client.business_name, 'Étape 6', 'Date de tournage confirmée');
    return NextResponse.json({ success: true });
  }

  // Step 7: Confirm publication date
  if (action === 'confirm_publication') {
    await supaFetch(`clients?id=eq.${client.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        publication_date_confirmed: true,
        onboarding_step: 8,
        status: 'filming_scheduled',
      }),
    }, true);
    notifyClientStatusChange(client.business_name, 'Étape 7', 'Onboarding terminé — tournage planifié');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
