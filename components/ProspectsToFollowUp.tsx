'use client';

import { useEffect, useState, useCallback } from 'react';

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

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function ProspectsToFollowUp() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/gh-appointments?follow_up=1', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => setItems(d.appointments || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid rgba(59,130,246,.30)',
      padding: '16px 20px', marginBottom: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>📋</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>Prospects à relancer</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Échéance dépassée — appel à passer ou message à envoyer
            </div>
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 999,
          background: 'rgba(59,130,246,.16)', border: '1px solid rgba(59,130,246,.45)',
          color: '#93C5FD', fontSize: '0.72rem', fontWeight: 700,
        }}>{items.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.slice(0, 8).map(a => {
          const status = a.prospect_status || '';
          const meta = STATUS_LABEL[status] || { emoji: '📌', label: status };
          const targetDays = FOLLOW_UP_DAYS[status] || 0;
          const elapsed = a.notes_completed_at ? daysSince(a.notes_completed_at) : 0;
          const overdue = elapsed - targetDays;
          const overdueLabel = overdue === 0 ? "Aujourd'hui" : overdue > 0 ? `${overdue} j de retard` : `dans ${-overdue} j`;
          const tone = overdue > 0 ? '#FCA5A5' : overdue === 0 ? 'var(--orange)' : 'var(--text-muted)';
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 10, background: 'var(--night-mid)', border: '1px solid var(--border)',
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
    </div>
  );
}
