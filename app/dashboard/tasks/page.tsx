'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';

interface Task {
  id: string;
  client_id: string;
  client_name: string;
  contact_name: string | null;
  client_status: string | null;
  text: string;
  done: boolean;
  due_date?: string;
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

type UrgencyFilter = 'all' | 'overdue' | 'today' | 'week' | 'nodate';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function endOfWeekStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + (7 - d.getDay()));
  return d.toISOString().slice(0, 10);
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

function isOverdue(t: Task): boolean {
  return !!t.due_date && !t.done && t.due_date < todayStr();
}

function isToday(t: Task): boolean {
  return !!t.due_date && !t.done && t.due_date === todayStr();
}

function isThisWeek(t: Task): boolean {
  if (!t.due_date || t.done) return false;
  const today = todayStr();
  const eow = endOfWeekStr();
  return t.due_date >= today && t.due_date <= eow;
}

function hasNoDate(t: Task): boolean {
  return !t.due_date && !t.done;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open');
  const [clientFilter, setClientFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [newText, setNewText] = useState('');
  const [newClient, setNewClient] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

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

  /* ---------- Derived data ---------- */

  const overdueTasks = useMemo(() => tasks.filter(t => isOverdue(t)), [tasks]);
  const overdueCount = overdueTasks.length;

  const filtered = useMemo(() => {
    let list = tasks;
    if (tab === 'open') list = list.filter(t => !t.done);
    else if (tab === 'done') list = list.filter(t => t.done);
    if (clientFilter) list = list.filter(t => t.client_id === clientFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(t => t.text.toLowerCase().includes(q) || t.client_name.toLowerCase().includes(q));

    // Urgency filter
    if (urgencyFilter === 'overdue') list = list.filter(t => isOverdue(t));
    else if (urgencyFilter === 'today') list = list.filter(t => isToday(t));
    else if (urgencyFilter === 'week') list = list.filter(t => isThisWeek(t));
    else if (urgencyFilter === 'nodate') list = list.filter(t => hasNoDate(t));

    return list;
  }, [tasks, tab, clientFilter, search, urgencyFilter]);

  const counts = useMemo(() => ({
    open: tasks.filter(t => !t.done).length,
    done: tasks.filter(t => t.done).length,
    all: tasks.length,
  }), [tasks]);

  const urgencyCounts = useMemo(() => ({
    overdue: tasks.filter(t => isOverdue(t)).length,
    today: tasks.filter(t => isToday(t)).length,
    week: tasks.filter(t => isThisWeek(t)).length,
    nodate: tasks.filter(t => hasNoDate(t)).length,
  }), [tasks]);

  // Group by client — when in "open" tab, sort tasks: overdue first, then upcoming (by date asc), then no-date
  const grouped = useMemo(() => {
    const g: Record<string, { client_name: string; client_id: string; client_status: string | null; tasks: Task[]; allTasks: Task[] }> = {};
    filtered.forEach(t => {
      if (!g[t.client_id]) g[t.client_id] = { client_name: t.client_name, client_id: t.client_id, client_status: t.client_status, tasks: [], allTasks: [] };
      g[t.client_id].tasks.push(t);
    });

    // Also gather all tasks per client (across all filters) for progress indicator
    tasks.forEach(t => {
      if (g[t.client_id]) {
        g[t.client_id].allTasks.push(t);
      }
    });

    const groups = Object.values(g).sort((a, b) => a.client_name.localeCompare(b.client_name));

    if (tab === 'open') {
      groups.forEach(group => {
        group.tasks.sort((a, b) => {
          const aOverdue = isOverdue(a);
          const bOverdue = isOverdue(b);
          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;

          const aHasDate = !!a.due_date;
          const bHasDate = !!b.due_date;
          if (aHasDate && !bHasDate) return -1;
          if (!aHasDate && bHasDate) return 1;
          if (aHasDate && bHasDate) return a.due_date!.localeCompare(b.due_date!);
          return 0;
        });
      });
    }

    return groups;
  }, [filtered, tasks, tab]);

  /* ---------- Actions ---------- */

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
        body: JSON.stringify({ client_id: newClient, text: newText.trim(), due_date: newDueDate || undefined }),
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
          due_date: data.task.due_date || undefined,
          created_at: data.task.created_at,
        }, ...prev]);
        setNewText('');
        setNewDueDate('');
        // Return focus to the text input after adding
        setTimeout(() => textInputRef.current?.focus(), 50);
      }
    } catch { /* */ } finally {
      setAdding(false);
    }
  }

  /* ---------- Sub-components ---------- */

  function ProgressBar({ completed, total }: { completed: number; total: number }) {
    const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 48, height: 4, borderRadius: 2,
          background: 'var(--night-mid)', overflow: 'hidden', flexShrink: 0,
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${pct}%`,
            background: pct === 100 ? 'var(--green)' : 'var(--orange)',
            transition: 'width .3s ease',
          }} />
        </div>
        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {completed}/{total}
        </span>
      </div>
    );
  }

  /* ---------- Render ---------- */

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 14, fontSize: '0.72rem', fontWeight: 600,
    border: active ? '1px solid var(--orange)' : '1px solid var(--border-md)',
    background: active ? 'rgba(232,105,43,.12)' : 'transparent',
    color: active ? 'var(--orange)' : 'var(--text-muted)',
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s ease',
  });

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
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

      {/* Overdue summary banner */}
      {overdueCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', marginBottom: 14, borderRadius: 8,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--red)' }}>!</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--red)', flex: 1 }}>
            {overdueCount} tâche{overdueCount > 1 ? 's' : ''} en retard
          </span>
          <button
            onClick={() => { setTab('open'); setUrgencyFilter('overdue'); }}
            style={{
              fontSize: '0.72rem', fontWeight: 600, color: 'var(--red)',
              background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 2, padding: 0,
            }}
          >
            Voir
          </button>
        </div>
      )}

      {/* Compact add task form — single line */}
      <form onSubmit={addTask} style={{
        display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center',
        background: 'var(--night-card)', padding: '6px 8px', borderRadius: 10,
        border: '1px solid var(--border)',
      }}>
        <select
          value={newClient}
          onChange={e => setNewClient(e.target.value)}
          required
          style={{
            padding: '7px 10px', borderRadius: 6,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.8rem', minWidth: 160, outline: 'none',
          }}
        >
          <option value="">Client</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
        </select>
        <input
          ref={textInputRef}
          type="text"
          placeholder="Nouvelle tâche…"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          required
          style={{
            flex: 1, minWidth: 180, padding: '7px 10px', borderRadius: 6,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.8rem', outline: 'none',
          }}
        />
        <input
          type="date"
          value={newDueDate}
          onChange={e => setNewDueDate(e.target.value)}
          title="Deadline (optionnel)"
          style={{
            padding: '7px 10px', borderRadius: 6,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.78rem', outline: 'none',
            colorScheme: 'dark',
          }}
        />
        <button
          type="submit"
          disabled={adding || !newText.trim() || !newClient}
          style={{
            padding: '7px 14px', borderRadius: 6,
            background: 'var(--orange)', border: 'none',
            color: '#000', fontSize: '0.8rem', fontWeight: 600,
            cursor: adding || !newText.trim() || !newClient ? 'not-allowed' : 'pointer',
            opacity: adding || !newText.trim() || !newClient ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {adding ? '…' : '+ Ajouter'}
        </button>
      </form>

      {/* Tabs + filters row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['open', 'done', 'all'] as const).map(k => (
          <button
            key={k}
            onClick={() => { setTab(k); setUrgencyFilter('all'); }}
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

      {/* Quick filter chips for urgency */}
      {tab === 'open' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {([
            { key: 'all' as UrgencyFilter, label: 'Toutes' },
            { key: 'overdue' as UrgencyFilter, label: 'En retard', count: urgencyCounts.overdue, color: 'var(--red)' },
            { key: 'today' as UrgencyFilter, label: "Aujourd'hui", count: urgencyCounts.today, color: 'var(--yellow)' },
            { key: 'week' as UrgencyFilter, label: 'Cette semaine', count: urgencyCounts.week },
            { key: 'nodate' as UrgencyFilter, label: 'Sans date', count: urgencyCounts.nodate },
          ]).map(chip => (
            <button
              key={chip.key}
              onClick={() => setUrgencyFilter(urgencyFilter === chip.key ? 'all' : chip.key)}
              style={{
                ...chipStyle(urgencyFilter === chip.key),
                ...(urgencyFilter === chip.key && chip.color ? {
                  borderColor: chip.color, color: chip.color,
                  background: `${chip.color}14`,
                } : {}),
              }}
            >
              {chip.label}{chip.count !== undefined ? ` · ${chip.count}` : ''}
            </button>
          ))}
        </div>
      )}

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
          <div style={{
            width: 44, height: 44, margin: '0 auto 14px', borderRadius: 10,
            background: 'var(--night-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.1rem', color: 'var(--text-muted)',
          }}>
            {tab === 'done' ? '/' : urgencyFilter !== 'all' ? '~' : '--'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {urgencyFilter === 'overdue' ? 'Aucune tâche en retard'
              : urgencyFilter === 'today' ? "Aucune tâche pour aujourd'hui"
              : urgencyFilter === 'week' ? 'Aucune tâche cette semaine'
              : urgencyFilter === 'nodate' ? 'Aucune tâche sans date'
              : tab === 'open' ? 'Aucune tâche en cours'
              : tab === 'done' ? 'Aucune tâche terminée'
              : 'Aucune tâche'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {grouped.map(group => {
            const completedCount = group.allTasks.filter(t => t.done).length;
            const totalCount = group.allTasks.length;
            return (
              <div key={group.client_id} style={{
                background: 'var(--night-card)', borderRadius: 12,
                border: '1px solid var(--border)',
                overflow: 'hidden',
              }}>
                {/* Client group header */}
                <div style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10,
                }}>
                  <Link href={`/dashboard/clients/${group.client_id}`} style={{
                    fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)',
                    textDecoration: 'none',
                  }}>
                    {group.client_name}
                  </Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Progress bar */}
                    <ProgressBar completed={completedCount} total={totalCount} />
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
                {/* Task list */}
                <div style={{ padding: 6 }}>
                  {group.tasks.map(t => (
                    <div key={t.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px', borderRadius: 8,
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
                      {t.due_date && !t.done && (() => {
                        const today = todayStr();
                        const overdueFlag = t.due_date! < today;
                        const todayFlag = t.due_date === today;
                        const isSoon = !overdueFlag && !todayFlag &&
                          (new Date(t.due_date!).getTime() - Date.now()) < 3 * 86400000;
                        return (
                          <span style={{
                            fontSize: '0.66rem', padding: '2px 7px', borderRadius: 8,
                            fontWeight: 600, whiteSpace: 'nowrap',
                            background: overdueFlag ? 'rgba(239,68,68,.12)' : todayFlag ? 'rgba(250,204,21,.12)' : isSoon ? 'rgba(59,130,246,.1)' : 'var(--night-mid)',
                            color: overdueFlag ? 'var(--red)' : todayFlag ? 'var(--yellow)' : isSoon ? '#3B82F6' : 'var(--text-muted)',
                          }}>
                            {overdueFlag ? '! ' : ''}{new Date(t.due_date!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                        );
                      })()}
                      {t.due_date && t.done && (
                        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                          {new Date(t.due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {!t.due_date && (
                        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                          {relativeDate(t.created_at)}
                        </span>
                      )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
