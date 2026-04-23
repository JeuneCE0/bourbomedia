import { NextRequest, NextResponse } from 'next/server';
import { createToken, verifyToken, getTokenFromRequest, checkCredentials } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (verifyToken(getTokenFromRequest(req))) {
    return NextResponse.json({ valid: true });
  }
  return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Admin password not configured' }, { status: 500 });
  }
  const { username, password } = await req.json();
  if (checkCredentials(username, password)) {
    return NextResponse.json({ token: createToken() });
  }
  return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 });
}
