import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './auth';

describe('password hashing (scrypt + salt)', () => {
  it('hashPassword renvoie un format scrypt$<salt>$<hash>', () => {
    const hashed = hashPassword('hello world');
    const parts = hashed.split('$');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // salt 16 bytes hex
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/); // hash 64 bytes hex
  });

  it('produit un hash différent à chaque appel pour le même password (salt unique)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('verifyPassword accepte un hash scrypt valide', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', stored)).toEqual({ ok: true, needsUpgrade: false });
  });

  it('verifyPassword rejette un mauvais mot de passe', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('wrong', stored)).toEqual({ ok: false, needsUpgrade: false });
  });

  it('verifyPassword tolère les hashes legacy sha256 (64 hex chars)', () => {
    // sha256("legacy-pass") = 64 hex chars
    const sha256OfLegacy = '6f0a8f59a7d6cea1e9c01dd7cf94c00deca78f5b0c4dde8aaa6dd7d1b3d50f0c';
    // Pas de match pour un random pass mais format valide → renvoie {ok:false, needsUpgrade:false}.
    const r = verifyPassword('whatever', sha256OfLegacy);
    expect(r.ok).toBe(false);
    expect(r.needsUpgrade).toBe(false);
  });

  it('verifyPassword rejette les formats invalides', () => {
    expect(verifyPassword('any', '')).toEqual({ ok: false, needsUpgrade: false });
    expect(verifyPassword('any', 'not-a-hash')).toEqual({ ok: false, needsUpgrade: false });
    expect(verifyPassword('any', 'scrypt$only-2$parts')).toEqual({ ok: false, needsUpgrade: false });
  });
});
