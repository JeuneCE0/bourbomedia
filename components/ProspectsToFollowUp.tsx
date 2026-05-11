'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCollapsiblePref } from '@/lib/use-collapsible';

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  ghl_contact_id: string | null;
  prospect_status: 'reflection' | 'follow_up' | string | null;
  notes: string | null;
  notes_completed_at: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  opportunity_name?: string | null;
  pipeline_stage_name?: string | null;
}

const FOLLOW_UP_DAYS: Record<string, number> = {
  reflection: 2,
  follow_up: 7,
};

const STATUS_LABEL: Record<string, { emoji: string; label: string }> = {
  reflection: { emoji: '🤔', label: 'En réflexion' },
  follow_up:  { emoji: '🔁', label: 'Follow-up' },
};

// Mêmes options que dans AppointmentDetailModal — pour cohérence UX.
const STATUS_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'reflection',          label: 'En réflexion',         emoji: '🤔' },
  { value: 'follow_up',           label: 'Follow-up',            emoji: '🔁' },
  { value: 'ghosting',            label: 'Ghosting',             emoji: '👻' },
  { value: 'awaiting_signature',  label: 'Attente signature',    emoji: '✍️' },
  { value: 'contracted',          label: 'Contracté',            emoji: '🤝' },
  { value: 'not_interested',      label: 'Pas intéressé',        emoji: '🚫' },
  { value: 'closed_lost',         label: 'Perdu',                emoji: '❌' },
];

// Statuts qui maintiennent le prospect dans la queue de relance.
const FOLLOW_UP_STATUSES = new Set(['reflection', 'follow_up']);

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function ProspectsToFollowUp() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { collapsed, toggle } = useCollapsiblePref('bbm_prospects_followup_collapsed', false);

  const load = useCallback(() => {
    fetch('/api/gh-appointments?follow_up=1', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => setItems(d.appointments || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, newStatus: string) {
    setSavingId(id);
    try {
      const r = await fetch('/api/gh-appointments', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ id, prospect_status: newStatus }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erreur : ${d.error || r.status}`);
        return;
      }
      // Si le nouveau statut sort de la fenêtre de relance (won/lost/etc.),
      // on retire la ligne. Sinon on la garde mais à jour.
      if (FOLLOW_UP_STATUSES.has(newStatus)) {
        setItems(prev => prev.map(a => a.id === id ? { ...a, prospect_status: newStatus as Appointment['prospect_status'] } : a));
      } else {
        setItems(prev => prev.filter(a => a.id !== id));
      }
    } catch (e) {
      alert(`Erreur réseau : ${(e as Error).message}`);
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid rgba(59,130,246,.30)',
      padding: '16px 20px', marginBottom: 14,
    }}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: collapsed ? 0 : 12, gap: 10, padding: 0,
          background: 'transparent', border: 'none', color: 'inherit',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📋</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Prospects à relancer</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Échéance dépassée — appel à passer ou message à envoyer
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '3px 10px', borderRadius: 999,
            background: 'rgba(59,130,246,.16)', border: '1px solid rgba(59,130,246,.45)',
            color: '#93C5FD', fontSize: '0.72rem', fontWeight: 700,
          }}>{items.length}</span>
          <span aria-hidden style={{
            display: 'inline-block', fontSize: 11, color: 'var(--text-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform .2s ease',
          }}>▼</span>
        </div>
      </button>

      {!collapsed && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.slice(0, 8).map(a => {
          const status = a.prospect_status || '';
          const meta = STATUS_LABEL[status] || { emoji: '📌', label: status };
          const targetDays = FOLLOW_UP_DAYS[status] || 0;
          const elapsed = a.notes_completed_at ? daysSince(a.notes_completed_at) : 0;
          const overdue = elapsed - targetDays;
          const overdueLabel = overdue === 0 ? "Aujourd'hui" : overdue > 0 ? `${overdue} j de retard` : `dans ${-overdue} j`;
          const tone = overdue > 0 ? '#FCA5A5' : overdue === 0 ? 'var(--orange)' : 'var(--text-muted)';
          const isSaving = savingId === a.id;
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 10, background: 'var(--night-mid)', border: '1px solid var(--border)',
              opacity: isSaving ? 0.55 : 1, transition: 'opacity .15s',
            }}>
              <span aria-hidden style={{ fontSize: '1rem' }}>{meta.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.opportunity_name || a.contact_name || a.contact_email || 'Sans nom'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {meta.label} · J+{targetDays} {a.notes_completed_at ? `· documenté il y a ${elapsed} j` : ''}
                </div>
              </div>
              <select
                value={status}
                disabled={isSaving}
                onChange={e => updateStatus(a.id, e.target.value)}
                title="Changer le statut prospect"
                style={{
                  padding: '5px 8px', borderRadius: 8,
                  background: 'var(--night-card)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', fontSize: '0.74rem', fontWeight: 600,
                  cursor: isSaving ? 'wait' : 'pointer', maxWidth: 160,
                }}
              >
                {!STATUS_OPTIONS.some(o => o.value === status) && status && (
                  <option value={status}>{status}</option>
                )}
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>
                ))}
              </select>
              <span style={{
                fontSize: '0.7rem', padding: '4px 10px', borderRadius: 999,
                background: overdue > 0 ? 'rgba(239,68,68,.16)' : 'rgba(232,105,43,.16)',
                border: `1px solid ${overdue > 0 ? 'rgba(239,68,68,.45)' : 'rgba(232,105,43,.45)'}`,
                color: tone, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                {overdueLabel}
              </span>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
