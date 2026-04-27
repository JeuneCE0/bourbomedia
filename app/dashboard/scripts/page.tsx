'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

interface ScriptItem {
  id: string;
  client_id: string;
  title: string;
  status: string;
  version: number;
  updated_at: string;
  created_at: string;
  clients?: { business_name: string };
}

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  city?: string;
  filming_date?: string;
  publication_deadline?: string;
}

const SCRIPT_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: '#8A7060' },
  proposition: { label: 'Envoyé au client', color: '#FACC15' },
  awaiting_changes: { label: 'À modifier', color: '#F28C55' },
  modified: { label: 'Modifié', color: '#3B82F6' },
  confirmed: { label: 'Validé', color: '#22C55E' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeDate(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 30) return `il y a ${days} j`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatFilmingDate(d: string): string {
  const date = new Date(d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  const formatted = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (diffDays === 0) return `${formatted} (aujourd'hui)`;
  if (diffDays === 1) return `${formatted} (demain)`;
  if (diffDays > 0) return `${formatted} (J-${diffDays})`;
  return `${formatted} (J+${-diffDays})`;
}

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  // Removed legacy 'shoots' tab — that data lives in the production kanban now.
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/scripts', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
      fetch('/api/clients', { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
    ])
      .then(([s, c]) => {
        if (Array.isArray(s)) setScripts(s);
        if (Array.isArray(c)) setClients(c);
      })
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  const filteredScripts = useMemo(() => {
    let list = scripts;
    if (statusFilter) list = list.filter(s => s.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(s =>
      s.clients?.business_name.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q)
    );
    return list;
  }, [scripts, statusFilter, search]);

  const scriptCounts = useMemo(() => {
    const c: Record<string, number> = { all: scripts.length };
    Object.keys(SCRIPT_STATUS).forEach(k => { c[k] = 0; });
    scripts.forEach(s => { c[s.status] = (c[s.status] || 0) + 1; });
    return c;
  }, [scripts]);

  const upcomingShoots = useMemo(() => {
    const now = Date.now();
    return clients
      .filter(c => c.filming_date && new Date(c.filming_date).getTime() >= now - 86400000)
      .sort((a, b) => new Date(a.filming_date!).getTime() - new Date(b.filming_date!).getTime());
  }, [clients]);

  const pastShoots = useMemo(() => {
    const now = Date.now();
    return clients
      .filter(c => c.filming_date && new Date(c.filming_date).getTime() < now - 86400000)
      .sort((a, b) => new Date(b.filming_date!).getTime() - new Date(a.filming_date!).getTime())
      .slice(0, 20);
  }, [clients]);

  const needsAction = useMemo(() => {
    return scripts.filter(s => s.status === 'awaiting_changes' || s.status === 'draft');
  }, [scripts]);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800, fontSize: '1.6rem', color: 'var(--text)',
          margin: 0, lineHeight: 1.3,
        }}>
          Scripts &amp; Tournages
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Rédaction, validation, planning des tournages
        </p>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div style={{
          display: 'flex', gap: 0, background: 'var(--night-card)',
          borderRadius: 10, border: '1px solid var(--border)',
          marginBottom: 16, overflow: 'hidden',
        }}>
          <div style={{ flex: 1, padding: '12px 14px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 3 }}>Scripts</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', fontFamily: "'Bricolage Grotesque', sans-serif" }}>{scripts.length}</div>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 3 }}>Validés</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--green)', fontFamily: "'Bricolage Grotesque', sans-serif" }}>{scriptCounts.confirmed || 0}</div>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 3 }}>À traiter</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: needsAction.length > 0 ? 'var(--orange)' : 'var(--text-muted)', fontFamily: "'Bricolage Grotesque', sans-serif" }}>{needsAction.length}</div>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 3 }}>Tournages</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3B82F6', fontFamily: "'Bricolage Grotesque', sans-serif" }}>{upcomingShoots.length}</div>
          </div>
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
      ) : (
        <>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
            <button
              onClick={() => setStatusFilter('')}
              style={{
                padding: '6px 12px', borderRadius: 16,
                background: !statusFilter ? 'var(--orange)' : 'var(--night-card)',
                border: !statusFilter ? 'none' : '1px solid var(--border-md)',
                color: !statusFilter ? '#000' : 'var(--text-mid)',
                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
              }}
            >Tous · {scriptCounts.all}</button>
            {Object.entries(SCRIPT_STATUS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                style={{
                  padding: '6px 12px', borderRadius: 16,
                  background: statusFilter === k ? v.color : 'var(--night-card)',
                  border: statusFilter === k ? 'none' : '1px solid var(--border-md)',
                  color: statusFilter === k ? '#000' : 'var(--text-mid)',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {statusFilter !== k && (
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: v.color }} />
                )}
                {v.label} · {scriptCounts[k] || 0}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <input
              type="text"
              placeholder="Rechercher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '7px 12px', borderRadius: 8,
                background: 'var(--night-card)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.8rem', outline: 'none',
                minWidth: 200,
              }}
            />
          </div>

          {filteredScripts.length === 0 ? (
            <div style={{
              padding: '60px 20px', textAlign: 'center',
              background: 'var(--night-card)', borderRadius: 12,
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.3 }}>✎</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {scripts.length === 0 ? 'Aucun script créé pour le moment' : 'Aucun script ne correspond aux filtres'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredScripts.map(s => {
                const st = SCRIPT_STATUS[s.status] || { label: s.status, color: 'var(--text-muted)' };
                return (
                  <Link
                    key={s.id}
                    href={`/dashboard/clients/${s.client_id}?tab=script`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '14px 18px',
                      background: 'var(--night-card)',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      textDecoration: 'none',
                      transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-md)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{
                      width: 4, alignSelf: 'stretch', borderRadius: 4,
                      background: st.color,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
                        {s.clients?.business_name || 'Client supprimé'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {s.title} · v{s.version} · maj {relativeDate(s.updated_at)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.7rem', padding: '4px 10px', borderRadius: 12,
                      background: `${st.color}20`, color: st.color,
                      fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {st.label}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>›</span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
