'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  email?: string;
  phone?: string;
  city?: string;
  category?: string;
  status: string;
  filming_date?: string;
  publication_deadline?: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture script',
  script_review: 'Relecture client',
  script_validated: 'Script validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tournage terminé',
  editing: 'Montage',
  published: 'Publié',
};

const STATUS_COLORS: Record<string, string> = {
  onboarding: '#8A7060',
  script_writing: '#FACC15',
  script_review: '#F28C55',
  script_validated: '#22C55E',
  filming_scheduled: '#3B82F6',
  filming_done: '#8B5CF6',
  editing: '#EC4899',
  published: '#22C55E',
};

const STEPS = Object.keys(STATUS_LABELS);

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ business_name: '', contact_name: '', email: '', phone: '', city: '', category: '' });
  const [saving, setSaving] = useState(false);

  function loadClients() {
    fetch('/api/clients', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadClients(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/clients', { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) });
      if (r.ok) {
        setShowForm(false);
        setForm({ business_name: '', contact_name: '', email: '', phone: '', city: '', category: '' });
        loadClients();
      }
    } finally { setSaving(false); }
  }

  const filtered = clients.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.business_name.toLowerCase().includes(q) || c.contact_name.toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.5rem' }}>Clients</h1>
        <button onClick={() => setShowForm(!showForm)} style={{
          padding: '8px 18px', borderRadius: 8, background: 'var(--orange)', color: '#fff',
          border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
        }}>+ Nouveau client</button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border-orange)',
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {([
              ['business_name', 'Nom du commerce *'],
              ['contact_name', 'Nom du contact *'],
              ['email', 'Email'],
              ['phone', 'Téléphone'],
              ['city', 'Ville'],
              ['category', 'Catégorie'],
            ] as const).map(([key, label]) => (
              <label key={key}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</span>
                <input
                  value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
                  required={key === 'business_name' || key === 'contact_name'}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowForm(false)} style={{
              padding: '8px 16px', borderRadius: 8, background: 'transparent',
              border: '1px solid var(--border-md)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
            }}>Annuler</button>
            <button type="submit" disabled={saving} style={{
              padding: '8px 16px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
            }}>{saving ? 'Création…' : 'Créer'}</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, background: 'var(--night-card)',
            border: '1px solid var(--border-md)', color: 'var(--text)', fontSize: '0.8rem',
            width: 200,
          }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <FilterBtn label="Tous" active={filter === 'all'} onClick={() => setFilter('all')} />
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <FilterBtn key={key} label={label} active={filter === key} onClick={() => setFilter(key)}
              color={STATUS_COLORS[key]} />
          ))}
        </div>
      </div>

      {/* Client list */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: 40 }}>
          Aucun client trouvé
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(client => (
            <Link key={client.id} href={`/dashboard/clients/${client.id}`} style={{
              display: 'block', textDecoration: 'none',
              background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
              padding: '16px 20px', transition: 'border-color .15s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>{client.business_name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {client.contact_name}{client.city ? ` — ${client.city}` : ''}{client.category ? ` · ${client.category}` : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.7rem', padding: '4px 10px', borderRadius: 20,
                  background: STATUS_COLORS[client.status] + '20',
                  color: STATUS_COLORS[client.status], fontWeight: 500,
                }}>{STATUS_LABELS[client.status]}</span>
              </div>

              {/* Stepper */}
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {STEPS.map((step, i) => {
                  const currentIdx = STEPS.indexOf(client.status);
                  const done = i <= currentIdx;
                  return (
                    <div key={step} style={{
                      flex: 1, height: 4, borderRadius: 2,
                      background: done ? STATUS_COLORS[step] : 'var(--border-md)',
                      transition: 'background .2s',
                    }} title={STATUS_LABELS[step]} />
                  );
                })}
              </div>

              {client.filming_date && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  Tournage : {new Date(client.filming_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBtn({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
      fontSize: '0.72rem', fontWeight: active ? 600 : 400,
      background: active ? (color ? color + '20' : 'rgba(232,105,43,.15)') : 'var(--night-mid)',
      color: active ? (color || 'var(--orange)') : 'var(--text-muted)',
      transition: 'all .15s',
    }}>{label}</button>
  );
}
