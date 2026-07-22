// Bourbomedia pricing — standard "vidéo unique" offer.
//
// Prix : 900€ net (90 000 cents) — montant payé par le client.
// TVA  : non applicable (franchise en base, art. 293 B CGI) → VAT_RATE = 0,
//        donc net = HT = TTC = 900€.
//
// Override via env vars BBM_VIDEO_PRICE_CENTS / BBM_VAT_RATE if needed.

const HT_FROM_ENV = Number(process.env.BBM_VIDEO_PRICE_CENTS);
const VAT_FROM_ENV = Number(process.env.BBM_VAT_RATE);

export const STANDARD_VIDEO_PRICE_HT_CENTS = Number.isFinite(HT_FROM_ENV) && HT_FROM_ENV > 0 ? HT_FROM_ENV : 90_000;
export const VAT_RATE = Number.isFinite(VAT_FROM_ENV) && VAT_FROM_ENV >= 0 ? VAT_FROM_ENV : 0;
export const STANDARD_VIDEO_PRICE_TTC_CENTS = Math.round(STANDARD_VIDEO_PRICE_HT_CENTS * (1 + VAT_RATE));

export function htToTtc(htCents: number): number {
  return Math.round(htCents * (1 + VAT_RATE));
}

export function ttcToHt(ttcCents: number): number {
  return Math.round(ttcCents / (1 + VAT_RATE));
}

export function fmtEUR(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;
}
