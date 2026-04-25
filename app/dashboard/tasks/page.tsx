'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';

type Priority = 'low' | 'medium' | 'high';

interface Task {
  id: string;
  client_id: string;
  client_name: string;
  contact_name: string | null;
  client_status: string | null;
  text: string;
  done: boolean;
  due_date?: string;
  priority?: Priority;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

interface ClientLite {
  id: string;
  business_name: string;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture',
  script_review: 'Relecture',
  script_validated: 'Validé',
  filming_scheduled: 'Tournage',
  filming_done: 'Tourné',
  editing: 'Montage',
  published: 'Livré',
};

const PRIORITY_META: Record<Priority, { emoji: string; label: string; color: string; rank: number }> = {
  high:   { emoji: '🔴', label: 'Haute',  color: '#EF4444', rank: 0 },
  medium: { emoji: '🟡', label: 'Moyenne', color: '#FACC15', rank: 1 },
  low:    { emoji: '🟢', label: 'Basse',  color: '#22C55E', rank: 2 },
};

type UrgencyFilter = 'all' | 'overdue' | 'today' | 'week' | 'nodate' | 'high';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endOfWeekStr(): string {
  const d = new Date();
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // Mon=1..Sun=7
  d.setDate(d.getDate() + (7 - dayOfWeek));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inDaysStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function formatDateBadge(dueDate: string): string {
  const today = todayStr();
  const tomorrow = tomorrowStr();
  if (dueDate === today) return "Aujourd'hui";
  if (dueDate === tomorrow) return 'Demain';
  if (dueDate < today) {
    const diff = Math.ceil((Date.now() - new Date(dueDate).getTime()) / 86400000);
    return `Il y a ${diff} j`;
  }
  return new Date(dueDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
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
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ text: string; due_date: string; priority: Priority; notes: string }>({ text: '', due_date: '', priority: 'medium', notes: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    if (q) list = list.filter(t => t.text.toLowerCase().includes(q) || t.client_name.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q));

    if (urgencyFilter === 'overdue') list = list.filter(t => isOverdue(t));
    else if (urgencyFilter === 'today') list = list.filter(t => isToday(t));
    else if (urgencyFilter === 'week') list = list.filter(t => isThisWeek(t));
    else if (urgencyFilter === 'nodate') list = list.filter(t => hasNoDate(t));
    else if (urgencyFilter === 'high') list = list.filter(t => (t.priority || 'medium') === 'high' && !t.done);

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
    high: tasks.filter(t => (t.priority || 'medium') === 'high' && !t.done).length,
  }), [tasks]);

  const grouped = useMemo(() => {
    const g: Record<string, { client_name: string; client_id: string; client_status: string | null; tasks: Task[]; allTasks: Task[] }> = {};
    filtered.forEach(t => {
      if (!g[t.client_id]) g[t.client_id] = { client_name: t.client_name, client_id: t.client_id, client_status: t.client_status, tasks: [], allTasks: [] };
      g[t.client_id].tasks.push(t);
    });

    tasks.forEach(t => {
      if (g[t.client_id]) g[t.client_id].allTasks.push(t);
    });

    const groups = Object.values(g).sort((a, b) => a.client_name.localeCompare(b.client_name));

    if (tab === 'open') {
      groups.forEach(group => {
        group.tasks.sort((a, b) => {
          // Priority first, then overdue, then due date asc, then no-date last
          const pA = PRIORITY_META[a.priority || 'medium'].rank;
          const pB = PRIORITY_META[b.priority || 'medium'].rank;
          if (pA !== pB) return pA - pB;
          const aOverdue = isOverdue(a);
          const bOverdue = isOverdue(b);
          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date && !b.due_date) return -1;
          if (!a.due_date && b.due_date) return 1;
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
      const r = await fetch('/api/tasks', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ client_id: t.client_id, task_id: t.id, done: !t.done }),
      });
      if (!r.ok) throw new Error('rollback');
    } catch {
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: t.done } : x));
    } finally { setBusy(null); }
  }

  async function deleteTask(t: Task) {
    if (!confirm(`Supprimer la tâche « ${t.text.slice(0, 60)}${t.text.length > 60 ? '…' : ''} » ?`)) return;
    setBusy(t.id);
    const snapshot = tasks;
    setTasks(prev => prev.filter(x => x.id !== t.id));
    try {
      const r = await fetch(`/api/tasks?client_id=${t.client_id}&task_id=${t.id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (!r.ok) throw new Error('rollback');
    } catch { setTasks(snapshot); }
    finally { setBusy(null); }
  }

  async function patchTask(t: Task, fields: Partial<Pick<Task, 'text' | 'due_date' | 'priority' | 'notes' | 'done'>>) {
    setBusy(t.id);
    const snapshot = tasks;
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, ...fields } : x));
    try {
      const r = await fetch('/api/tasks', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ client_id: t.client_id, task_id: t.id, ...fields }),
      });
      if (!r.ok) throw new Error('rollback');
    } catch { setTasks(snapshot); }
    finally { setBusy(null); }
  }

  async function bulkClearDone(clientId: string) {
    if (!confirm('Supprimer toutes les tâches terminées de ce client ?')) return;
    const snapshot = tasks;
    setTasks(prev => prev.filter(t => !(t.client_id === clientId && t.done)));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ client_id: clientId, task_id: '_bulk', bulk: 'clear_done' }),
      });
    } catch { setTasks(snapshot); }
  }

  async function bulkMarkAllDone(clientId: string) {
    if (!confirm('Marquer toutes les tâches de ce client comme terminées ?')) return;
    const snapshot = tasks;
    setTasks(prev => prev.map(t => t.client_id === clientId ? { ...t, done: true } : t));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ client_id: clientId, task_id: '_bulk', bulk: 'mark_all_done' }),
      });
    } catch { setTasks(snapshot); }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim() || !newClient) return;
    setAdding(true);
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          client_id: newClient,
          text: newText.trim(),
          due_date: newDueDate || undefined,
          priority: newPriority,
        }),
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
          priority: data.task.priority || newPriority,
          notes: data.task.notes,
          created_at: data.task.created_at,
        }, ...prev]);
        setNewText('');
        setNewDueDate('');
        setNewPriority('medium');
        setTimeout(() => textInputRef.current?.focus(), 50);
      }
    } catch { /* */ } finally { setAdding(false); }
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setEditDraft({
      text: t.text,
      due_date: t.due_date || '',
      priority: t.priority || 'medium',
      notes: t.notes || '',
    });
  }

  async function saveEdit(t: Task) {
    await patchTask(t, {
      text: editDraft.text.trim() || t.text,
      due_date: editDraft.due_date || undefined,
      priority: editDraft.priority,
      notes: editDraft.notes.trim() || undefined,
    });
    setEditingId(null);
  }

  /* ---------- Render ---------- */

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600,
    border: active ? '1px solid var(--orange)' : '1px solid var(--border-md)',
    background: active ? 'rgba(232,105,43,.12)' : 'transparent',
    color: active ? 'var(--orange)' : 'var(--text-muted)',
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s ease',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  const quickDateBtn = (label: string, value: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 14, fontSize: '0.7rem', fontWeight: 600,
    background: newDueDate === value ? 'rgba(232,105,43,.18)' : 'var(--night-mid)',
    color: newDueDate === value ? 'var(--orange)' : 'var(--text-muted)',
    border: newDueDate === value ? '1px solid var(--border-orange)' : '1px solid transparent',
    cursor: 'pointer',
  });
  void quickDateBtn; // typed style helper used below

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800, fontSize: '1.75rem', color: 'var(--text)',
            margin: 0, lineHeight: 1.2,
          }}>
            ✅ Tâches
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Avec deadlines, priorités et édition inline. Cliquez une tâche pour l&apos;éditer.
          </p>
        </div>
        {overdueCount > 0 && (
          <button
            onClick={() => { setTab('open'); setUrgencyFilter('overdue'); }}
            style={{
              padding: '8px 14px', borderRadius: 10,
              background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.4)',
              color: '#FCA5A5', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span aria-hidden>⚠️</span> {overdueCount} en retard
          </button>
        )}
      </div>

      {/* Add task form — bigger, with quick deadline pills + priority */}
      <div style={{
        marginBottom: 18, padding: '14px 16px', borderRadius: 12,
        background: 'var(--night-card)', border: '1px solid var(--border)',
      }}>
        <form onSubmit={addTask}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <select
              value={newClient}
              onChange={e => setNewClient(e.target.value)}
              required
              style={{
                padding: '9px 12px', borderRadius: 8,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.85rem', minWidth: 200, outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="">👤 Client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
            </select>
            <input
              ref={textInputRef}
              type="text"
              placeholder="Nouvelle tâche (ex: Rappeler pour confirmer la date de tournage)"
              value={newText}
              onChange={e => setNewText(e.target.value)}
              required
              style={{
                flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 8,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.88rem', outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={adding || !newText.trim() || !newClient}
              style={{
                padding: '9px 18px', borderRadius: 8,
                background: 'var(--orange)', border: 'none',
                color: '#fff', fontSize: '0.85rem', fontWeight: 700,
                cursor: adding || !newText.trim() || !newClient ? 'not-allowed' : 'pointer',
                opacity: adding || !newText.trim() || !newClient ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {adding ? '⏳ Ajout…' : '➕ Ajouter'}
            </button>
          </div>
          {/* Quick options: deadline + priority */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span>📅</span>
              {[
                ['Aujourd\'hui', todayStr()],
                ['Demain', tomorrowStr()],
                ['+ 3j', inDaysStr(3)],
                ['+ 7j', inDaysStr(7)],
              ].map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setNewDueDate(newDueDate === value ? '' : value)}
                  style={{
                    padding: '4px 10px', borderRadius: 14, fontSize: '0.72rem', fontWeight: 600,
                    background: newDueDate === value ? 'rgba(232,105,43,.18)' : 'var(--night-mid)',
                    color: newDueDate === value ? 'var(--orange)' : 'var(--text-muted)',
                    border: newDueDate === value ? '1px solid var(--border-orange)' : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >{label}</button>
              ))}
              <input
                type="date"
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                style={{
                  padding: '4px 8px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', fontSize: '0.74rem', outline: 'none', colorScheme: 'dark',
                  marginLeft: 4,
                }}
              />
              {newDueDate && (
                <button type="button" onClick={() => setNewDueDate('')} style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.7rem', padding: '2px 6px',
                }}>✕</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginLeft: 'auto' }}>
              <span>Priorité :</span>
              {(Object.keys(PRIORITY_META) as Priority[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewPriority(p)}
                  title={PRIORITY_META[p].label}
                  style={{
                    padding: '4px 10px', borderRadius: 14, fontSize: '0.72rem', fontWeight: 600,
                    background: newPriority === p ? `${PRIORITY_META[p].color}25` : 'var(--night-mid)',
                    color: newPriority === p ? PRIORITY_META[p].color : 'var(--text-muted)',
                    border: newPriority === p ? `1px solid ${PRIORITY_META[p].color}` : '1px solid transparent',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <span aria-hidden>{PRIORITY_META[p].emoji}</span> {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>

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
              color: tab === k ? '#fff' : 'var(--text-mid)',
              fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {k === 'open' ? '📌 À faire' : k === 'done' ? '✅ Terminées' : '📋 Toutes'} · {counts[k]}
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
          <option value="">👥 Tous les clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
        </select>
        <input
          type="text"
          placeholder="🔍 Rechercher…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.8rem', outline: 'none',
            minWidth: 180,
          }}
        />
      </div>

      {/* Quick filter chips */}
      {tab === 'open' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {([
            { key: 'all' as UrgencyFilter, label: 'Toutes' },
            { key: 'overdue' as UrgencyFilter, label: '⚠️ En retard', count: urgencyCounts.overdue },
            { key: 'today' as UrgencyFilter, label: "📅 Aujourd'hui", count: urgencyCounts.today },
            { key: 'week' as UrgencyFilter, label: 'Cette semaine', count: urgencyCounts.week },
            { key: 'high' as UrgencyFilter, label: '🔴 Haute', count: urgencyCounts.high },
            { key: 'nodate' as UrgencyFilter, label: 'Sans date', count: urgencyCounts.nodate },
          ]).map(chip => (
            <button
              key={chip.key}
              onClick={() => setUrgencyFilter(urgencyFilter === chip.key ? 'all' : chip.key)}
              style={chipStyle(urgencyFilter === chip.key)}
            >
              {chip.label}{chip.count !== undefined && chip.count > 0 ? ` · ${chip.count}` : ''}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          padding: '14px 18px', borderRadius: 10,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
          color: 'var(--red)', fontSize: '0.85rem', marginBottom: 16,
        }}>❌ {error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              background: 'var(--night-card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 18, height: 100,
            }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '60px 20px', textAlign: 'center',
          background: 'var(--night-card)', borderRadius: 12,
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 10 }}>
            {urgencyFilter === 'overdue' ? '🎉' : tab === 'done' ? '✨' : '📭'}
          </div>
          <div style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 700, marginBottom: 6 }}>
            {urgencyFilter === 'overdue' ? 'Aucune tâche en retard'
              : urgencyFilter === 'today' ? "Aucune tâche pour aujourd'hui"
              : urgencyFilter === 'high' ? 'Aucune tâche prioritaire'
              : tab === 'open' ? 'Tout est sous contrôle' : tab === 'done' ? 'Aucune tâche terminée' : 'Aucune tâche'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            Ajoutez-en une via le formulaire ci-dessus.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grouped.map(group => {
            const completedCount = group.allTasks.filter(t => t.done).length;
            const totalCount = group.allTasks.length;
            const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
            return (
              <div key={group.client_id} style={{
                background: 'var(--night-card)', borderRadius: 12,
                border: '1px solid var(--border)', overflow: 'hidden',
              }}>
                {/* Client group header */}
                <div style={{
                  padding: '12px 16px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10, flexWrap: 'wrap',
                }}>
                  <Link href={`/dashboard/clients/${group.client_id}`} style={{
                    fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)',
                    textDecoration: 'none',
                  }}>
                    👤 {group.client_name}
                  </Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        width: 80, height: 5, borderRadius: 3,
                        background: 'var(--night-mid)', overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${pct}%`,
                          background: pct === 100 ? 'var(--green)' : 'var(--orange)',
                          transition: 'width .3s ease',
                        }} />
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {completedCount}/{totalCount}
                      </span>
                    </div>
                    {group.client_status && (
                      <span style={{
                        fontSize: '0.66rem', padding: '3px 9px', borderRadius: 12,
                        background: 'var(--night-mid)', color: 'var(--text-muted)', fontWeight: 600,
                      }}>{STATUS_LABELS[group.client_status] || group.client_status}</span>
                    )}
                    {/* Bulk actions */}
                    {group.allTasks.some(t => !t.done) && (
                      <button onClick={() => bulkMarkAllDone(group.client_id)} title="Tout marquer fait" style={miniBtnStyle}>
                        ✅ Tout fait
                      </button>
                    )}
                    {group.allTasks.some(t => t.done) && (
                      <button onClick={() => bulkClearDone(group.client_id)} title="Effacer les terminées" style={miniBtnStyle}>
                        🗑️ Vider terminées
                      </button>
                    )}
                  </div>
                </div>

                {/* Task list */}
                <div style={{ padding: 8 }}>
                  {group.tasks.map(t => {
                    const overdueFlag = isOverdue(t);
                    const todayFlag = isToday(t);
                    const isEditing = editingId === t.id;
                    const isExpanded = expandedId === t.id;
                    const priority = t.priority || 'medium';
                    const pMeta = PRIORITY_META[priority];
                    return (
                      <div key={t.id} style={{
                        padding: '10px 12px', borderRadius: 10,
                        opacity: busy === t.id ? 0.5 : 1,
                        background: t.done ? 'transparent' : (overdueFlag ? 'rgba(239,68,68,.05)' : 'transparent'),
                        marginBottom: 4,
                        transition: 'background .15s',
                        borderLeft: !t.done ? `3px solid ${pMeta.color}` : '3px solid transparent',
                      }}>
                        {/* Row: checkbox + content + meta + actions */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                          <input
                            type="checkbox"
                            checked={t.done}
                            onChange={() => toggleTask(t)}
                            style={{ accentColor: 'var(--orange)', cursor: 'pointer', marginTop: 4, width: 18, height: 18, flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {isEditing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <input
                                  type="text" autoFocus value={editDraft.text}
                                  onChange={e => setEditDraft(d => ({ ...d, text: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(t); if (e.key === 'Escape') setEditingId(null); }}
                                  style={editInputStyle}
                                />
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <input
                                    type="date" value={editDraft.due_date}
                                    onChange={e => setEditDraft(d => ({ ...d, due_date: e.target.value }))}
                                    style={{ ...editInputStyle, width: 'auto', colorScheme: 'dark' }}
                                  />
                                  <select value={editDraft.priority} onChange={e => setEditDraft(d => ({ ...d, priority: e.target.value as Priority }))}
                                    style={{ ...editInputStyle, width: 'auto' }}>
                                    {(Object.keys(PRIORITY_META) as Priority[]).map(p => (
                                      <option key={p} value={p}>{PRIORITY_META[p].emoji} {PRIORITY_META[p].label}</option>
                                    ))}
                                  </select>
                                </div>
                                <textarea
                                  placeholder="Notes (optionnel)…" rows={2}
                                  value={editDraft.notes}
                                  onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                                  style={{ ...editInputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                                />
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  <button onClick={() => setEditingId(null)} style={miniBtnStyle}>Annuler</button>
                                  <button onClick={() => saveEdit(t)} style={{ ...miniBtnStyle, background: 'var(--orange)', color: '#fff', border: 'none' }}>
                                    💾 Enregistrer
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div onClick={() => !t.done && setExpandedId(isExpanded ? null : t.id)} style={{ cursor: t.done ? 'default' : 'pointer' }}>
                                <div style={{
                                  fontSize: '0.92rem',
                                  color: t.done ? 'var(--text-muted)' : 'var(--text)',
                                  textDecoration: t.done ? 'line-through' : 'none',
                                  fontWeight: 500, lineHeight: 1.4,
                                }}>
                                  {!t.done && <span aria-hidden style={{ marginRight: 6 }}>{pMeta.emoji}</span>}
                                  {t.text}
                                </div>
                                {isExpanded && t.notes && (
                                  <div style={{
                                    marginTop: 6, padding: '8px 12px', borderRadius: 6,
                                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                                    fontSize: '0.78rem', color: 'var(--text-mid)',
                                    whiteSpace: 'pre-wrap', lineHeight: 1.5,
                                  }}>
                                    {t.notes}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {!isEditing && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              {t.due_date && !t.done && (
                                <span style={{
                                  fontSize: '0.7rem', padding: '3px 9px', borderRadius: 999,
                                  fontWeight: 600, whiteSpace: 'nowrap',
                                  background: overdueFlag ? 'rgba(239,68,68,.14)' : todayFlag ? 'rgba(250,204,21,.15)' : 'var(--night-mid)',
                                  color: overdueFlag ? '#FCA5A5' : todayFlag ? '#FDE68A' : 'var(--text-muted)',
                                  border: overdueFlag ? '1px solid rgba(239,68,68,.35)' : todayFlag ? '1px solid rgba(250,204,21,.35)' : 'none',
                                }}>
                                  {overdueFlag ? '⚠️ ' : todayFlag ? '📅 ' : ''}{formatDateBadge(t.due_date)}
                                </span>
                              )}
                              {!t.done && (
                                <button onClick={() => startEdit(t)} title="Éditer" style={iconBtnStyle}>✏️</button>
                              )}
                              <button onClick={() => deleteTask(t)} title="Supprimer" style={iconBtnStyle}>🗑️</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const editInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px',
  borderRadius: 6, background: 'var(--night-mid)',
  border: '1px solid var(--border-md)', color: 'var(--text)',
  fontSize: '0.85rem', outline: 'none',
};

const miniBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
  color: 'var(--text-mid)', cursor: 'pointer', whiteSpace: 'nowrap',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: '0.95rem', padding: '4px 6px',
  borderRadius: 4, lineHeight: 1,
};
