import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/stripe/orphans?days=60
//   Liste les charges Stripe RÉUSSIES des N derniers jours qui ne sont PAS
//   en base (table payments) ET pour lesquelles on n'a pas trouvé de client
//   correspondant (par email). Permet d'afficher en permanence sur le
//   dashboard les paiements 'à rattacher' sans devoir relancer le sync.
//
//   Read-only : ne fait AUCUN insert. C'est ResolveOrphanCharge qui crée le
//   client + le payment quand l'admin valide.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return NextResponse.json({ orphans: [] });

  const days = Math.max(1, Math.min(180, parseInt(req.nextUrl.searchParams.get('days') || '60', 10)));
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  interface Orphan {
    charge_id: string;
    payment_intent_id: string | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    amount_eur: number;
    currency: string;
    created_at: string;
    description: string | null;
    receipt_url: string | null;
  }
  const orphans: Orphan[] = [];

  try {
    for await (const ch of stripe.charges.list({ created: { gte: since }, limit: 100 })) {
      if (ch.status !== 'succeeded' || ch.refunded) continue;
      const piId = typeof ch.payment_intent === 'string' ? ch.payment_intent : (ch.payment_intent?.id || null);
      const stripeId = piId || ch.id;

      // Skip si déjà en base (par PI ou par session)
      const existsR = await supaFetch(
        `payments?or=(stripe_payment_intent.eq.${encodeURIComponent(stripeId)},stripe_session_id.eq.${encodeURIComponent(stripeId)})&select=id&limit=1`,
        {}, true,
      );
      if (existsR.ok) {
        const arr = await existsR.json();
        if (arr.length > 0) continue;
      }

      // Si email présent, vérifie s'il y a un client local OU GHL — si oui, on
      // saute (le sync l'importera). Sinon, c'est un orphan persistant.
      const email = ch.billing_details?.email || ch.receipt_email;
      if (email) {
        const enc = encodeURIComponent(email.toLowerCase().trim());
        const [cR, oR] = await Promise.all([
          supaFetch(`clients?email=ilike.${enc}&select=id&limit=1`, {}, true),
          supaFetch(`gh_opportunities?contact_email=ilike.${enc}&select=id&limit=1`, {}, true),
        ]);
        const hasLocalClient = cR.ok && (await cR.json()).length > 0;
        const hasGhlOpp = oR.ok && (await oR.json()).length > 0;
        // Si un match existe quelque part, c'est juste pas encore syncé →
        // l'utilisateur peut sync. On ne l'affiche pas comme orphan vrai
        // (sinon trop de bruit). Vrai orphan = ni client ni opp ni nom Stripe.
        if (hasLocalClient || hasGhlOpp) continue;
      }

      orphans.push({
        charge_id: ch.id,
        payment_intent_id: piId,
        email,
        name: ch.billing_details?.name || null,
        phone: ch.billing_details?.phone || null,
        amount_eur: ch.amount / 100,
        currency: ch.currency || 'eur',
        created_at: new Date(ch.created * 1000).toISOString(),
        description: ch.description || null,
        receipt_url: ch.receipt_url || null,
      });

      if (orphans.length >= 20) break; // limite raisonnable
    }
  } catch (e: unknown) {
    return NextResponse.json({ orphans, error: (e as Error).message });
  }

  return NextResponse.json({
    orphans,
    total: orphans.length,
    days,
  });
}
