'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const ScriptEditor = dynamic(() => import('@/components/ScriptEditor'), { ssr: false });

interface Script {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  status: string;
  version: number;
  updated_at: string;
  script_comments?: Comment[];
}

interface Comment {
  id: string;
  author_name: string;
  author_type: string;
  content: string;
  created_at: string;
}

const SCRIPT_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'En préparation', color: '#8A7060' },
  proposition: { label: 'Proposition', color: '#F28C55' },
  awaiting_changes: { label: 'Modifications demandées', color: '#FACC15' },
  modified: { label: 'Modifié', color: '#3B82F6' },
  confirmed: { label: 'Confirmé', color: '#22C55E' },
};

function PortalContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [script, setScript] = useState<Script | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [tab, setTab] = useState<'script' | 'comments'>('script');

  const loadScript = useCallback(() => {
    if (!token) return;
    fetch(`/api/scripts?token=${token}`)
      .then(r => { if (!r.ok) throw new Error('Lien invalide ou expiré'); return r.json(); })
      .then(d => setScript(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { loadScript(); }, [loadScript]);

  async function handleValidate() {
    if (!confirm('Confirmer et valider ce script ? Le tournage sera planifié.')) return;
    setActionLoading(true);
    try {
      await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      });
      loadScript();
    } finally { setActionLoading(false); }
  }

  async function handleRequestChanges() {
    setActionLoading(true);
    try {
      await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes' }),
      });
      loadScript();
    } finally { setActionLoading(false); }
  }

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    try {
      await fetch(`/api/scripts/comments?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: comment }),
      });
      setComment('');
      loadScript();
    } finally { setSending(false); }
  }

  if (!token) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
      Lien invalide. Contactez votre gestionnaire de compte.
    </div>
  );

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
    </div>
  );

  if (error) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ color: 'var(--red)', fontSize: '0.9rem', marginBottom: 8 }}>{error}</div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Contactez votre gestionnaire de compte si le problème persiste.</p>
    </div>
  );

  if (!script) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: 'var(--orange)', marginBottom: 8 }}>BourbonMédia</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Votre script est en cours de préparation. Vous serez notifié lorsqu&#39;il sera prêt.</p>
    </div>
  );

  const statusInfo = SCRIPT_STATUS[script.status] || { label: script.status, color: '#8A7060' };
  const canValidate = script.status === 'proposition' || script.status === 'modified';

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.3rem', color: 'var(--orange)', marginBottom: 4 }}>
          BourbonMédia
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Espace client</p>
      </div>

      {/* Status + actions */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        marginBottom: 20, padding: '14px 18px', borderRadius: 10,
        background: 'var(--night-card)', border: '1px solid var(--border)',
      }}>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Statut du script</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusInfo.color }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</span>
          </div>
        </div>
        {canValidate && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleRequestChanges} disabled={actionLoading} style={{
              padding: '8px 16px', borderRadius: 8,
              background: 'rgba(250,204,21,.1)', border: '1px solid rgba(250,204,21,.3)',
              color: 'var(--yellow)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
            }}>Demander des modifications</button>
            <button onClick={handleValidate} disabled={actionLoading} style={{
              padding: '8px 16px', borderRadius: 8, background: 'var(--green)',
              color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
            }}>Valider le script</button>
          </div>
        )}
        {script.status === 'confirmed' && (
          <span style={{ fontSize: '0.8rem', color: 'var(--green)', fontWeight: 500 }}>
            Script validé — tournage en cours de planification
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
        {(['script', 'comments'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: tab === t ? 600 : 400,
            background: tab === t ? 'var(--night-card)' : 'transparent',
            color: tab === t ? 'var(--orange)' : 'var(--text-muted)',
            borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
          }}>
            {t === 'script' ? 'Script' : `Commentaires${script.script_comments?.length ? ` (${script.script_comments.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Script view */}
      {tab === 'script' && (
        <ScriptEditor content={script.content} onSave={() => {}} readOnly />
      )}

      {/* Comments */}
      {tab === 'comments' && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {script.script_comments && script.script_comments.length > 0 ? (
              script.script_comments.map(c => (
                <div key={c.id} style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: c.author_type === 'client' ? 'rgba(232,105,43,.08)' : 'var(--night-card)',
                  border: `1px solid ${c.author_type === 'client' ? 'var(--border-orange)' : 'var(--border)'}`,
                  marginLeft: c.author_type === 'client' ? 24 : 0,
                  marginRight: c.author_type === 'admin' ? 24 : 0,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{
                      fontSize: '0.75rem', fontWeight: 600,
                      color: c.author_type === 'client' ? 'var(--orange)' : 'var(--text-mid)',
                    }}>{c.author_name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>{c.content}</p>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>Aucun commentaire pour l&#39;instant</p>
            )}
          </div>

          <form onSubmit={handleSendComment} style={{ display: 'flex', gap: 8 }}>
            <input
              value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Écrire un commentaire…"
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 8,
                background: 'var(--night-card)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.85rem',
              }}
            />
            <button type="submit" disabled={sending || !comment.trim()} style={{
              padding: '10px 18px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.8rem',
              cursor: 'pointer', opacity: sending || !comment.trim() ? 0.5 : 1,
            }}>{sending ? '…' : 'Envoyer'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function PortalPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
    </div>}>
      <PortalContent />
    </Suspense>
  );
}
