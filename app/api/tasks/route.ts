import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high';
  notes?: string;
  created_at: string;
  updated_at?: string;
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
      due_date?: string;
      priority?: 'low' | 'medium' | 'high';
      notes?: string;
      created_at: string;
      updated_at?: string;
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
          due_date: t.due_date || undefined,
          priority: (['low', 'medium', 'high'] as const).includes(t.priority as 'low' | 'medium' | 'high') ? t.priority : 'medium',
          notes: t.notes || undefined,
          created_at: t.created_at,
          updated_at: t.updated_at,
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
    const { client_id, text, due_date, priority, notes } = await req.json();
    if (!client_id || !text) return NextResponse.json({ error: 'client_id et text requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${client_id}&select=todos`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const todos: TodoItem[] = Array.isArray(data[0].todos) ? data[0].todos : [];
    const validPriority: TodoItem['priority'] = (['low', 'medium', 'high'] as const).includes(priority) ? priority : 'medium';
    const newTodo: TodoItem = {
      id: crypto.randomUUID(),
      text: String(text).slice(0, 500),
      done: false,
      due_date: due_date || undefined,
      priority: validPriority,
      notes: notes ? String(notes).slice(0, 2000) : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
    const body = await req.json();
    const { client_id, task_id } = body;
    if (!client_id || !task_id) return NextResponse.json({ error: 'client_id et task_id requis' }, { status: 400 });

    const cr = await supaFetch(`clients?id=eq.${client_id}&select=todos`, {}, true);
    if (!cr.ok) return NextResponse.json({ error: await cr.text() }, { status: cr.status });
    const data = await cr.json();
    if (!data.length) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

    const todos: TodoItem[] = Array.isArray(data[0].todos) ? data[0].todos : [];

    // Bulk action: mark every task done / clear all done tasks for this client
    if (body.bulk === 'mark_all_done') {
      const updated = todos.map(t => ({ ...t, done: true, updated_at: new Date().toISOString() }));
      const ur = await supaFetch(`clients?id=eq.${client_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ todos: updated, updated_at: new Date().toISOString() }),
      }, true);
      if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });
      return NextResponse.json({ ok: true, count: updated.length });
    }
    if (body.bulk === 'clear_done') {
      const remaining = todos.filter(t => !t.done);
      const ur = await supaFetch(`clients?id=eq.${client_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ todos: remaining, updated_at: new Date().toISOString() }),
      }, true);
      if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });
      return NextResponse.json({ ok: true, removed: todos.length - remaining.length });
    }

    // Single-task patch — accept any subset of editable fields
    const updated = todos.map(t => {
      if (t.id !== task_id) return t;
      const next: TodoItem = { ...t, updated_at: new Date().toISOString() };
      if (typeof body.done === 'boolean') next.done = body.done;
      if (typeof body.text === 'string') next.text = body.text.slice(0, 500);
      if (typeof body.due_date === 'string' || body.due_date === null) next.due_date = body.due_date || undefined;
      if (['low', 'medium', 'high'].includes(body.priority)) next.priority = body.priority;
      if (typeof body.notes === 'string' || body.notes === null) next.notes = body.notes || undefined;
      return next;
    });

    const ur = await supaFetch(`clients?id=eq.${client_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ todos: updated, updated_at: new Date().toISOString() }),
    }, true);
    if (!ur.ok) return NextResponse.json({ error: await ur.text() }, { status: ur.status });

    return NextResponse.json({ ok: true, task: updated.find(t => t.id === task_id) });
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
