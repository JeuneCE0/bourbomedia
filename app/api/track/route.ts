import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const { id, vid } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const ua = req.headers.get('user-agent') || 'unknown';
    const visitorId = vid || crypto.createHash('sha256').update(ip + ua).digest('hex').slice(0, 16);

    const headers = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_click`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project_id: id }),
    });

    await fetch(`${SUPABASE_URL}/rest/v1/project_clicks?order=created_at.desc&limit=1&project_id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ visitor_id: visitorId }),
    });

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
