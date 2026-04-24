'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';

interface Task {
  id: string;
  client_id: string;
  client_name: string;
  contact_name: string | null;
  client_status: string | null;
  text: string;
  done: boolean;
  created_at: string;
}

interface ClientLite {
  id: string;
  business_name: string;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture script',
  script_review: 'Relecture',
  script_validated: 'Validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tourné',
  editing: 'Montage',
  published: 'Livré',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeDate(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days} j`;
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open');
  const [clientFilter, setClientFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [newText, setNewText] = useState('');
  const [newClient, setNewClient] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    fetch('/api/tasks', { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error('Erreur de chargement');
        return r.json();
      })
      .then((d: Task[]) => setTasks(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTasks();
    fetch('/api/clients', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((d: ClientLite[]) => {
        if (Array.isArray(d)) setClients(d.map(c => ({ id: c.id, business_name: c.business_name })));
      })
      .catch(() => {});
  }, [loadTasks]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (tab === 'open') list = list.filter(t => !t.done);
    else if (tab === 'done') list = list.filter(t => t.done);
    if (clientFilter) list = list.filter(t => t.client_id === clientFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(t => t.text.toLowerCase().includes(q) || t.client_name.toLowerCase().includes(q));
    return list;
  }, [tasks, tab, clientFilter, search]);

  const counts = useMemo(() => ({
    open: tasks.filter(t => !t.done).length,
    done: tasks.filter(t => t.done).length,
    all: tasks.length,
  }), [tasks]);

  // Group by client for open tab
  const grouped = useMemo(() => {
    const g: Record<string, { client_name: string; client_id: string; client_status: string | null; tasks: Task[] }> = {};
    filtered.forEach(t => {
      if (!g[t.client_id]) g[t.client_id] = { client_name: t.client_name, client_id: t.client_id, client_status: t.client_status, tasks: [] };
      g[t.client_id].tasks.push(t);
    });
    return Object.values(g).sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [filtered]);

  async function toggleTask(t: Task) {
    setBusy(t.id);
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ client_id: t.client_id, task_id: t.id, done: !t.done }),
      });
    } catch { /* */ } finally {
      setBusy(null);
    }
  }

  async function deleteTask(t: Task) {
    if (!confirm('Supprimer cette tâche ?')) return;
    setBusy(t.id);
    try {
      const r = await fetch(`/api/tasks?client_id=${t.client_id}&task_id=${t.id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (r.ok) setTasks(prev => prev.filter(x => x.id !== t.id));
    } catch { /* */ } finally {
      setBusy(null);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim() || !newClient) return;
    setAdding(true);
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ client_id: newClient, text: newText.trim() }),
      });
      if (r.ok) {
        const data = await r.json();
        const c = clients.find(x => x.id === newClient);
        setTasks(prev => [{
          id: data.task.id,
          client_id: newClient,
          client_name: c?.business_name || '',
          contact_name: null,
          client_status: null,
          text: data.task.text,
          done: false,
          created_at: data.task.created_at,
        }, ...prev]);
        setNewText('');
      }
    } catch { /* */ } finally {
      setAdding(false);
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800, fontSize: '1.75rem', color: 'var(--text)',
          margin: 0, lineHeight: 1.2,
        }}>
          Tâches
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
          To-do par client — toutes les tâches en un coup d&apos;œil
        </p>
      </div>

      {/* Add task form */}
      <form onSubmit={addTask} style={{
        display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap',
        background: 'var(--night-card)', padding: 12, borderRadius: 12,
        border: '1px solid var(--border)',
      }}>
        <select
          value={newClient}
          onChange={e => setNewClient(e.target.value)}
          required
          style={{
            padding: '9px 12px', borderRadius: 8,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.85rem', minWidth: 200, outline: 'none',
          }}
        >
          <option value="">— Client —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
        </select>
        <input
          type="text"
          placeholder="Nouvelle tâche…"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          required
          style={{
            flex: 1, minWidth: 200, padding: '9px 12px', borderRadius: 8,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={adding || !newText.trim() || !newClient}
          style={{
            padding: '9px 18px', borderRadius: 8,
            background: 'var(--orange)', border: 'none',
            color: '#000', fontSize: '0.85rem', fontWeight: 600,
            cursor: adding || !newText.trim() || !newClient ? 'not-allowed' : 'pointer',
            opacity: adding || !newText.trim() || !newClient ? 0.5 : 1,
          }}
        >
          {adding ? '…' : 'Ajouter'}
        </button>
      </form>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['open', 'done', 'all'] as const).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: '8px 14px', borderRadius: 20,
              background: tab === k ? 'var(--orange)' : 'var(--night-card)',
              border: tab === k ? 'none' : '1px solid var(--border-md)',
              color: tab === k ? '#000' : 'var(--text-mid)',
              fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {k === 'open' ? 'À faire' : k === 'done' ? 'Terminées' : 'Toutes'} · {counts[k]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.8rem', outline: 'none',
          }}
        >
          <option value="">Tous les clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
        </select>
        <input
          type="text"
          placeholder="Rechercher…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.8rem', outline: 'none',
            minWidth: 160,
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)', fontSize: '0.85rem', marginBottom: 16,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '40px 0', textAlign: 'center' }}>
          Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '60px 20px', textAlign: 'center',
          background: 'var(--night-card)', borderRadius: 12,
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.3 }}>☑</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {tab === 'open' ? 'Aucune tâche en cours' : tab === 'done' ? 'Aucune tâche terminée' : 'Aucune tâche'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grouped.map(group => (
            <div key={group.client_id} style={{
              background: 'var(--night-card)', borderRadius: 12,
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10,
              }}>
                <Link href={`/dashboard/clients/${group.client_id}`} style={{
                  fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)',
                  textDecoration: 'none',
                }}>
                  {group.client_name}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {group.client_status && (
                    <span style={{
                      fontSize: '0.66rem', padding: '3px 8px', borderRadius: 12,
                      background: 'var(--night-mid)', color: 'var(--text-muted)',
                      fontWeight: 600,
                    }}>
                      {STATUS_LABELS[group.client_status] || group.client_status}
                    </span>
                  )}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {group.tasks.length} tâche{group.tasks.length > 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div style={{ padding: 8 }}>
                {group.tasks.map(t => (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    opacity: busy === t.id ? 0.5 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => toggleTask(t)}
                      style={{ accentColor: 'var(--orange)', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{
                      flex: 1, fontSize: '0.85rem',
                      color: t.done ? 'var(--text-muted)' : 'var(--text)',
                      textDecoration: t.done ? 'line-through' : 'none',
                    }}>
                      {t.text}
                    </span>
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                      {relativeDate(t.created_at)}
                    </span>
                    <button
                      onClick={() => deleteTask(t)}
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        padding: '2px 6px', fontSize: '0.85rem',
                      }}
                      title="Supprimer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
