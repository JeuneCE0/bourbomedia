'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface ContactSuggestion {
  id: string;
  type: 'client' | 'prospect';
  contact_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  client_id: string | null;
  ghl_contact_id: string | null;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

/**
 * Bouton + modal pour lier un client local à un contact GHL existant.
 * Utile quand un paiement Stripe a créé un client local sans match GHL.
 */
export default function LinkGhlButton({
  clientId,
  size = 'md',
  label = '🔗 Lier à GHL',
  onLinked,
}: {
  clientId: string;
  size?: 'sm' | 'md';
  label?: string;
  onLinked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/contacts/lookup?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        // On ne garde que les résultats avec ghl_contact_id (les autres sont des clients locaux sans GHL)
        setResults((d.contacts || []).filter((c: ContactSuggestion) => c.ghl_contact_id));
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(query), 250);
    return () => clearTimeout(t);
  }, [query, open, search]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function link(ghl_contact_id: string) {
    setLinking(true);
    setMsg(null);
    try {
      const r = await fetch('/api/clients/link-ghl', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ client_id: clientId, ghl_contact_id }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg('✓ ' + (d.message || 'Lié'));
        setTimeout(() => {
          setOpen(false);
          onLinked?.();
        }, 1200);
      } else {
        setMsg('✕ ' + (d.error || 'Erreur'));
      }
    } catch (e: unknown) {
      setMsg('✕ ' + (e as Error).message);
    } finally { setLinking(false); }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        title="Lier ce client à un contact GHL existant (récupère opportunités, RDV, infos)"
        style={{
          padding: size === 'sm' ? '3px 8px' : '5px 11px',
          borderRadius: 6,
          background: 'rgba(20,184,166,.12)',
          border: '1px solid rgba(20,184,166,.4)',
          color: '#14B8A6',
          cursor: 'pointer',
          fontSize: size === 'sm' ? '0.66rem' : '0.74rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
            backdropFilter: 'blur(3px)', zIndex: 1400,
          }} />
          <div ref={wrapRef} style={{
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 1401, width: 'min(540px, calc(100vw - 32px))',
            maxHeight: '80vh', overflowY: 'auto',
            background: 'var(--night-card)', borderRadius: 14,
            border: '1px solid var(--border-md)',
            boxShadow: '0 20px 60px rgba(0,0,0,.55)',
            padding: '20px',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 14,
            }}>
              <div>
                <h2 style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
                  fontSize: '1.05rem', color: 'var(--text)', margin: 0,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  🔗 Lier à un contact GHL
                </h2>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  Cherche le contact GHL existant pour rattacher ce client + ses opportunités
                </p>
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1,
              }}>×</button>
            </div>

            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Tape un nom, email, téléphone…"
              style={{
                width: '100%', padding: '11px 13px', borderRadius: 10,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.92rem', boxSizing: 'border-box',
                fontFamily: 'inherit', outline: 'none', marginBottom: 12,
              }}
            />

            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                Recherche…
              </div>
            ) : query.length < 2 ? (
              <div style={{ padding: 16, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Tape au moins 2 caractères pour chercher.
              </div>
            ) : results.length === 0 ? (
              <div style={{ padding: 16, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                Aucun contact GHL trouvé. Vérifie l&apos;orthographe ou essaie l&apos;email/téléphone.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map(r => (
                  <button
                    key={`${r.type}-${r.id}`}
                    onClick={() => r.ghl_contact_id && link(r.ghl_contact_id)}
                    disabled={linking || !r.ghl_contact_id}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 2,
                      width: '100%', padding: '10px 12px', borderRadius: 8,
                      background: 'var(--night-mid)', border: '1px solid var(--border)',
                      cursor: linking ? 'wait' : 'pointer', textAlign: 'left',
                      color: 'inherit',
                      transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => { if (!linking) e.currentTarget.style.borderColor = '#14B8A6'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600 }}>
                      <span aria-hidden style={{
                        fontSize: '0.66rem', padding: '1px 6px', borderRadius: 4,
                        background: r.type === 'client' ? 'rgba(34,197,94,.15)' : 'rgba(20,184,166,.15)',
                        color: r.type === 'client' ? 'var(--green)' : '#14B8A6',
                        fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>{r.type === 'client' ? 'Client' : 'Prospect'}</span>
                      {r.contact_name || r.business_name || '—'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {r.business_name && r.business_name !== r.contact_name && <span style={{ color: 'var(--orange)' }}>🏢 {r.business_name}</span>}
                      {r.business_name && r.business_name !== r.contact_name && (r.email || r.phone) && ' · '}
                      {r.email && <span>📧 {r.email}</span>}
                      {r.email && r.phone && ' · '}
                      {r.phone && <span>📱 {r.phone}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {msg && (
              <div style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 8,
                background: msg.startsWith('✓') ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.10)',
                color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)',
                fontSize: '0.82rem', fontWeight: 600,
              }}>{msg}</div>
            )}
          </div>
        </>
      )}
    </>
  );
}
