import { NextRequest, NextResponse } from 'next/server';
import { createToken, verifyToken, getTokenFromRequest, checkCredentials } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (verifyToken(getTokenFromRequest(req))) {
    return NextResponse.json({ valid: true });
  }
  return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'Identifiant et mot de passe requis' }, { status: 400 });
  }
  const result = await checkCredentials(username, password);
  if (result.ok) {
    return NextResponse.json({ token: createToken(result.sub) });
  }
  // Si le compte est verrouillé suite à des tentatives répétées, on remonte
  // 423 Locked + délai d'attente pour que le frontend affiche un message
  // explicite (au lieu d'un "identifiants incorrects" qui prête à confusion).
  if (result.lockedUntil) {
    const minutesRemaining = Math.max(1, Math.ceil((new Date(result.lockedUntil).getTime() - Date.now()) / 60_000));
    return NextResponse.json(
      { error: `Compte temporairement verrouillé suite à plusieurs tentatives échouées. Réessayez dans ${minutesRemaining} min.`, lockedUntil: result.lockedUntil },
      { status: 423 },
    );
  }
  return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 });
}
