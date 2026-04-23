import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

function rpcHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const action = req.nextUrl.searchParams.get('action');

  if (action === 'clicks') {
    try {
      const fromDate = req.nextUrl.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString();
      const toDate = req.nextUrl.searchParams.get('to') || new Date().toISOString();
      const dateParams = { from_date: fromDate, to_date: toDate };

      const [r1, r2, r3, r4] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/rpc/clicks_by_day`, { method: 'POST', headers: rpcHeaders(), body: JSON.stringify(dateParams) }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/clicks_by_project`, { method: 'POST', headers: rpcHeaders(), body: JSON.stringify(dateParams) }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/clicks_by_category`, { method: 'POST', headers: rpcHeaders(), body: JSON.stringify(dateParams) }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/clicks_by_city`, { method: 'POST', headers: rpcHeaders(), body: JSON.stringify(dateParams) }),
      ]);

      const byDay = r1.ok ? await r1.json() : [];
      const byProject = r2.ok ? await r2.json() : [];
      const byCat = r3.ok ? await r3.json() : [];
      const byCity = r4.ok ? await r4.json() : [];

      const r5 = await fetch(`${SUPABASE_URL}/rest/v1/project_clicks?select=id&created_at=gte.${fromDate}&created_at=lte.${toDate}`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' },
      });
      const todayCount = parseInt((r5.headers.get('content-range') || '0/0').split('/')[1], 10) || 0;

      const r6 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/unique_visitors`, {
        method: 'POST', headers: rpcHeaders(), body: JSON.stringify(dateParams),
      });
      const uniqueCount = r6.ok ? await r6.json() : 0;

      return NextResponse.json({ byDay, byProject, byCat, byCity, total: todayCount, unique: uniqueCount });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === 'logs') {
    try {
      const r = await supaFetch('admin_logs?select=*&order=created_at.desc&limit=50');
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      return NextResponse.json(await r.json());
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === 'settings') {
    try {
      const r = await supaFetch('site_settings?select=key,value');
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      return NextResponse.json(await r.json());
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const action = req.nextUrl.searchParams.get('action');

  if (action === 'log') {
    try {
      const { logAction, project_id, project_name, details } = await req.json();
      await supaFetch('admin_logs', {
        method: 'POST',
        body: JSON.stringify({ action: logAction, project_id, project_name, details }),
      }, true);
      return NextResponse.json({ success: true });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === 'password') {
    const { current, newPassword } = await req.json();
    if (!current || !newPassword) return NextResponse.json({ error: 'Champs requis' }, { status: 400 });
    if (current !== process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 401 });
    if (newPassword.length < 6) return NextResponse.json({ error: 'Minimum 6 caractères' }, { status: 400 });
    return NextResponse.json({
      success: false,
      message: 'Pour changer le mot de passe, mettez à jour la variable ADMIN_PASSWORD dans Vercel Dashboard > Settings > Environment Variables, puis redéployez.',
    });
  }

  if (action === 'bulk') {
    const { ids, operation, value } = await req.json();
    if (!ids || !ids.length || !operation) return NextResponse.json({ error: 'ids et operation requis' }, { status: 400 });

    try {
      if (operation === 'delete') {
        const idFilter = ids.map((id: string) => `"${id}"`).join(',');
        const r = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=in.(${idFilter})`, {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
        });
        if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      } else if (operation === 'status') {
        const idFilter = ids.map((id: string) => `"${id}"`).join(',');
        const r = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=in.(${idFilter})`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ status: value || 'published' }),
        });
        if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
      } else if (operation === 'reorder') {
        for (const item of (value || [])) {
          await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${item.id}`, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ display_order: item.display_order }),
          });
        }
      }
      return NextResponse.json({ success: true });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === 'settings') {
    try {
      const { settings } = await req.json();
      if (!settings || !Array.isArray(settings)) return NextResponse.json({ error: 'settings array requis' }, { status: 400 });
      for (const s of settings) {
        await fetch(`${SUPABASE_URL}/rest/v1/site_settings?key=eq.${s.key}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ value: String(s.value), updated_at: new Date().toISOString() }),
        });
      }
      return NextResponse.json({ success: true });
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
