import { describe, it, expect } from 'vitest';
import { buildGhlUrlWithPrefill, normalizeGhlCalendarUrl } from './GhlBookingEmbed';

describe('normalizeGhlCalendarUrl', () => {
  it('renvoie chaîne vide si input vide ou whitespace', () => {
    expect(normalizeGhlCalendarUrl('')).toBe('');
    expect(normalizeGhlCalendarUrl('   ')).toBe('');
  });

  it('passe une URL absolue HTTPS telle quelle', () => {
    const url = 'https://api.leadconnectorhq.com/widget/booking/abc123';
    expect(normalizeGhlCalendarUrl(url)).toBe(url);
  });

  it('passe HTTP en https sans toucher au reste (mais HTTP gardé)', () => {
    const url = 'http://example.com/test';
    expect(normalizeGhlCalendarUrl(url)).toBe(url);
  });

  it('préfixe https: aux URLs //api.leadconnectorhq.com/...', () => {
    const out = normalizeGhlCalendarUrl('//api.leadconnectorhq.com/widget/booking/xyz');
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/xyz');
  });

  it('préfixe https:// aux URLs api.leadconnectorhq.com/... (sans protocol)', () => {
    const out = normalizeGhlCalendarUrl('api.leadconnectorhq.com/widget/booking/abcDEF12345');
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/abcDEF12345');
  });

  it('préfixe le host aux paths /widget/booking/...', () => {
    const out = normalizeGhlCalendarUrl('/widget/booking/abc123XYZ');
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/abc123XYZ');
  });

  it('préfixe l\'URL widget complète à un ID GHL nu (15-32 chars alphanumériques)', () => {
    const out = normalizeGhlCalendarUrl('2fmSZkWpwEulfZsvpPmh');
    expect(out).toBe('https://api.leadconnectorhq.com/widget/booking/2fmSZkWpwEulfZsvpPmh');
  });

  it('renvoie tel quel les inputs garbage (le caller fera le fallback)', () => {
    expect(normalizeGhlCalendarUrl('lol')).toBe('lol');
    expect(normalizeGhlCalendarUrl('hello world')).toBe('hello world');
  });

  it('trim les whitespace en début/fin', () => {
    expect(normalizeGhlCalendarUrl('  https://example.com  ')).toBe('https://example.com');
  });
});

describe('buildGhlUrlWithPrefill', () => {
  const baseUrl = 'https://api.leadconnectorhq.com/widget/booking/abc123';

  it('renvoie l\'URL telle quelle si pas de prefill', () => {
    expect(buildGhlUrlWithPrefill(baseUrl)).toBe(baseUrl);
    expect(buildGhlUrlWithPrefill(baseUrl, undefined)).toBe(baseUrl);
  });

  it('split le contact_name en first_name + last_name', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, { contact_name: 'Marie Dupont' });
    expect(out).toContain('first_name=Marie');
    expect(out).toContain('last_name=Dupont');
  });

  it('met juste first_name si un seul mot', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, { contact_name: 'Madonna' });
    expect(out).toContain('first_name=Madonna');
    expect(out).not.toContain('last_name=');
  });

  it('joint les noms multiples en last_name', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, { contact_name: 'Jean-Pierre De La Tour' });
    expect(out).toContain('first_name=Jean-Pierre');
    expect(out).toMatch(/last_name=De\+La\+Tour|last_name=De%20La%20Tour/);
  });

  it('passe email + phone + company_name', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, {
      contact_name: 'X',
      email: 'rudy@bbm.fr',
      phone: '+33612345678',
      business_name: 'BourbonMédia',
    });
    expect(out).toContain('email=rudy%40bbm.fr');
    expect(out).toContain('phone=%2B33612345678');
    expect(out).toContain('company_name=BourbonM%C3%A9dia');
  });

  it('utilise & si l\'URL contient déjà ?', () => {
    const out = buildGhlUrlWithPrefill(baseUrl + '?existing=1', { email: 'x@y.com' });
    expect(out).toContain('existing=1&email=x%40y.com');
  });

  it('utilise ? si l\'URL n\'a pas de query string', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, { email: 'x@y.com' });
    expect(out).toContain('?email=x%40y.com');
  });

  it('renvoie l\'URL inchangée si tous les champs prefill sont vides', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, {
      contact_name: '',
      email: '',
      phone: null,
      business_name: undefined,
    });
    expect(out).toBe(baseUrl);
  });

  it('skip les champs null/undefined', () => {
    const out = buildGhlUrlWithPrefill(baseUrl, {
      contact_name: 'Paul',
      email: null,
      phone: undefined,
    });
    expect(out).toContain('first_name=Paul');
    expect(out).not.toContain('email=');
    expect(out).not.toContain('phone=');
  });
});
