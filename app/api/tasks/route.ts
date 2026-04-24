import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

interface ClientWithTodos {
  id: string;
  business_name: string;
  contact_name: string | null;
  status: string | null;
  todos: TodoItem[] | null;
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const r = await supaFetch(
      'clients?select=id,business_name,contact_name,status,todos&todos=not.eq.[]',
      {},
      true
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
    const clients: ClientWithTodos[] = await r.json();

    const tasks: Array<{
      id: string;
      client_id: string;
      client_name: string;
      contact_name: string | null;
      client_status: string | null;
      text: string;
      done: boolean;
      created_at: string;
    }> = [];

    for (const c of clients) {
      const todos = Array.isArray(c.todos) ? c.todos : [];
      for (const t of todos) {
        if (!t || typeof t !== 'object') continue;
        tasks.push({
          id: t.id,
          client_id: c.id,
          client_name: c.business_name,
          contact_name: c.contact_name,
          client_status: c.status,
          text: t.text,
          done: !!t.done,
          created_at: t.created_at,
        });
      }
    }

    tasks.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

    return NextResponse.json(tasks);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { client_id, text } = await req.json();
    if (!client_id || !text) return NextResponse.json({ error: 'client_id et text requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${client_id}&select=todos`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const todos: TodoItem[] = Array.isArray(data[0].todos) ? data[0].todos : [];
    const newTodo: TodoItem = {
      id: crypto.randomUUID(),
      text: String(text).slice(0, 500),
      done: false,
      created_at: new Date().toISOString(),
    };
    todos.unshift(newTodo);

    const ur = await supaFetch(`clients?id=eq.${client_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ todos, updated_at: new Date().toISOString() }),
    }, true);
    if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });

    return NextResponse.json({ ok: true, task: newTodo });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const { client_id, task_id, done } = await req.json();
    if (!client_id || !task_id) return NextResponse.json({ error: 'client_id et task_id requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${client_id}&select=todos`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const todos: TodoItem[] = Array.isArray(data[0].todos) ? data[0].todos : [];
    const updated = todos.map(t => t.id === task_id ? { ...t, done: !!done } : t);

    const ur = await supaFetch(`clients?id=eq.${client_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ todos: updated, updated_at: new Date().toISOString() }),
    }, true);
    if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const client_id = req.nextUrl.searchParams.get('client_id');
    const task_id = req.nextUrl.searchParams.get('task_id');
    if (!client_id || !task_id) return NextResponse.json({ error: 'client_id et task_id requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${client_id}&select=todos`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const todos: TodoItem[] = Array.isArray(data[0].todos) ? data[0].todos : [];
    const filtered = todos.filter(t => t.id !== task_id);

    const ur = await supaFetch(`clients?id=eq.${client_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ todos: filtered, updated_at: new Date().toISOString() }),
    }, true);
    if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
