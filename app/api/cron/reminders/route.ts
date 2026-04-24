import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { notifyClientStatusChange } from '@/lib/slack';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const r = await supaFetch('clients?status=neq.published&select=id,business_name,contact_name,status,updated_at,created_at,filming_date', {}, true);
    if (!r.ok) return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });

    const clients = await r.json();
    const now = Date.now();
    const alerts: string[] = [];

    for (const c of clients) {
      const lastMs = c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime();
      const daysIdle = Math.floor((now - lastMs) / 86400000);

      if (c.status === 'script_review' && daysIdle > 3) {
        alerts.push(`⏳ ${c.business_name} — script en relecture depuis ${daysIdle} j`);
        notifyClientStatusChange(c.business_name, c.status, `Script en relecture depuis ${daysIdle} jours — relance recommandée`);
      } else if (daysIdle > 14) {
        alerts.push(`🔴 ${c.business_name} — aucune activité depuis ${daysIdle} j`);
        notifyClientStatusChange(c.business_name, c.status, `Aucune activité depuis ${daysIdle} jours`);
      }

      if (c.filming_date) {
        const daysToFilming = Math.ceil((new Date(c.filming_date).getTime() - now) / 86400000);
        if (daysToFilming >= 0 && daysToFilming <= 2 && c.status !== 'filming_done' && c.status !== 'editing') {
          const label = daysToFilming === 0 ? "aujourd'hui" : daysToFilming === 1 ? 'demain' : `dans ${daysToFilming} j`;
          alerts.push(`🎬 ${c.business_name} — tournage ${label}`);
          notifyClientStatusChange(c.business_name, c.status, `Tournage ${label}`);
        }
      }
    }

    return NextResponse.json({ checked: clients.length, alerts });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
