'use client';

import { useEffect, useState, useMemo } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  active: boolean;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  editor: 'Éditeur',
  viewer: 'Lecteur',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--orange)',
  editor: '#3B82F6',
  viewer: 'var(--text-muted)',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function TeamPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'editor' as 'admin' | 'editor' | 'viewer' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function notify(type: 'error' | 'success', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function loadUsers() {
    try {
      const r = await fetch('/api/users', { headers: authHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
      setUsers(await r.json());
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadUsers(); }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter) list = list.filter(u => u.role === roleFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    return list;
  }, [users, roleFilter, search]);

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = { admin: 0, editor: 0, viewer: 0 };
    users.forEach(u => { c[u.role] = (c[u.role] || 0) + 1; });
    return c;
  }, [users]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
      if (form.password) payload.password = form.password;
      if (editingId) payload.id = editingId;
      const r = await fetch('/api/users', {
        method: editingId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
      notify('success', editingId ? 'Membre mis à jour' : 'Membre ajouté');
      setShowForm(false); setEditingId(null);
      setForm({ email: '', name: '', password: '', role: 'editor' });
      loadUsers();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null);
    try {
      const r = await fetch('/api/users', {
        method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
      notify('success', 'Membre supprimé');
      loadUsers();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    }
  }

  async function toggleActive(u: User) {
    try {
      const r = await fetch('/api/users', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: u.id, active: !u.active }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
      loadUsers();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    }
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setForm({ email: u.email, name: u.name, password: '', role: u.role });
    setShowForm(true);
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '12px 18px', borderRadius: 10,
          background: toast.type === 'error' ? 'rgba(239,68,68,.95)' : 'rgba(34,197,94,.95)',
          color: '#fff', fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, fontSize: '1.6rem', margin: 0, color: 'var(--text)' }}>
            Équipe
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '4px 0 0' }}>
            Membres de la plateforme admin
          </p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ email: '', name: '', password: '', role: 'editor' }); }}
          style={{
            padding: '9px 18px', borderRadius: 8, background: showForm ? 'var(--night-mid)' : 'var(--orange)',
            color: showForm ? 'var(--text)' : '#fff', border: showForm ? '1px solid var(--border-md)' : 'none',
            fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
          }}>
          {showForm ? 'Annuler' : '+ Ajouter'}
        </button>
      </div>

      {/* Stats strip */}
      <div style={{
        display: 'flex', gap: 0, background: 'var(--night-card)',
        borderRadius: 10, border: '1px solid var(--border)',
        marginBottom: 16, overflow: 'hidden',
      }}>
        <MetricCell label="Total" value={users.length.toString()} color="var(--text)" />
        <MetricCell label="Admins" value={roleCounts.admin.toString()} color="var(--orange)" />
        <MetricCell label="Éditeurs" value={roleCounts.editor.toString()} color="#3B82F6" />
        <MetricCell label="Lecteurs" value={roleCounts.viewer.toString()} color="var(--text-muted)" last />
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{
          background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
          padding: '18px 20px', marginBottom: 16,
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
            {editingId ? 'Modifier le membre' : 'Nouveau membre'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
            <label>
              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500 }}>Nom</span>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500 }}>Email</span>
              <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500 }}>
                Mot de passe{editingId ? ' (vide = inchangé)' : ''}
              </span>
              <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                required={!editingId} minLength={6} style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500 }}>Rôle</span>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'editor' | 'viewer' })}
                style={inputStyle}>
                <option value="viewer">Lecteur</option>
                <option value="editor">Éditeur</option>
                <option value="admin">Administrateur</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving} style={{
              padding: '9px 20px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
              fontSize: '0.85rem', opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      )}

      {/* Search + filter row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Rechercher par nom ou email…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8,
            background: 'var(--night-mid)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: '0.82rem', outline: 'none',
          }}
        />
        {(['', 'admin', 'editor', 'viewer'] as const).map(r => (
          <button key={r || 'all'} onClick={() => setRoleFilter(r)} style={{
            padding: '5px 12px', borderRadius: 14, border: 'none',
            background: roleFilter === r ? (r ? ROLE_COLORS[r] + '25' : 'var(--orange)') : 'var(--night-mid)',
            color: roleFilter === r ? (r ? ROLE_COLORS[r] : '#000') : 'var(--text-muted)',
            fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
          }}>
            {r ? ROLE_LABELS[r] : 'Tous'}
          </button>
        ))}
      </div>

      {/* User list */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Chargement…</div>
      ) : error ? (
        <div style={{ color: 'var(--red)', padding: 20, background: 'rgba(239,68,68,.08)', borderRadius: 8 }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '50px 20px', textAlign: 'center',
          background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 10, opacity: 0.25 }}>◉</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            {users.length === 0 ? 'Aucun membre. Ajoutez le premier.' : 'Aucun résultat.'}
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {filtered.map((u, i) => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              opacity: u.active ? 1 : 0.5,
              transition: 'opacity .2s',
            }}>
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: ROLE_COLORS[u.role] + '18', color: ROLE_COLORS[u.role],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}>
                {u.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.name}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.email} · Depuis {new Date(u.created_at).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}
                </div>
              </div>

              {/* Role badge */}
              <span style={{
                fontSize: '0.66rem', padding: '3px 9px', borderRadius: 12,
                background: ROLE_COLORS[u.role] + '18', color: ROLE_COLORS[u.role],
                fontWeight: 600, whiteSpace: 'nowrap',
              }}>{ROLE_LABELS[u.role]}</span>

              {/* Active toggle */}
              <button onClick={() => toggleActive(u)} style={{
                padding: '4px 9px', borderRadius: 6,
                background: u.active ? 'rgba(34,197,94,.08)' : 'var(--night-mid)',
                border: `1px solid ${u.active ? 'rgba(34,197,94,.25)' : 'var(--border-md)'}`,
                color: u.active ? 'var(--green)' : 'var(--text-muted)',
                fontSize: '0.68rem', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600,
              }}>{u.active ? 'Actif' : 'Inactif'}</button>

              {/* Edit */}
              <button onClick={() => startEdit(u)} style={iconBtnStyle} title="Modifier">✎</button>

              {/* Delete with inline confirmation */}
              {confirmDeleteId === u.id ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleDelete(u.id)} style={{
                    ...iconBtnStyle, background: 'rgba(239,68,68,.15)', borderColor: 'rgba(239,68,68,.3)', color: 'var(--red)',
                    fontSize: '0.62rem', width: 'auto', padding: '4px 8px',
                  }}>Oui</button>
                  <button onClick={() => setConfirmDeleteId(null)} style={{
                    ...iconBtnStyle, fontSize: '0.62rem', width: 'auto', padding: '4px 8px',
                  }}>Non</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteId(u.id)} style={{ ...iconBtnStyle, color: 'var(--red)' }} title="Supprimer">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '12px 14px', textAlign: 'center',
      borderRight: last ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color, fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
  color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit',
};

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, background: 'var(--night-mid)',
  border: '1px solid var(--border-md)', color: 'var(--text-mid)',
  cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
