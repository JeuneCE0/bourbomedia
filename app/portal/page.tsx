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

const SCRIPT_STEPS = [
  { key: 'draft', label: 'Préparation', color: '#8A7060' },
  { key: 'proposition', label: 'Proposition', color: '#F28C55' },
  { key: 'awaiting_changes', label: 'Modifications', color: '#FACC15' },
  { key: 'modified', label: 'Modifié', color: '#3B82F6' },
  { key: 'confirmed', label: 'Confirmé', color: '#22C55E' },
];

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 30) return `Il y a ${days} jours`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔗</div>
        <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: 'var(--text)', marginBottom: 8, fontSize: '1.1rem' }}>Lien invalide</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>
          Ce lien ne semble pas valide. Contactez votre gestionnaire de compte BourbonMédia pour recevoir un nouveau lien d&#39;accès.
        </p>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--border-md)', borderTopColor: 'var(--orange)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement de votre espace…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚠</div>
        <div style={{ color: 'var(--red)', fontSize: '0.95rem', fontWeight: 600, marginBottom: 8 }}>{error}</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
          Si le problème persiste, contactez votre gestionnaire de compte.
        </p>
      </div>
    </div>
  );

  if (!script) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.5rem', color: 'var(--orange)', marginBottom: 8 }}>
          BourbonMédia
        </h1>
        <div style={{ fontSize: '2.5rem', margin: '20px 0' }}>✍</div>
        <h2 style={{ fontSize: '1rem', color: 'var(--text)', marginBottom: 8 }}>Votre script est en préparation</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>
          Notre équipe travaille sur votre script vidéo. Vous recevrez une notification dès qu&#39;il sera prêt pour votre relecture.
        </p>
      </div>
    </div>
  );

  const currentStepIdx = SCRIPT_STEPS.findIndex(s => s.key === script.status);
  const statusInfo = SCRIPT_STEPS[currentStepIdx] || SCRIPT_STEPS[0];
  const canValidate = script.status === 'proposition' || script.status === 'modified';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--night-mid)', textAlign: 'center',
      }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '1.2rem', color: 'var(--orange)', margin: 0,
        }}>BourbonMédia</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '4px 0 0' }}>Espace client</p>
      </header>

      <main style={{ flex: 1, maxWidth: 800, width: '100%', margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)' }}>
        {/* Progress stepper */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0, marginBottom: 24, padding: '0 8px', overflowX: 'auto',
        }}>
          {SCRIPT_STEPS.map((step, i) => {
            const done = i <= currentStepIdx;
            const isCurrent = i === currentStepIdx;
            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
                  <div style={{
                    width: isCurrent ? 28 : 20, height: isCurrent ? 28 : 20,
                    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? step.color : 'var(--night-mid)',
                    border: `2px solid ${done ? step.color : 'var(--border-md)'}`,
                    boxShadow: isCurrent ? `0 0 12px ${step.color}50` : 'none',
                    transition: 'all .3s',
                    fontSize: '0.6rem', color: done ? '#fff' : 'var(--text-muted)', fontWeight: 700,
                  }}>{done ? '✓' : i + 1}</div>
                  <span style={{
                    fontSize: '0.6rem', color: isCurrent ? statusInfo.color : 'var(--text-muted)',
                    fontWeight: isCurrent ? 600 : 400, marginTop: 4, textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}>{step.label}</span>
                </div>
                {i < SCRIPT_STEPS.length - 1 && (
                  <div style={{
                    width: 24, height: 2, background: i < currentStepIdx ? SCRIPT_STEPS[i + 1].color : 'var(--border-md)',
                    margin: '0 2px', marginBottom: 18, borderRadius: 1,
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Status card + actions */}
        <div style={{
          background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
          padding: 'clamp(14px, 3vw, 20px)', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Statut du script</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: statusInfo.color,
                  boxShadow: `0 0 8px ${statusInfo.color}40`,
                }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</span>
              </div>
            </div>

            {canValidate && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={handleRequestChanges} disabled={actionLoading} style={{
                  padding: '10px 20px', borderRadius: 10,
                  background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.25)',
                  color: 'var(--yellow)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
                  transition: 'all .15s',
                }}>✎ Demander des modifications</button>
                <button onClick={handleValidate} disabled={actionLoading} style={{
                  padding: '10px 24px', borderRadius: 10, background: 'var(--green)',
                  color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(34,197,94,.3)',
                  transition: 'all .15s',
                }}>✓ Valider le script</button>
              </div>
            )}

            {script.status === 'confirmed' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
                background: 'rgba(34,197,94,.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,.2)',
              }}>
                <span style={{ fontSize: '1rem' }}>✓</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--green)', fontWeight: 500 }}>
                  Script validé — tournage en cours de planification
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {(['script', 'comments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: tab === t ? 600 : 400,
              background: 'transparent',
              color: tab === t ? 'var(--orange)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
              transition: 'all .15s',
            }}>
              {t === 'script' ? '📄 Script' : `💬 Commentaires${script.script_comments?.length ? ` (${script.script_comments.length})` : ''}`}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {script.script_comments && script.script_comments.length > 0 ? (
                script.script_comments.map(c => {
                  const isClient = c.author_type === 'client';
                  return (
                    <div key={c.id} style={{
                      display: 'flex', justifyContent: isClient ? 'flex-end' : 'flex-start',
                    }}>
                      <div style={{
                        maxWidth: '80%', padding: '12px 16px', borderRadius: 14,
                        borderBottomRightRadius: isClient ? 4 : 14,
                        borderBottomLeftRadius: isClient ? 14 : 4,
                        background: isClient ? 'rgba(232,105,43,.1)' : 'var(--night-card)',
                        border: `1px solid ${isClient ? 'var(--border-orange)' : 'var(--border)'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 600,
                            color: isClient ? 'var(--orange)' : 'var(--text-mid)',
                          }}>{c.author_name}</span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {relativeTime(c.created_at)}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{c.content}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.5 }}>💬</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Aucun commentaire pour l&#39;instant. N&#39;hésitez pas à nous faire part de vos retours !
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handleSendComment} style={{
              display: 'flex', gap: 8, padding: '12px 0',
              borderTop: '1px solid var(--border)',
              position: 'sticky', bottom: 0, background: 'var(--night)',
            }}>
              <input
                value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Écrire un commentaire…"
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 12,
                  background: 'var(--night-card)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
                }}
              />
              <button type="submit" disabled={sending || !comment.trim()} style={{
                padding: '12px 20px', borderRadius: 12, background: 'var(--orange)',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.85rem',
                cursor: 'pointer', opacity: sending || !comment.trim() ? 0.4 : 1,
                transition: 'opacity .15s',
              }}>{sending ? '⟳' : '➤'}</button>
            </form>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '16px 20px', borderTop: '1px solid var(--border)',
        textAlign: 'center', background: 'var(--night-mid)',
      }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', margin: 0 }}>
          BourbonMédia — Votre partenaire vidéo à La Réunion
        </p>
      </footer>
    </div>
  );
}

export default function PortalPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border-md)', borderTopColor: 'var(--orange)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    }>
      <PortalContent />
    </Suspense>
  );
}
