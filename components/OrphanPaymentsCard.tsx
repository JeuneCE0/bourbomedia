'use client';

import { useCallback, useEffect, useState } from 'react';
import ResolveOrphanCharge, { OrphanCharge } from './ResolveOrphanCharge';
import { useCollapsiblePref } from '@/lib/use-collapsible';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

/**
 * Card "Paiements à rattacher" sur le dashboard.
 * Affiche en permanence les charges Stripe réussies pour lesquelles on n'a
 * trouvé NI client local NI contact GHL — l'admin peut résoudre en un clic.
 * Read-only côté serveur : aucun insert tant que l'admin ne valide pas.
 */
export default function OrphanPaymentsCard() {
  const [orphans, setOrphans] = useState<OrphanCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<OrphanCharge | null>(null);
  const { collapsed, toggle } = useCollapsiblePref('bbm_orphan_payments_collapsed', false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/stripe/orphans?days=60', { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      if (Array.isArray(d.orphans)) setOrphans(d.orphans);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || orphans.length === 0) return null;

  const totalEur = orphans.reduce((s, o) => s + o.amount_eur, 0);

  return (
    <>
      <div style={{
        background: 'var(--night-card)', borderRadius: 14,
        border: '1px solid rgba(250,204,21,.45)',
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
            <span aria-hidden style={{ fontSize: '1.1rem' }}>⚠️</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                Paiements Stripe à rattacher
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Encaissé sans client identifié — résoudre pour créer la fiche
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 999,
              background: 'rgba(250,204,21,.16)', border: '1px solid rgba(250,204,21,.45)',
              color: '#FDE68A', fontSize: '0.72rem', fontWeight: 700,
            }}>
              {orphans.length} · {totalEur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
            </span>
            <span aria-hidden style={{
              display: 'inline-block', fontSize: 11, color: 'var(--text-muted)',
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform .2s ease',
            }}>▼</span>
          </div>
        </button>

        {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {orphans.slice(0, 5).map(o => (
            <div key={o.charge_id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--night-mid)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.amount_eur.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €
                  {' · '}
                  <span style={{ color: 'var(--text-mid)', fontWeight: 500 }}>
                    {o.name || o.email || 'Sans nom'}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {new Date(o.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  {o.email && ` · ${o.email}`}
                  {o.description && ` · ${o.description}`}
                </div>
              </div>
              <button
                onClick={() => setResolving(o)}
                style={{
                  fontSize: '0.7rem', padding: '5px 11px', borderRadius: 999,
                  background: 'rgba(250,204,21,.16)', border: '1px solid rgba(250,204,21,.45)',
                  color: '#FDE68A', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
                }}
              >
                🔧 Résoudre
              </button>
            </div>
          ))}
          {orphans.length > 5 && (
            <div style={{
              fontSize: '0.74rem', color: 'var(--text-muted)',
              textAlign: 'center', padding: '6px 0',
            }}>
              + {orphans.length - 5} autre{orphans.length - 5 > 1 ? 's' : ''} — résolvez ceux-ci d&apos;abord
            </div>
          )}
        </div>
        )}
      </div>

      {resolving && (
        <ResolveOrphanCharge
          orphan={resolving}
          onResolved={load}
          onClose={() => setResolving(null)}
        />
      )}
    </>
  );
}
