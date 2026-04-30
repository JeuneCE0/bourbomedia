import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { supaFetch } from '@/lib/supabase';

const SECRET = process.env.ADMIN_SECRET || 'bourbomedia-secret-change-me';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '';

// Paramètres scrypt — N=2^14 reste rapide (~30ms) tout en étant ~100x plus
// coûteux qu'un brute-force par dictionnaire sur sha256 nu. Si on monte la
// charge admin, bumper r ou N plutôt que d'ajouter une nouvelle dep.
const SCRYPT_KEY_LEN = 64;
const SCRYPT_OPTS = { N: 1 << 14, r: 8, p: 1 } as const;

export function createToken(sub: string = ADMIN_USER) {
  const payload = Buffer.from(JSON.stringify({
    sub,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

export function verifyToken(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  return auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export function requireAuth(req: NextRequest): boolean {
  return verifyToken(getTokenFromRequest(req));
}

// ─────────────────────────────────────────────────────────────────────────
// Password hashing
//
// Nouveau format (recommandé) : `scrypt$<salt-hex>$<hash-hex>` — KDF résistant
// au brute-force avec salt unique par user.
// Ancien format (legacy) : sha256 nu, 64 chars hex. Vulnérable aux rainbow
// tables. On le supporte en lecture pour ne pas locker out les comptes
// existants, et on upgrade automatiquement vers le nouveau format dès
// qu'un user se connecte avec succès.
// ─────────────────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LEN, SCRYPT_OPTS).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function legacyHashSha256(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Detect le format et compare en constant-time. Retourne `{ ok, needsUpgrade }`
// pour qu'au login le caller puisse réécrire le hash legacy au format scrypt.
export function verifyPassword(password: string, stored: string): { ok: boolean; needsUpgrade: boolean } {
  if (!stored) return { ok: false, needsUpgrade: false };

  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return { ok: false, needsUpgrade: false };
    const [, salt, expectedHex] = parts;
    try {
      const computed = crypto.scryptSync(password, salt, SCRYPT_KEY_LEN, SCRYPT_OPTS);
      const expected = Buffer.from(expectedHex, 'hex');
      if (computed.length !== expected.length) return { ok: false, needsUpgrade: false };
      const ok = crypto.timingSafeEqual(computed, expected);
      return { ok, needsUpgrade: false };
    } catch {
      return { ok: false, needsUpgrade: false };
    }
  }

  // Legacy sha256 (64 chars hex). Si match, on flag pour upgrade.
  if (/^[0-9a-f]{64}$/.test(stored)) {
    const computed = Buffer.from(legacyHashSha256(password), 'hex');
    const expected = Buffer.from(stored, 'hex');
    if (computed.length !== expected.length) return { ok: false, needsUpgrade: false };
    const ok = crypto.timingSafeEqual(computed, expected);
    return { ok, needsUpgrade: ok };
  }

  return { ok: false, needsUpgrade: false };
}

// Constant-ish delay sur échec d'authentification — slow brute force sans
// dépendre d'infra Redis/KV. Pas un rate-limit propre mais transforme un
// attaque par dictionnaire de millions de pwd/seconde en quelques par seconde.
async function authFailureDelay(): Promise<void> {
  // 250-450ms aléatoire pour ne pas révéler de timing differential entre
  // "user pas trouvé" vs "mauvais mot de passe".
  const ms = 250 + Math.floor(Math.random() * 200);
  await new Promise(r => setTimeout(r, ms));
}

// Login flow accepts two sources :
//  1. Le couple ADMIN_USERNAME / ADMIN_PASSWORD (env) — compte master historique.
//  2. Toute ligne active de saas_users dont le password_hash matche — comptes
//     créés via /dashboard/settings pour les membres de l'équipe.
// L'API /api/users POST stockait déjà les comptes équipe dans saas_users mais
// /api/auth ne consultait que les variables d'env, ce qui faisait que les
// identifiants d'équipe étaient acceptés à la création mais refusés au login.
// Lockout policy : N échecs consécutifs sur le même email ⇒ blocage temporaire.
// Plus robuste que le throttle 250-450ms qui ne sert qu'à uniformiser le
// timing — un attaquant patient peut quand même pousser quelques tentatives
// par seconde sur des IPs différentes. Avec un lock à 5 → 15 min, le coût
// devient prohibitif.
const FAILED_LOGIN_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

async function recordLoginFailure(userId: string, currentCount: number): Promise<void> {
  const next = currentCount + 1;
  const patch: Record<string, unknown> = {
    failed_login_count: next,
    updated_at: new Date().toISOString(),
  };
  if (next >= FAILED_LOGIN_THRESHOLD) {
    patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
  }
  try {
    await supaFetch(`saas_users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    }, true);
  } catch { /* tolerate */ }
}

async function clearLoginFailures(userId: string): Promise<void> {
  try {
    await supaFetch(`saas_users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        failed_login_count: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      }),
    }, true);
  } catch { /* tolerate */ }
}

export async function checkCredentials(username: string, password: string): Promise<{ ok: boolean; sub?: string; lockedUntil?: string }> {
  if (ADMIN_PASS && username === ADMIN_USER && password === ADMIN_PASS) {
    return { ok: true, sub: ADMIN_USER };
  }

  try {
    // Select inclut maintenant les champs lockout pour les vérifier inline.
    const r = await supaFetch(
      `saas_users?email=eq.${encodeURIComponent(username)}&active=eq.true&select=id,email,password_hash,failed_login_count,locked_until`,
      {},
      true,
    );
    if (!r.ok) { await authFailureDelay(); return { ok: false }; }
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      await authFailureDelay();
      return { ok: false };
    }
    const user = rows[0];

    // Si le compte est lock-out, on refuse immédiatement même si le mot de
    // passe est bon — pour ne pas confirmer à l'attaquant qu'il a trouvé
    // pendant la fenêtre. Au passage on n'incrémente pas le compteur (sinon
    // on ne sortirait jamais du lock).
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      await authFailureDelay();
      return { ok: false, lockedUntil: user.locked_until };
    }

    const { ok, needsUpgrade } = verifyPassword(password, user.password_hash);
    if (!ok) {
      await recordLoginFailure(user.id, user.failed_login_count || 0);
      await authFailureDelay();
      return { ok: false };
    }

    // Login réussi → reset compteur + lock pour repartir d'une page propre.
    if ((user.failed_login_count || 0) > 0 || user.locked_until) {
      await clearLoginFailures(user.id);
    }

    // Upgrade transparent du hash legacy → scrypt au prochain login réussi.
    // Best-effort : si la mise à jour échoue, l'auth réussit quand même
    // (l'upgrade se retentera au prochain login).
    if (needsUpgrade) {
      try {
        await supaFetch(`saas_users?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            password_hash: hashPassword(password),
            updated_at: new Date().toISOString(),
          }),
        }, true);
      } catch { /* tolerate */ }
    }

    return { ok: true, sub: user.email };
  } catch {
    await authFailureDelay();
    return { ok: false };
  }
}
