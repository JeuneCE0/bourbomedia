import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hashPassword } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const r = await supaFetch('saas_users?select=id,email,name,role,active,created_at&order=created_at.desc', {}, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { email, password, name, role } = await req.json();
    if (!email || !password || !name) return NextResponse.json({ error: 'email, password et name requis' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'Minimum 6 caractères' }, { status: 400 });

    const r = await supaFetch('saas_users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password_hash: hashPassword(password),
        name,
        role: role || 'editor',
      }),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    const { password_hash: _, ...user } = data[0];
    return NextResponse.json(user, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id, password, ...fields } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const updateFields: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    if (password) {
      if (password.length < 6) return NextResponse.json({ error: 'Minimum 6 caractères' }, { status: 400 });
      updateFields.password_hash = hashPassword(password);
    }

    const r = await supaFetch(`saas_users?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateFields),
    }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const data = await r.json();
    const { password_hash: _, ...user } = data[0];
    return NextResponse.json(user);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });
    const r = await supaFetch(`saas_users?id=eq.${id}`, { method: 'DELETE' }, true);
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
