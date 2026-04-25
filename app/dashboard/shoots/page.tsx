'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  city?: string;
  filming_date?: string;
  publication_deadline?: string;
  delivered_at?: string;
}

type ShootStage = 'to_plan' | 'this_week' | 'upcoming' | 'shot' | 'editing' | 'delivered';

const STAGES: { key: ShootStage; label: string; emoji: string; color: string }[] = [
  { key: 'to_plan',    label: 'À planifier',    emoji: '🗓️', color: '#FACC15' },
  { key: 'this_week',  label: 'Cette semaine',  emoji: '⚡', color: '#F28C55' },
  { key: 'upcoming',   label: 'À venir',        emoji: '🎬', color: '#3B82F6' },
  { key: 'shot',       label: 'Tourné',         emoji: '✅', color: '#8B5CF6' },
  { key: 'editing',    label: 'Montage',        emoji: '🎞️', color: '#EC4899' },
  { key: 'delivered',  label: 'Livré',          emoji: '🎉', color: '#22C55E' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function classifyShoot(c: Client): ShootStage | null {
  // Eligible: client validé script ou plus loin dans le funnel
  if (c.status === 'published' || c.delivered_at) return 'delivered';
  if (c.status === 'editing') return 'editing';
  if (c.status === 'filming_done') return 'shot';
  if (c.status === 'filming_scheduled' && c.filming_date) {
    const days = Math.ceil((new Date(c.filming_date).getTime() - Date.now()) / 86400000);
    if (days < 0) return 'shot'; // tourné dans le passé mais statut pas encore màj
    if (days <= 7) return 'this_week';
    return 'upcoming';
  }
  if (c.status === 'script_validated') return 'to_plan';
  return null; // not in shoot pipeline
}

function getDaysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function formatFilming(dateStr?: string): string {
  if (!dateStr) return 'Date à fixer';
  const days = getDaysUntil(dateStr);
  const dateObj = new Date(dateStr);
  const formatted = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  if (days === 0) return `${formatted} · 🔴 Aujourd'hui`;
  if (days === 1) return `${formatted} · 🟡 Demain`;
  if (days < 0) return `${formatted} · il y a ${Math.abs(days)} j`;
  return `${formatted} · dans ${days} j`;
}

export default function ShootsKanbanPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ShootStage | null>(null);

  const loadClients = useCallback(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(async r => { if (!r.ok) throw new Error('Erreur de chargement'); return r.json(); })
      .then((d: Client[]) => setClients(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.business_name.toLowerCase().includes(q) ||
      c.contact_name?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const grouped = useMemo(() => {
    const g: Record<ShootStage, Client[]> = { to_plan: [], this_week: [], upcoming: [], shot: [], editing: [], delivered: [] };
    filtered.forEach(c => {
      const stage = classifyShoot(c);
      if (stage) g[stage].push(c);
    });
    // Sort each: by filming_date asc, no-date last
    Object.keys(g).forEach((k) => {
      const arr = g[k as ShootStage];
      arr.sort((a, b) => {
        if (a.filming_date && b.filming_date) return a.filming_date.localeCompare(b.filming_date);
        if (a.filming_date && !b.filming_date) return -1;
        if (!a.filming_date && b.filming_date) return 1;
        return a.business_name.localeCompare(b.business_name);
      });
    });
    return g;
  }, [filtered]);

  // Drag → change status / filming_date based on target stage
  async function moveClient(clientId: string, targetStage: ShootStage) {
    const c = clients.find(x => x.id === clientId);
    if (!c) return;
    const currentStage = classifyShoot(c);
    if (currentStage === targetStage) return;

    const updates: Record<string, unknown> = { id: clientId };
    let needsDate = false;

    if (targetStage === 'shot') updates.status = 'filming_done';
    else if (targetStage === 'editing') updates.status = 'editing';
    else if (targetStage === 'delivered') {
      updates.status = 'published';
      updates.delivered_at = new Date().toISOString();
    }
    else if (targetStage === 'to_plan') {
      updates.status = 'script_validated';
      updates.filming_date = null;
    }
    else if (targetStage === 'this_week' || targetStage === 'upcoming') {
      // Need a date — prompt
      const defaultOffset = targetStage === 'this_week' ? 3 : 14;
      const def = new Date(); def.setDate(def.getDate() + defaultOffset);
      const defStr = def.toISOString().slice(0, 10);
      const prompted = prompt(
        `Date de tournage pour ${c.business_name} ?\nFormat AAAA-MM-JJ`,
        c.filming_date?.slice(0, 10) || defStr,
      );
      if (!prompted) return;
      const parsed = new Date(prompted);
      if (Number.isNaN(parsed.getTime())) { alert('Date invalide'); return; }
      updates.filming_date = parsed.toISOString();
      updates.status = 'filming_scheduled';
      needsDate = true;
    }
    void needsDate;

    setMovingId(clientId);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify(updates),
      });
      if (r.ok) {
        const updated = await r.json();
        setClients(prev => prev.map(x => x.id === clientId ? { ...x, ...updated } : x));
      } else {
        alert("Le déplacement n'a pas pu être enregistré.");
      }
    } catch {
      alert("Le déplacement n'a pas pu être enregistré.");
    } finally {
      setMovingId(null);
      setDragId(null);
      setDropTarget(null);
    }
  }

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800, fontSize: '1.7rem', color: 'var(--text)',
            margin: 0, lineHeight: 1.2,
          }}>
            🎬 Tournages — Kanban
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Du script validé à la livraison — glissez-déposez pour avancer
          </p>
        </div>
        <input
          type="text"
          placeholder="🔍 Rechercher un client…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '9px 14px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.85rem', minWidth: 260, outline: 'none',
          }}
        />
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,.08)', color: 'var(--red)', fontSize: '0.85rem', marginBottom: 14 }}>
          ❌ {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>Chargement…</div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`,
          gap: 10, overflowX: 'auto', paddingBottom: 12,
        }}>
          {STAGES.map(stage => {
            const items = grouped[stage.key];
            const isOver = dropTarget === stage.key && dragId !== null;
            return (
              <div
                key={stage.key}
                onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropTarget !== stage.key) setDropTarget(stage.key); }}
                onDragLeave={() => { if (dropTarget === stage.key) setDropTarget(null); }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; if (id) moveClient(id, stage.key); }}
                style={{
                  background: 'var(--night-card)',
                  border: `1px solid ${isOver ? stage.color : 'var(--border)'}`,
                  borderRadius: 12,
                  display: 'flex', flexDirection: 'column',
                  minHeight: 380,
                  transition: 'border-color .15s, box-shadow .15s',
                  boxShadow: isOver ? `0 0 0 2px ${stage.color}55` : 'none',
                }}
              >
                <div style={{
                  padding: '12px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span aria-hidden style={{ fontSize: '1.1rem' }}>{stage.emoji}</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
                    {stage.label}
                  </span>
                  <span style={{
                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999,
                    background: `${stage.color}20`, color: stage.color, fontWeight: 700,
                  }}>{items.length}</span>
                </div>

                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  {items.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Aucun
                    </div>
                  ) : (
                    items.map(c => (
                      <div
                        key={c.id}
                        draggable={!movingId}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragId(c.id); }}
                        onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                        style={{
                          padding: '10px 12px', borderRadius: 8,
                          background: 'var(--night-mid)',
                          border: `1px solid ${dragId === c.id ? stage.color : 'var(--border)'}`,
                          cursor: 'grab',
                          opacity: movingId === c.id ? 0.4 : dragId === c.id ? 0.6 : 1,
                          transition: 'opacity .15s',
                        }}
                      >
                        <Link href={`/dashboard/clients/${c.id}?tab=filming`} style={{
                          textDecoration: 'none', color: 'inherit', display: 'block',
                        }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.business_name}
                          </div>
                          {c.contact_name && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              👤 {c.contact_name}{c.city ? ` · 📍 ${c.city}` : ''}
                            </div>
                          )}
                          <div style={{ fontSize: '0.7rem', color: stage.color, fontWeight: 600 }}>
                            📅 {formatFilming(c.filming_date)}
                          </div>
                          {c.publication_deadline && stage.key !== 'delivered' && (
                            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              📺 Pub. : {new Date(c.publication_deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </div>
                          )}
                        </Link>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
