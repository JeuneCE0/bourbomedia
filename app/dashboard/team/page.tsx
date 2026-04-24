'use client';

import { useEffect, useState } from 'react';

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
  const [form, setForm] = useState<{ email: string; name: string; password: string; role: 'admin' | 'editor' | 'viewer' }>({
    email: '', name: '', password: '', role: 'editor',
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = '/api/users';
      const payload: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
      if (form.password) payload.password = form.password;
      if (editingId) payload.id = editingId;
      const r = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
      notify('success', editingId ? 'Utilisateur mis à jour' : 'Utilisateur créé');
      setShowForm(false); setEditingId(null);
      setForm({ email: '', name: '', password: '', role: 'editor' });
      loadUsers();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer ${name} ?`)) return;
    try {
      const r = await fetch('/api/users', {
        method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error || 'Erreur');
      notify('success', 'Utilisateur supprimé');
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
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto' }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '12px 18px', borderRadius: 10,
          background: toast.type === 'error' ? 'rgba(239,68,68,.95)' : 'rgba(34,197,94,.95)',
          color: '#fff', fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}>{toast.msg}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.6rem', margin: 0, color: 'var(--text)' }}>
            Équipe
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
            Gérer les membres admin de la plateforme
          </p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ email: '', name: '', password: '', role: 'editor' }); }}
          style={{
            padding: '9px 18px', borderRadius: 8, background: 'var(--orange)',
            color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
          }}>
          {showForm ? 'Annuler' : '+ Ajouter'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{
          background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
          padding: 20, marginBottom: 20,
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '0.95rem', color: 'var(--text)' }}>
            {editingId ? 'Modifier le membre' : 'Nouveau membre'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
            <label>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Nom</span>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Email</span>
              <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                Mot de passe {editingId ? '(laisser vide pour ne pas changer)' : ''}
              </span>
              <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                required={!editingId} minLength={6} style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Rôle</span>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'editor' | 'viewer' })}
                style={inputStyle}>
                <option value="viewer">Lecteur</option>
                <option value="editor">Éditeur</option>
                <option value="admin">Administrateur</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving} style={{
              padding: '9px 18px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
            }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Chargement…</div>
      ) : error ? (
        <div style={{ color: 'var(--red)', padding: 20, background: 'rgba(239,68,68,.08)', borderRadius: 8 }}>{error}</div>
      ) : users.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Aucun membre. Ajoutez le premier administrateur.
        </div>
      ) : (
        <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {users.map((u, i) => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 18px',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              opacity: u.active ? 1 : 0.5,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: ROLE_COLORS[u.role] + '22', color: ROLE_COLORS[u.role],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.78rem', fontWeight: 700, flexShrink: 0,
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}>
                {u.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.name}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.email}
                </div>
              </div>
              <span style={{
                fontSize: '0.7rem', padding: '3px 10px', borderRadius: 12,
                background: ROLE_COLORS[u.role] + '22', color: ROLE_COLORS[u.role],
                fontWeight: 600, whiteSpace: 'nowrap',
              }}>{ROLE_LABELS[u.role]}</span>
              <button onClick={() => toggleActive(u)} style={{
                padding: '5px 10px', borderRadius: 6, background: u.active ? 'rgba(34,197,94,.1)' : 'var(--night-mid)',
                border: `1px solid ${u.active ? 'rgba(34,197,94,.3)' : 'var(--border-md)'}`,
                color: u.active ? 'var(--green)' : 'var(--text-muted)',
                fontSize: '0.7rem', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{u.active ? 'Actif' : 'Inactif'}</button>
              <button onClick={() => startEdit(u)} style={iconBtnStyle} title="Modifier">✎</button>
              <button onClick={() => handleDelete(u.id, u.name)} style={{ ...iconBtnStyle, color: 'var(--red)' }} title="Supprimer">✕</button>
            </div>
          ))}
        </div>
      )}
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
