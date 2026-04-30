'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface ErrorLog {
  id: string;
  source: 'client' | 'server';
  digest?: string | null;
  message?: string | null;
  stack?: string | null;
  url?: string | null;
  user_agent?: string | null;
  client_token_prefix?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days < 7) return `il y a ${days}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Groupe les erreurs par signature (digest si dispo, sinon message tronqué).
// Le grouping permet de voir d'un coup quelle erreur revient le plus souvent.
function signatureOf(e: ErrorLog): string {
  if (e.digest) return `D:${e.digest}`;
  if (e.message) return `M:${e.message.slice(0, 80)}`;
  if (e.stack) return `S:${e.stack.slice(0, 80)}`;
  return 'unknown';
}

export default function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'client' | 'server'>('all');
  const [selected, setSelected] = useState<ErrorLog | null>(null);

  useEffect(() => { document.title = 'Erreurs runtime — BourbonMédia Admin'; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === 'all' ? '' : `?source=${filter}`;
      const r = await fetch(`/api/error-logs${qs}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setErrors(Array.isArray(d) ? d : []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Refresh auto : visibilitychange (tab refocus) — cohérent avec le reste
  // du dashboard qui suit le pattern.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, ErrorLog[]>();
    for (const e of errors) {
      const sig = signatureOf(e);
      if (!map.has(sig)) map.set(sig, []);
      map.get(sig)!.push(e);
    }
    return Array.from(map.values()).sort((a, b) => b.length - a.length);
  }, [errors]);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: '1.6rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          }}>
            🪲 Erreurs runtime
          </h1>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Erreurs non interceptées par les ErrorBoundary internes — capturées via app/error.tsx + global-error.tsx.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['all', 'client', 'server'] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                background: filter === k ? 'var(--orange)' : 'var(--night-mid)',
                color: filter === k ? '#fff' : 'var(--text-mid)',
                border: `1px solid ${filter === k ? 'var(--orange)' : 'var(--border-md)'}`,
                cursor: 'pointer',
              }}
            >
              {k === 'all' ? 'Tout' : k === 'client' ? '🌐 Client' : '🖥️ Serveur'}
            </button>
          ))}
          <button onClick={load} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: '0.82rem',
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text-mid)', cursor: 'pointer',
          }}>↻ Rafraîchir</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
      ) : errors.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', borderRadius: 12,
          background: 'var(--night-card)', border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}>
          🎉 Aucune erreur récente. Tout va bien côté runtime.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {grouped.map(group => {
            const head = group[0];
            const occurrences = group.length;
            const last = group[0]; // déjà sorted desc par created_at via API
            return (
              <button
                key={signatureOf(head)}
                onClick={() => setSelected(head)}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px', borderRadius: 12,
                  background: 'var(--night-card)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'border-color .15s, background .15s',
                  fontFamily: 'inherit',
                  width: '100%',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-orange)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999,
                    background: head.source === 'client' ? 'rgba(232,105,43,.15)' : 'rgba(139,92,246,.15)',
                    color: head.source === 'client' ? 'var(--orange)' : '#A78BFA',
                    fontWeight: 700, letterSpacing: '.4px',
                  }}>{head.source === 'client' ? '🌐 CLIENT' : '🖥️ SERVEUR'}</span>
                  {occurrences > 1 && (
                    <span style={{
                      fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999,
                      background: 'rgba(239,68,68,.12)', color: '#FCA5A5', fontWeight: 700,
                    }}>×{occurrences}</span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {relativeTime(last.created_at)}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.88rem', color: 'var(--text)', fontWeight: 600,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {head.message || head.digest || head.stack?.split('\n')[0] || '(pas de message)'}
                </div>
                {head.url && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {head.url}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Modal de détail */}
      {selected && (
        <>
          <div onClick={() => setSelected(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200,
          }} />
          <div style={{
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 201, width: 'min(720px, calc(100vw - 32px))',
            maxHeight: '85vh', overflowY: 'auto',
            background: 'var(--night-card)', borderRadius: 14,
            padding: '20px 24px', border: '1px solid var(--border-md)',
            boxShadow: '0 20px 60px rgba(0,0,0,.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                Détail erreur
              </h2>
              <button onClick={() => setSelected(null)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1,
              }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.85rem' }}>
              <Field label="Source" value={selected.source} />
              <Field label="Quand" value={`${new Date(selected.created_at).toLocaleString('fr-FR')} (${relativeTime(selected.created_at)})`} />
              {selected.digest && <Field label="Digest" value={selected.digest} mono />}
              {selected.message && <Field label="Message" value={selected.message} mono />}
              {selected.url && <Field label="URL" value={selected.url} mono />}
              {selected.client_token_prefix && <Field label="Token client (préfixe)" value={`${selected.client_token_prefix}…`} mono />}
              {selected.user_agent && <Field label="User-Agent" value={selected.user_agent} mono small />}
              {selected.stack && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>STACK</div>
                  <pre style={{
                    margin: 0, padding: 12, borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                    fontSize: '0.74rem', color: 'var(--text-mid)',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 320,
                  }}>{selected.stack}</pre>
                </div>
              )}
              {selected.metadata && (
                <Field label="Metadata" value={JSON.stringify(selected.metadata, null, 2)} mono small />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4, letterSpacing: '.3px' }}>
        {label.toUpperCase()}
      </div>
      <div style={{
        padding: '8px 12px', borderRadius: 8,
        background: 'var(--night-mid)', border: '1px solid var(--border)',
        fontSize: small ? '0.72rem' : '0.82rem',
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
        color: 'var(--text)', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
      }}>
        {value}
      </div>
    </div>
  );
}
