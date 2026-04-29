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
    const stripe = getStripe();

    // When a productId is provided, defer to the product's default_price in Stripe
    // so the Dashboard is the source of truth. Passing price_data.unit_amount
    // alongside a product overrides that price silently — easy way to charge the
    // wrong amount.
    let lineItem;
    if (params.productId) {
      const product = await stripe.products.retrieve(params.productId);
      const priceId = typeof product.default_price === 'string'
        ? product.default_price
        : product.default_price?.id;
      if (!priceId) throw new Error(`Produit Stripe ${params.productId} sans tarif par défaut configuré`);
      lineItem = { price: priceId, quantity: 1 };
    } else {
      lineItem = {
        price_data: {
          currency: 'eur' as const,
          unit_amount: params.amount,
          product_data: { name: params.description, description: `BourbonMédia — ${params.clientName}` },
        },
        quantity: 1,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      ui_mode: 'embedded_page',
      customer_email: params.clientEmail,
      line_items: [lineItem],
      metadata: { client_id: params.clientId },
      return_url: params.returnUrl,
    } as any);
    return session.client_secret;
  } catch (e: unknown) {
    throw new Error('Stripe: ' + ((e as Error).message || 'Erreur inconnue'));
  }
}

export async function getPaymentReceipt(paymentIntentId: string): Promise<{ receipt_url?: string; invoice_pdf?: string; invoice_number?: string } | null> {
  if (!STRIPE_SECRET_KEY || !paymentIntentId) return null;
  try {
    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge', 'invoice'] }) as unknown as {
      latest_charge?: { receipt_url?: string };
      invoice?: { invoice_pdf?: string; number?: string };
    };
    return {
      receipt_url: pi.latest_charge?.receipt_url || undefined,
      invoice_pdf: pi.invoice?.invoice_pdf || undefined,
      invoice_number: pi.invoice?.number || undefined,
    };
  } catch {
    return null;
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
