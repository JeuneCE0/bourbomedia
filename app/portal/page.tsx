'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
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

interface ClientDelivery {
  business_name?: string;
  contact_name?: string;
  status?: string;
  video_url?: string;
  video_thumbnail_url?: string;
  delivery_notes?: string;
  delivered_at?: string;
  filming_date?: string;
  publication_deadline?: string;
  contract_pdf_url?: string;
  contract_signature_link?: string;
}

interface VideoDelivery {
  id: string;
  title?: string;
  video_url: string;
  thumbnail_url?: string;
  delivery_notes?: string;
  delivered_at?: string;
}

interface PortalPayment {
  id: string;
  amount: number;
  currency: string;
  description?: string;
  receipt_url?: string;
  invoice_pdf_url?: string;
  invoice_number?: string;
  created_at: string;
}

interface PortalNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read_at?: string | null;
  created_at: string;
}

interface SatisfactionData {
  rating: number;
  comment?: string;
  allow_testimonial: boolean;
  created_at: string;
}

const STATUS_LABELS_PORTAL: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture du script',
  script_review: 'Relecture du script',
  script_validated: 'Script validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tournage terminé',
  editing: 'Montage en cours',
  published: 'Vidéo publiée',
};

const PROJECT_STAGES = [
  { key: 'onboarding', label: 'Inscription', icon: '◎' },
  { key: 'script_writing', label: 'Script', icon: '✎' },
  { key: 'script_review', label: 'Relecture', icon: '◉' },
  { key: 'script_validated', label: 'Validé', icon: '✓' },
  { key: 'filming_scheduled', label: 'Tournage', icon: '▶' },
  { key: 'filming_done', label: 'Tourné', icon: '●' },
  { key: 'editing', label: 'Montage', icon: '◈' },
  { key: 'published', label: 'Livré', icon: '★' },
];

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
  const [clientInfo, setClientInfo] = useState<ClientDelivery | null>(null);
  const [videos, setVideos] = useState<VideoDelivery[]>([]);
  const [payments, setPayments] = useState<PortalPayment[]>([]);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [satisfaction, setSatisfaction] = useState<SatisfactionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [tab, setTab] = useState<'script' | 'comments' | 'video' | 'documents' | 'feedback'>('script');
  const bellRef = useRef<HTMLDivElement>(null);

  // Close bell dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadScript = useCallback(() => {
    if (!token) return;
    fetch(`/api/scripts?token=${token}`)
      .then(r => { if (!r.ok) throw new Error('Lien invalide ou expiré'); return r.json(); })
      .then(d => {
        if (d && typeof d === 'object' && 'script' in d) {
          setScript(d.script);
          setClientInfo(d.client || null);
          if (Array.isArray(d.videos)) setVideos(d.videos);
          if (Array.isArray(d.payments)) setPayments(d.payments);
        } else {
          setScript(d);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const loadNotifications = useCallback(() => {
    if (!token) return;
    fetch(`/api/notifications?token=${token}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setNotifications(d); })
      .catch(() => {});
  }, [token]);

  const loadSatisfaction = useCallback(() => {
    if (!token) return;
    fetch(`/api/satisfaction?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setSatisfaction(d))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadScript();
    loadNotifications();
    loadSatisfaction();
  }, [loadScript, loadNotifications, loadSatisfaction]);

  // Auto-switch to video tab when delivery becomes available
  useEffect(() => {
    if (videos.length > 0 || (clientInfo?.delivered_at && clientInfo.video_url)) {
      setTab(t => t === 'script' ? 'video' : t);
    }
  }, [videos.length, clientInfo?.delivered_at, clientInfo?.video_url]);

  const unreadCount = notifications.filter(n => !n.read_at).length;

  async function handleMarkAllRead() {
    if (unreadCount === 0) return;
    try {
      await fetch(`/api/notifications?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] }),
      });
      loadNotifications();
    } catch { /* */ }
  }

  async function handleValidate() {
    setActionLoading(true);
    try {
      await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      });
      setShowValidationModal(false);
      loadScript();
      loadNotifications();
    } finally { setActionLoading(false); }
  }

  async function handleSubmitSatisfaction(rating: number, comment: string, allowTestimonial: boolean) {
    setActionLoading(true);
    try {
      const r = await fetch(`/api/satisfaction?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment, allow_testimonial: allowTestimonial }),
      });
      if (r.ok) loadSatisfaction();
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
      loadNotifications();
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

  if (!script) {
    // If video already delivered, show it even without a script
    if (clientInfo?.video_url) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
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
            <div style={{ marginBottom: 18, textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🎉</div>
              <h2 style={{
                fontSize: '1.2rem', color: 'var(--orange)', margin: 0, fontWeight: 700,
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}>Votre vidéo est prête !</h2>
              {clientInfo.delivered_at && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  Livrée le {new Date(clientInfo.delivered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
            <VideoEmbed url={clientInfo.video_url} thumbnail={clientInfo.video_thumbnail_url} />
            {clientInfo.delivery_notes && (
              <div style={{
                marginTop: 16, padding: '14px 16px', borderRadius: 10,
                background: 'var(--night-card)', border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
                  Message de l&#39;équipe
                </div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {clientInfo.delivery_notes}
                </p>
              </div>
            )}
          </main>
        </div>
      );
    }
    return (
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
  }

  const currentStepIdx = SCRIPT_STEPS.findIndex(s => s.key === script.status);
  const statusInfo = SCRIPT_STEPS[currentStepIdx] || SCRIPT_STEPS[0];
  const canValidate = script.status === 'proposition' || script.status === 'modified';

  const deliveredVideos = videos.filter(v => v.delivered_at);
  const hasDelivery = deliveredVideos.length > 0 || (clientInfo?.delivered_at && clientInfo.video_url);
  const clientStatus = clientInfo?.status || '';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--night-mid)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ flex: 1 }}>
          {clientInfo?.contact_name && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-mid)', fontWeight: 500 }}>
              {clientInfo.contact_name}
            </span>
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '1.1rem', color: 'var(--orange)', margin: 0,
          }}>BourbonMédia</h1>
        </div>
        <div ref={bellRef} style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
          <button onClick={() => { setBellOpen(!bellOpen); if (!bellOpen) handleMarkAllRead(); }} style={{
            position: 'relative', background: 'transparent', border: 'none',
            color: 'var(--text)', cursor: 'pointer', padding: 6, borderRadius: 8,
            fontSize: '1.1rem', lineHeight: 1,
          }}>
            🔔
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: -2, right: -2,
                background: 'var(--orange)', color: '#fff',
                fontSize: '0.6rem', fontWeight: 700,
                minWidth: 16, height: 16, padding: '0 4px', borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(232,105,43,.4)',
              }}>{unreadCount}</span>
            )}
          </button>
          {bellOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 320,
              background: 'var(--night-card)', border: '1px solid var(--border-md)',
              borderRadius: 12, maxHeight: 400, overflowY: 'auto',
              boxShadow: '0 12px 32px rgba(0,0,0,.5)', zIndex: 1000,
            }}>
              <div style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-mid)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>Notifications</div>
              {notifications.length === 0 ? (
                <p style={{ padding: 20, textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Aucune notification
                </p>
              ) : (
                notifications.map(n => (
                  <div key={n.id} style={{
                    padding: '10px 14px', borderBottom: '1px solid var(--border)',
                    background: n.read_at ? 'transparent' : 'rgba(232,105,43,.04)',
                  }}>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 4, opacity: 0.7 }}>
                      {relativeTime(n.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 800, width: '100%', margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)' }}>
        {/* Welcome + project progress */}
        <div style={{
          marginBottom: 22, padding: '18px 20px', borderRadius: 14,
          background: 'var(--night-card)', border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div>
              <h2 style={{
                fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
                fontSize: '1.15rem', color: 'var(--text)', margin: 0,
              }}>
                {clientInfo?.business_name || 'Votre projet'}
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
                {STATUS_LABELS_PORTAL[clientStatus] || 'En cours'}
                {clientInfo?.filming_date && (clientStatus === 'filming_scheduled' || clientStatus === 'script_validated') && (
                  <span style={{ color: '#60A5FA' }}>
                    {' '}— Tournage le {new Date(clientInfo.filming_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                  </span>
                )}
              </p>
            </div>
            {clientInfo?.publication_deadline && (
              <span style={{
                fontSize: '0.68rem', padding: '4px 10px', borderRadius: 12,
                background: 'rgba(59,130,246,.08)', color: '#60A5FA', fontWeight: 600,
              }}>
                Publication {new Date(clientInfo.publication_deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>

          {/* Project progress bar */}
          {(() => {
            const stageIdx = PROJECT_STAGES.findIndex(s => s.key === clientStatus);
            const progress = stageIdx >= 0 ? Math.round(((stageIdx + 1) / PROJECT_STAGES.length) * 100) : 0;
            return (
              <div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 500 }}>Progression du projet</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--orange)', fontWeight: 700 }}>{progress}%</span>
                </div>
                <div style={{
                  height: 6, borderRadius: 3, background: 'var(--night-mid)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    background: progress >= 100 ? 'var(--green)' : 'linear-gradient(90deg, var(--orange), #F28C55)',
                    width: `${progress}%`, transition: 'width .5s ease',
                  }} />
                </div>
                {/* Mini milestone dots */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', marginTop: 6,
                  padding: '0 2px',
                }}>
                  {PROJECT_STAGES.map((stage, i) => {
                    const done = i <= stageIdx;
                    const isCurrent = i === stageIdx;
                    return (
                      <div key={stage.key} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        opacity: done ? 1 : 0.35,
                      }}>
                        <span style={{
                          fontSize: '0.55rem', color: isCurrent ? 'var(--orange)' : done ? 'var(--green)' : 'var(--text-muted)',
                          fontWeight: isCurrent ? 700 : 500,
                        }}>{stage.icon}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Script progress stepper */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0, marginBottom: 22, padding: '0 8px', overflowX: 'auto',
        }}>
          {SCRIPT_STEPS.map((step, i) => {
            const done = i <= currentStepIdx;
            const isCurrent = i === currentStepIdx;
            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
                  <div style={{
                    width: isCurrent ? 28 : 20, height: isCurrent ? 28 : 20,
                    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? step.color : 'var(--night-mid)',
                    border: `2px solid ${done ? step.color : 'var(--border-md)'}`,
                    boxShadow: isCurrent ? `0 0 10px ${step.color}40` : 'none',
                    transition: 'all .3s',
                    fontSize: '0.6rem', color: done ? '#fff' : 'var(--text-muted)', fontWeight: 700,
                  }}>{done ? '✓' : i + 1}</div>
                  <span style={{
                    fontSize: '0.58rem', color: isCurrent ? statusInfo.color : 'var(--text-muted)',
                    fontWeight: isCurrent ? 600 : 400, marginTop: 4, textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}>{step.label}</span>
                </div>
                {i < SCRIPT_STEPS.length - 1 && (
                  <div style={{
                    width: 20, height: 2, background: i < currentStepIdx ? SCRIPT_STEPS[i + 1].color : 'var(--border-md)',
                    margin: '0 2px', marginBottom: 16, borderRadius: 1,
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
                <button onClick={() => setShowValidationModal(true)} disabled={actionLoading} style={{
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
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {([
            ...(hasDelivery ? ['video' as const] : []),
            'script' as const,
            'comments' as const,
            'documents' as const,
            ...(hasDelivery ? ['feedback' as const] : []),
          ]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 18px', border: 'none', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: tab === t ? 600 : 400,
              background: 'transparent',
              color: tab === t ? 'var(--orange)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
              transition: 'all .15s',
              whiteSpace: 'nowrap',
            }}>
              {t === 'video' ? `🎬 Vos vidéos${deliveredVideos.length > 1 ? ` (${deliveredVideos.length})` : ''}`
                : t === 'script' ? '📄 Script'
                : t === 'comments' ? `💬 Commentaires${script.script_comments?.length ? ` (${script.script_comments.length})` : ''}`
                : t === 'documents' ? '📂 Documents'
                : `⭐ Feedback${satisfaction ? ' ✓' : ''}`}
            </button>
          ))}
        </div>

        {/* Video delivery view (multi-video) */}
        {tab === 'video' && hasDelivery && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Render new multi-videos first */}
            {deliveredVideos.map((v, idx) => (
              <div key={v.id} style={{
                background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
                padding: 'clamp(16px, 3vw, 24px)',
              }}>
                {idx === 0 && (
                  <div style={{ marginBottom: 18, textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
                    <h2 style={{
                      fontSize: '1.1rem', color: 'var(--orange)', margin: 0, fontWeight: 700,
                      fontFamily: "'Bricolage Grotesque', sans-serif",
                    }}>{deliveredVideos.length === 1 ? 'Votre vidéo est prête !' : 'Vos vidéos sont prêtes !'}</h2>
                  </div>
                )}
                {v.title && (
                  <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: 'var(--text)', fontWeight: 600 }}>
                    {v.title}
                  </h3>
                )}
                {v.delivered_at && (
                  <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Livrée le {new Date(v.delivered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                )}
                <VideoEmbed url={v.video_url} thumbnail={v.thumbnail_url} />
                {v.delivery_notes && (
                  <div style={{
                    marginTop: 14, padding: '12px 14px', borderRadius: 10,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
                      Message de l&#39;équipe
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {v.delivery_notes}
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href={v.video_url} target="_blank" rel="noreferrer" style={{
                    padding: '8px 16px', borderRadius: 8, background: 'var(--orange)',
                    color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.8rem',
                  }}>Ouvrir ↗</a>
                  <a href={v.video_url} download style={{
                    padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                    border: '1px solid var(--border-md)', color: 'var(--text)',
                    textDecoration: 'none', fontWeight: 600, fontSize: '0.8rem',
                  }}>⇩ Télécharger</a>
                </div>
              </div>
            ))}

            {/* Legacy single-video fallback */}
            {deliveredVideos.length === 0 && clientInfo?.video_url && (
              <div style={{
                background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
                padding: 'clamp(16px, 3vw, 24px)',
              }}>
                <div style={{ marginBottom: 18, textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
                  <h2 style={{
                    fontSize: '1.1rem', color: 'var(--orange)', margin: 0, fontWeight: 700,
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                  }}>Votre vidéo est prête !</h2>
                </div>
                <VideoEmbed url={clientInfo.video_url} thumbnail={clientInfo.video_thumbnail_url} />
                {clientInfo.delivery_notes && (
                  <div style={{
                    marginTop: 14, padding: '12px 14px', borderRadius: 10,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                  }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {clientInfo.delivery_notes}
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
                  <a href={clientInfo.video_url} target="_blank" rel="noreferrer" style={{
                    padding: '8px 16px', borderRadius: 8, background: 'var(--orange)',
                    color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.8rem',
                  }}>Ouvrir ↗</a>
                  <a href={clientInfo.video_url} download style={{
                    padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                    border: '1px solid var(--border-md)', color: 'var(--text)',
                    textDecoration: 'none', fontWeight: 600, fontSize: '0.8rem',
                  }}>⇩ Télécharger</a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Documents tab */}
        {tab === 'documents' && (
          <div style={{
            background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            padding: 'clamp(16px, 3vw, 24px)',
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem', color: 'var(--text)', fontWeight: 600 }}>
              📂 Vos documents
            </h3>

            {/* Contract */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>
                Contrat
              </h4>
              {clientInfo?.contract_pdf_url ? (
                <a href={clientInfo.contract_pdf_url} target="_blank" rel="noreferrer" style={docLinkStyle}>
                  <span style={{ fontSize: '1.2rem' }}>📄</span>
                  <span style={{ flex: 1 }}>Contrat signé (PDF)</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Télécharger ↗</span>
                </a>
              ) : clientInfo?.contract_signature_link ? (
                <a href={clientInfo.contract_signature_link} target="_blank" rel="noreferrer" style={docLinkStyle}>
                  <span style={{ fontSize: '1.2rem' }}>✍</span>
                  <span style={{ flex: 1 }}>Voir le contrat</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Ouvrir ↗</span>
                </a>
              ) : (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                  Aucun contrat disponible pour le moment
                </p>
              )}
            </div>

            {/* Invoices / receipts */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>
                Factures &amp; reçus
              </h4>
              {payments.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {payments.map(p => (
                    <div key={p.id} style={{
                      ...docLinkStyle, cursor: 'default',
                    }}>
                      <span style={{ fontSize: '1.1rem' }}>💳</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>
                          {(p.amount / 100).toLocaleString('fr-FR')} {p.currency.toUpperCase()}
                          {p.invoice_number && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 8 }}>· N° {p.invoice_number}</span>}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {p.description || 'Paiement'} · {new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                      {p.invoice_pdf_url ? (
                        <a href={p.invoice_pdf_url} target="_blank" rel="noreferrer" style={smallLinkStyle}>Facture PDF ↗</a>
                      ) : p.receipt_url ? (
                        <a href={p.receipt_url} target="_blank" rel="noreferrer" style={smallLinkStyle}>Reçu ↗</a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                  Aucune facture disponible
                </p>
              )}
            </div>

            {/* Script PDF */}
            {script?.status === 'confirmed' && (
              <div>
                <h4 style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>
                  Script
                </h4>
                <a href={`/portal/print?token=${token}`} target="_blank" rel="noreferrer" style={docLinkStyle}>
                  <span style={{ fontSize: '1.2rem' }}>📝</span>
                  <span style={{ flex: 1 }}>Script validé (PDF)</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Télécharger ↗</span>
                </a>
              </div>
            )}
          </div>
        )}

        {/* Feedback tab */}
        {tab === 'feedback' && (
          <SatisfactionForm
            existing={satisfaction}
            onSubmit={handleSubmitSatisfaction}
            loading={actionLoading}
          />
        )}

        {/* Script view */}
        {tab === 'script' && (
          <>
            <ScriptEditor content={script.content} onSave={() => {}} readOnly />
            {script.status === 'confirmed' && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <a href={`/portal/print?token=${token}`} target="_blank" rel="noreferrer" style={{
                  display: 'inline-block', padding: '9px 18px', borderRadius: 8,
                  background: 'var(--night-card)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', textDecoration: 'none', fontSize: '0.82rem',
                }}>⇩ Télécharger le script (PDF)</a>
              </div>
            )}
          </>
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
        padding: '18px 20px', borderTop: '1px solid var(--border)',
        textAlign: 'center', background: 'var(--night-mid)',
      }}>
        <p style={{
          color: 'var(--orange)', fontSize: '0.72rem', margin: 0,
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600,
          letterSpacing: '0.02em',
        }}>
          BourbonMédia
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.62rem', margin: '3px 0 0' }}>
          Votre partenaire vidéo à La Réunion
        </p>
      </footer>

      {/* Validation modal: preview before validating */}
      {showValidationModal && script && (
        <div onClick={() => setShowValidationModal(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--night-card)', borderRadius: 14,
            border: '1px solid var(--border-orange)',
            maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.6)',
          }}>
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
                Confirmer la validation du script
              </h3>
              <button onClick={() => setShowValidationModal(false)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, padding: 4,
              }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.6 }}>
                Vérifiez une dernière fois votre script ci-dessous. Une fois validé, le tournage sera planifié automatiquement.
              </p>
              <div style={{
                background: 'var(--night)', borderRadius: 10, padding: 16,
                border: '1px solid var(--border)', maxHeight: 400, overflowY: 'auto',
              }}>
                <ScriptEditor content={script.content} onSave={() => {}} readOnly />
              </div>
            </div>

            <div style={{
              padding: '14px 20px', borderTop: '1px solid var(--border)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button onClick={() => setShowValidationModal(false)} disabled={actionLoading} style={{
                padding: '10px 18px', borderRadius: 8,
                background: 'transparent', border: '1px solid var(--border-md)',
                color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem',
              }}>Annuler</button>
              <button onClick={handleValidate} disabled={actionLoading} style={{
                padding: '10px 24px', borderRadius: 8, background: 'var(--green)',
                color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem',
                boxShadow: '0 2px 8px rgba(34,197,94,.3)',
              }}>
                {actionLoading ? 'Validation…' : '✓ Confirmer et valider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const docLinkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 14px', borderRadius: 10,
  background: 'var(--night-mid)', border: '1px solid var(--border)',
  textDecoration: 'none', color: 'var(--text)',
  transition: 'border-color .15s', fontSize: '0.85rem',
};

const smallLinkStyle: React.CSSProperties = {
  fontSize: '0.74rem', color: 'var(--orange)',
  textDecoration: 'none', whiteSpace: 'nowrap',
  padding: '4px 10px', borderRadius: 6,
  background: 'rgba(232,105,43,.08)',
};

function SatisfactionForm({ existing, onSubmit, loading }: {
  existing: SatisfactionData | null;
  onSubmit: (rating: number, comment: string, allowTestimonial: boolean) => void;
  loading: boolean;
}) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [comment, setComment] = useState(existing?.comment || '');
  const [allowTestimonial, setAllowTestimonial] = useState(existing?.allow_testimonial || false);
  const [hover, setHover] = useState(0);

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
      padding: 'clamp(20px, 4vw, 32px)', textAlign: 'center',
    }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>⭐</div>
      <h3 style={{
        fontSize: '1.1rem', color: 'var(--text)', fontWeight: 600,
        margin: '0 0 8px', fontFamily: "'Bricolage Grotesque', sans-serif",
      }}>
        {existing ? 'Votre avis' : 'Comment évaluez-vous notre travail ?'}
      </h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        {existing ? `Merci pour votre feedback envoyé le ${new Date(existing.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Votre retour nous aide à nous améliorer ✨'}
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '2.2rem', padding: 4, lineHeight: 1,
              color: (hover || rating) >= n ? '#FACC15' : 'var(--border-md)',
              transition: 'transform .15s, color .15s',
              transform: hover === n ? 'scale(1.15)' : 'scale(1)',
            }}
          >★</button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Un mot pour nous (optionnel) ?"
        rows={3}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          background: 'var(--night-mid)', border: '1px solid var(--border-md)',
          color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
          fontFamily: 'inherit', resize: 'vertical', outline: 'none', marginBottom: 14,
        }}
      />

      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        padding: '10px 12px', borderRadius: 8, background: 'var(--night-mid)',
        marginBottom: 18, textAlign: 'left',
      }}>
        <input
          type="checkbox"
          checked={allowTestimonial}
          onChange={e => setAllowTestimonial(e.target.checked)}
          style={{ accentColor: 'var(--orange)' }}
        />
        <span style={{ fontSize: '0.78rem', color: 'var(--text-mid)' }}>
          J&#39;autorise BourbonMédia à utiliser mon avis comme témoignage public
        </span>
      </label>

      <button
        onClick={() => onSubmit(rating, comment, allowTestimonial)}
        disabled={loading || rating === 0}
        style={{
          padding: '12px 28px', borderRadius: 10, background: 'var(--orange)',
          color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.88rem',
          cursor: loading || rating === 0 ? 'not-allowed' : 'pointer',
          opacity: loading || rating === 0 ? 0.5 : 1,
          boxShadow: '0 2px 10px rgba(232,105,43,.3)',
        }}
      >{loading ? 'Envoi…' : existing ? 'Mettre à jour' : 'Envoyer mon avis'}</button>
    </div>
  );
}

function VideoEmbed({ url, thumbnail }: { url: string; thumbnail?: string }) {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return (
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
        <iframe
          src={`https://www.youtube.com/embed/${ytMatch[1]}`}
          title="Votre vidéo"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    );
  }
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return (
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
        <iframe
          src={`https://player.vimeo.com/video/${vimeoMatch[1]}`}
          title="Votre vidéo"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    );
  }
  // Direct video file (mp4/webm/mov)
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
    return (
      <video
        src={url}
        controls
        poster={thumbnail}
        style={{ width: '100%', borderRadius: 12, background: '#000', display: 'block' }}
      />
    );
  }
  // Fallback: link card with thumbnail
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{
      display: 'block', textDecoration: 'none', borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--border)', background: 'var(--night-mid)',
    }}>
      {thumbnail && (
        <div style={{
          position: 'relative', paddingBottom: '56.25%', height: 0,
          backgroundImage: `url(${thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center',
        }}>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,.3)',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: 'var(--orange)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', color: '#fff',
            }}>▶</div>
          </div>
        </div>
      )}
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: '0.82rem', color: 'var(--orange)', fontWeight: 600 }}>
          Cliquez pour visionner votre vidéo ↗
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
          {url}
        </div>
      </div>
    </a>
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
