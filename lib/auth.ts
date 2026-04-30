import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { supaFetch } from '@/lib/supabase';

const SECRET = process.env.ADMIN_SECRET || 'bourbomedia-secret-change-me';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '';

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

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Login flow accepts two sources :
//  1. Le couple ADMIN_USERNAME / ADMIN_PASSWORD (env) — compte master historique.
//  2. Toute ligne active de saas_users dont le password_hash matche — comptes
//     créés via /dashboard/settings pour les membres de l'équipe.
// L'API /api/users POST stockait déjà les comptes équipe dans saas_users mais
// /api/auth ne consultait que les variables d'env, ce qui faisait que les
// identifiants d'équipe étaient acceptés à la création mais refusés au login.
export async function checkCredentials(username: string, password: string): Promise<{ ok: boolean; sub?: string }> {
  if (ADMIN_PASS && username === ADMIN_USER && password === ADMIN_PASS) {
    return { ok: true, sub: ADMIN_USER };
  }

  try {
    const r = await supaFetch(
      `saas_users?email=eq.${encodeURIComponent(username)}&active=eq.true&select=id,email,password_hash`,
      {},
      true,
    );
    if (!r.ok) return { ok: false };
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false };
    const user = rows[0];
    const expected = Buffer.from(user.password_hash, 'hex');
    const provided = Buffer.from(hashPassword(password), 'hex');
    if (expected.length !== provided.length) return { ok: false };
    if (!crypto.timingSafeEqual(expected, provided)) return { ok: false };
    return { ok: true, sub: user.email };
  } catch {
    return { ok: false };
  }
}
