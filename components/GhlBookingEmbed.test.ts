import { describe, it, expect } from 'vitest';
import { resolveGhlCalendarUrl } from './GhlBookingEmbed';

const FALLBACK_ID = 'RRDC3HvypJEIvLxjy3Gg';
const FALLBACK_URL = `https://api.leadconnectorhq.com/widget/booking/${FALLBACK_ID}`;

describe('resolveGhlCalendarUrl', () => {
  it('retourne le fallback si env undefined', () => {
    expect(resolveGhlCalendarUrl(undefined, FALLBACK_ID)).toBe(FALLBACK_URL);
  });

  it('retourne le fallback si env vide ou whitespace', () => {
    expect(resolveGhlCalendarUrl('', FALLBACK_ID)).toBe(FALLBACK_URL);
    expect(resolveGhlCalendarUrl('   ', FALLBACK_ID)).toBe(FALLBACK_URL);
  });

  it('accepte une URL widget ID-based valide telle quelle', () => {
    const url = 'https://api.leadconnectorhq.com/widget/booking/abc123XYZ';
    expect(resolveGhlCalendarUrl(url, FALLBACK_ID)).toBe(url);
  });

  it('accepte une URL widget slug-based valide telle quelle', () => {
    const url = 'https://api.leadconnectorhq.com/widget/bookings/appel-avec-simon';
    expect(resolveGhlCalendarUrl(url, FALLBACK_ID)).toBe(url);
  });

  it('normalise un ID GHL nu en URL widget complète', () => {
    const out = resolveGhlCalendarUrl('2fmSZkWpwEulfZsvpPmh', FALLBACK_ID);
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/2fmSZkWpwEulfZsvpPmh');
  });

  it('normalise un path /widget/booking/... en URL avec host', () => {
    const out = resolveGhlCalendarUrl('/widget/booking/abc123XYZ', FALLBACK_ID);
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/abc123XYZ');
  });

  it('normalise un host sans protocol en https://', () => {
    const out = resolveGhlCalendarUrl('api.leadconnectorhq.com/widget/booking/xyz123abc', FALLBACK_ID);
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/xyz123abc');
  });

  it('retombe sur le fallback si la valeur env est vraiment garbage', () => {
    expect(resolveGhlCalendarUrl('lol', FALLBACK_ID)).toBe(FALLBACK_URL);
    expect(resolveGhlCalendarUrl('https://example.com/whatever', FALLBACK_ID)).toBe(FALLBACK_URL);
    expect(resolveGhlCalendarUrl('https://bourbonmedia.fr/portal', FALLBACK_ID)).toBe(FALLBACK_URL);
  });
});
