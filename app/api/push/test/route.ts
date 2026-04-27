import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sendPushToAll } from '@/lib/push';

// POST /api/push/test
//   Sends a test push to all subscribed devices. Used by the "Tester" button
//   in settings / dashboard to verify the pipeline works end-to-end.
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const result = await sendPushToAll({
    title: '🌊 Bourbomedia',
    body: 'Notification de test — tout fonctionne !',
    url: '/dashboard',
    tag: 'push-test',
  });
  return NextResponse.json(result);
}
