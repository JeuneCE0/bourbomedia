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
  return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 });
}
