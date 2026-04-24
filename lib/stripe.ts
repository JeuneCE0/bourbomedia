import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(STRIPE_SECRET_KEY);
  return _stripe;
}

export async function createCheckoutSession(params: {
  clientId: string;
  clientEmail: string;
  clientName: string;
  amount: number;
  description: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) return null;
  try {
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: params.clientEmail,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: params.description,
            description: `BourbonMédia — ${params.clientName}`,
          },
          unit_amount: params.amount,
        },
        quantity: 1,
      }],
      metadata: {
        client_id: params.clientId,
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    return session.url;
  } catch {
    return null;
  }
}

export async function createEmbeddedCheckoutSession(params: {
  clientId: string;
  clientEmail: string;
  clientName: string;
  amount: number;
  description: string;
  returnUrl: string;
  productId?: string;
}): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) return null;
  try {
    const priceData = params.productId
      ? { currency: 'eur' as const, unit_amount: params.amount, product: params.productId }
      : { currency: 'eur' as const, unit_amount: params.amount, product_data: { name: params.description, description: `BourbonMédia — ${params.clientName}` } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      ui_mode: 'embedded_page',
      customer_email: params.clientEmail,
      line_items: [{ price_data: priceData, quantity: 1 }],
      metadata: { client_id: params.clientId },
      return_url: params.returnUrl,
    } as any);
    return session.client_secret;
  } catch (e: unknown) {
    throw new Error('Stripe: ' + ((e as Error).message || 'Erreur inconnue'));
  }
}

export async function verifyWebhookSignature(body: string, signature: string): Promise<Stripe.Event | null> {
  if (!STRIPE_WEBHOOK_SECRET) return null;
  try {
    return getStripe().webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    return null;
  }
}

export function getWebhookSecret() {
  return STRIPE_WEBHOOK_SECRET;
}
