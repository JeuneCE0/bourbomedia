'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Annotation } from '@/components/ScriptAnnotator';

const ScriptEditor = dynamic(() => import('@/components/ScriptEditor'), { ssr: false });
const ScriptAnnotator = dynamic(() => import('@/components/ScriptAnnotator'), { ssr: false });

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
  { key: 'onboarding', label: 'Inscription', emoji: '👋', description: 'Vous êtes inscrit·e — bienvenue !' },
  { key: 'script_writing', label: 'Écriture du script', emoji: '✍️', description: 'Notre équipe écrit votre script sur mesure.' },
  { key: 'script_review', label: 'Relecture du script', emoji: '📝', description: 'Le script vous est proposé pour relecture.' },
  { key: 'script_validated', label: 'Script validé', emoji: '✅', description: 'Vous avez validé le script — on planifie le tournage.' },
  { key: 'filming_scheduled', label: 'Tournage planifié', emoji: '📅', description: 'Une date de tournage est confirmée.' },
  { key: 'filming_done', label: 'Tournage terminé', emoji: '🎬', description: 'Le tournage est dans la boîte !' },
  { key: 'editing', label: 'Montage en cours', emoji: '🎞️', description: 'Notre équipe monte votre vidéo.' },
  { key: 'published', label: 'Vidéo livrée', emoji: '🎉', description: 'Votre vidéo est prête à être visionnée.' },
];

const SCRIPT_STEPS = [
  { key: 'draft', label: 'Préparation', color: '#8A7060' },
  { key: 'proposition', label: 'À relire', color: '#F28C55' },
  { key: 'awaiting_changes', label: 'Modifs demandées', color: '#FACC15' },
  { key: 'modified', label: 'Nouvelle version', color: '#3B82F6' },
  { key: 'confirmed', label: 'Validé', color: '#22C55E' },
];

// Compute the urgency tone of the publication deadline
function deadlineTone(deadline?: string | null): { tone: 'red' | 'yellow' | 'blue'; emoji: string; label: string } | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (days < 0) return { tone: 'red', emoji: '⚠️', label: `Publication en retard de ${Math.abs(days)}j` };
  if (days <= 2) return { tone: 'red', emoji: '🔴', label: `Publication dans ${days}j` };
  if (days <= 7) return { tone: 'yellow', emoji: '🟡', label: `Publication dans ${days}j` };
  return { tone: 'blue', emoji: '📅', label: `Publication dans ${days}j` };
}

interface NextAction {
  pill: { tone: 'orange' | 'green' | 'blue' | 'red' | 'yellow'; emoji: string; label: string };
  description: string;
  cta?: { label: string; tab?: 'video' | 'script' | 'comments' | 'feedback' };
}

function computeNextAction(scriptStatus: string | null, hasDelivery: boolean, hasFeedback: boolean): NextAction {
  if (hasDelivery && !hasFeedback) {
    return {
      pill: { tone: 'orange', emoji: '⭐', label: 'Donnez-nous votre avis' },
      description: 'Votre vidéo est livrée — on aimerait beaucoup connaître votre ressenti.',
      cta: { label: 'Laisser mon avis', tab: 'feedback' },
    };
  }
  if (hasDelivery) {
    return {
      pill: { tone: 'green', emoji: '🎉', label: 'Projet terminé' },
      description: 'Votre vidéo est en ligne — un grand merci pour votre confiance.',
      cta: { label: 'Voir ma vidéo', tab: 'video' },
    };
  }
  if (scriptStatus === 'proposition' || scriptStatus === 'modified') {
    return {
      pill: { tone: 'yellow', emoji: '🟡', label: 'À vous de jouer' },
      description: scriptStatus === 'modified'
        ? 'Une nouvelle version du script est prête. Relisez-la et validez-la.'
        : 'Votre script vous attend. Relisez-le et validez-le (ou demandez des modifications).',
      cta: { label: 'Voir le script', tab: 'script' },
    };
  }
  if (scriptStatus === 'awaiting_changes') {
    return {
      pill: { tone: 'blue', emoji: '✍️', label: 'On retravaille votre script' },
      description: 'Vos retours ont été pris en compte. Notre équipe prépare la nouvelle version.',
    };
  }
  if (scriptStatus === 'confirmed') {
    return {
      pill: { tone: 'green', emoji: '✅', label: 'Script validé' },
      description: 'Le tournage va être planifié. Vous serez notifié·e dès qu\'une date est proposée.',
    };
  }
  if (scriptStatus === 'draft' || !scriptStatus) {
    return {
      pill: { tone: 'blue', emoji: '⏳', label: 'Notre équipe rédige votre script' },
      description: 'On compose un script personnalisé pour votre projet — délai habituel : 2 à 5 jours ouvrés.',
    };
  }
  return {
    pill: { tone: 'blue', emoji: '🚀', label: 'En cours' },
    description: 'Votre projet avance. Vous serez notifié·e à chaque étape clé.',
  };
}

const PILL_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  orange: { bg: 'rgba(232,105,43,.16)', border: 'rgba(232,105,43,.45)', color: '#FFB58A' },
  green: { bg: 'rgba(34,197,94,.14)', border: 'rgba(34,197,94,.40)', color: '#86EFAC' },
  blue: { bg: 'rgba(59,130,246,.16)', border: 'rgba(59,130,246,.40)', color: '#93C5FD' },
  red: { bg: 'rgba(239,68,68,.16)', border: 'rgba(239,68,68,.45)', color: '#FCA5A5' },
  yellow: { bg: 'rgba(250,204,21,.18)', border: 'rgba(250,204,21,.50)', color: '#FDE68A' },
};

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
  const [tab, setTab] = useState<'script' | 'comments' | 'video' | 'feedback'>('script');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [liveToast, setLiveToast] = useState<{ emoji: string; message: string; key: number } | null>(null);
  const lastSeenScriptStatusRef = useRef<string | null>(null);
  const lastSeenNotifIdRef = useRef<string | null>(null);
  const lastSeenDeliveredAtRef = useRef<string | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  // Show a transient toast (auto-dismisses after 5s)
  const showToast = useCallback((emoji: string, message: string) => {
    setLiveToast({ emoji, message, key: Date.now() });
    setTimeout(() => setLiveToast(curr => (curr && curr.key === Date.now() ? null : curr)), 5000);
  }, []);

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

  const loadAnnotations = useCallback(() => {
    if (!token) return;
    fetch(`/api/scripts/annotations?token=${token}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setAnnotations(d); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadScript();
    loadNotifications();
    loadSatisfaction();
    loadAnnotations();
  }, [loadScript, loadNotifications, loadSatisfaction, loadAnnotations]);

  // Auto-switch to video tab when delivery becomes available
  useEffect(() => {
    if (videos.length > 0 || (clientInfo?.delivered_at && clientInfo.video_url)) {
      setTab(t => t === 'script' ? 'video' : t);
    }
  }, [videos.length, clientInfo?.delivered_at, clientInfo?.video_url]);

  // Detect script status changes between polls and toast the client
  useEffect(() => {
    if (!script?.status) return;
    const previous = lastSeenScriptStatusRef.current;
    if (previous !== null && previous !== script.status) {
      const transitionMessages: Record<string, { emoji: string; message: string }> = {
        proposition: { emoji: '📝', message: 'Votre script est prêt à relire !' },
        modified: { emoji: '✨', message: 'Une nouvelle version du script vient d\'arriver.' },
        confirmed: { emoji: '🎉', message: 'Script validé — on planifie la suite !' },
        awaiting_changes: { emoji: '✅', message: 'Vos modifications ont bien été envoyées.' },
      };
      const msg = transitionMessages[script.status];
      if (msg) showToast(msg.emoji, msg.message);
    }
    lastSeenScriptStatusRef.current = script.status;
  }, [script?.status, showToast]);

  // Toast when video gets delivered while client is on the page
  useEffect(() => {
    const delivered = clientInfo?.delivered_at || (videos.find(v => v.delivered_at)?.delivered_at);
    if (!delivered) return;
    const previous = lastSeenDeliveredAtRef.current;
    if (previous !== null && previous !== delivered) {
      showToast('🎬', 'Votre vidéo est en ligne ! Découvrez-la.');
    }
    lastSeenDeliveredAtRef.current = delivered;
  }, [clientInfo?.delivered_at, videos, showToast]);

  // Toast when a brand-new notification arrives during the session
  useEffect(() => {
    if (!notifications.length) return;
    const first = notifications[0];
    const previous = lastSeenNotifIdRef.current;
    if (previous !== null && previous !== first.id) {
      showToast('🔔', first.title);
    }
    lastSeenNotifIdRef.current = first.id;
  }, [notifications, showToast]);

  // Lightweight polling so the toasts trigger without manual refresh
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      loadScript();
      loadNotifications();
    }, 60_000);
    return () => clearInterval(interval);
  }, [token, loadScript, loadNotifications]);

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

  // ── Inline annotations CRUD ──
  async function createAnnotation(a: { quote: string; note: string; pos_from: number; pos_to: number }) {
    if (!token) return;
    const r = await fetch(`/api/scripts/annotations?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    });
    if (r.ok) {
      const created = await r.json();
      setAnnotations(prev => [...prev, created]);
      showToast('💬', 'Annotation enregistrée');
    } else {
      const err = await r.json().catch(() => ({}));
      if (err.migration_missing) {
        // Friendly message; do NOT show the raw PostgREST error to the client.
        showToast('⚠️', "Fonctionnalité bientôt disponible — l'équipe est notifiée.");
      } else {
        showToast('❌', err.error || "Impossible d'enregistrer cette annotation. Réessayez ou contactez-nous.");
      }
    }
  }
  async function updateAnnotation(id: string, fields: { note?: string; resolved?: boolean; add_reply?: string }) {
    if (!token) return;
    const r = await fetch(`/api/scripts/annotations?token=${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (r.ok) {
      const updated = await r.json();
      setAnnotations(prev => prev.map(a => a.id === id ? updated : a));
      if (fields.add_reply) showToast('💬', 'Réponse envoyée');
    }
  }
  async function deleteAnnotation(id: string) {
    if (!token) return;
    const r = await fetch(`/api/scripts/annotations?token=${token}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) setAnnotations(prev => prev.filter(a => a.id !== id));
  }
  async function sendAnnotationsToTeam() {
    // Triggers the same status flip as "Demander des modifications" — but now
    // the team has the actual annotations to act on.
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

      <main style={{
        flex: 1,
        // When the user is reading/annotating the script, give the page much
        // more horizontal room so the script breathes. For other tabs we keep
        // a comfortable reading width.
        maxWidth: tab === 'script' ? 1180 : 820,
        width: '100%', margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)',
        transition: 'max-width .2s ease',
      }}>
        {/* Welcome + next action card */}
        {(() => {
          const next = computeNextAction(script.status, !!hasDelivery, !!satisfaction);
          const pill = PILL_STYLES[next.pill.tone];
          const dl = deadlineTone(clientInfo?.publication_deadline);
          const dlPill = dl ? PILL_STYLES[dl.tone] : null;
          return (
            <div style={{
              marginBottom: 22, padding: '20px 22px', borderRadius: 14,
              background: 'var(--night-card)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <h2 style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
                  fontSize: '1.2rem', color: 'var(--text)', margin: 0,
                }}>
                  {clientInfo?.business_name || 'Votre projet'}
                </h2>
                {dl && dlPill && (
                  <span style={{
                    fontSize: '0.72rem', padding: '5px 11px', borderRadius: 999,
                    background: dlPill.bg, border: `1px solid ${dlPill.border}`, color: dlPill.color, fontWeight: 600,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <span aria-hidden>{dl.emoji}</span>
                    {dl.label}
                  </span>
                )}
              </div>

              {/* Next action pill + description */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '6px 13px', borderRadius: 999,
                  background: pill.bg, border: `1px solid ${pill.border}`, color: pill.color,
                  fontSize: '0.82rem', fontWeight: 700,
                }}>
                  <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1 }}>{next.pill.emoji}</span>
                  {next.pill.label}
                </span>
                {next.cta && (
                  <button onClick={() => next.cta?.tab && setTab(next.cta.tab)} style={{
                    background: 'transparent', border: '1px solid var(--border-md)',
                    color: 'var(--text)', borderRadius: 999, padding: '6px 13px',
                    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  }}>
                    {next.cta.label} →
                  </button>
                )}
              </div>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-mid)', margin: 0, lineHeight: 1.55 }}>
                {next.description}
              </p>
            </div>
          );
        })()}

        {/* Project timeline — single source of truth for progression */}
        <div style={{
          marginBottom: 22, padding: '20px 22px', borderRadius: 14,
          background: 'var(--night-card)', border: '1px solid var(--border)',
        }}>
          <h3 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '0.95rem', color: 'var(--text)', margin: '0 0 16px',
          }}>
            🗺️ Avancement de votre projet
          </h3>
          {(() => {
            const stageIdx = PROJECT_STAGES.findIndex(s => s.key === clientStatus);
            const effectiveIdx = stageIdx >= 0 ? stageIdx : 0;
            return (
              <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {PROJECT_STAGES.map((stage, i) => {
                  const status: 'done' | 'current' | 'pending' = i < effectiveIdx ? 'done' : i === effectiveIdx ? 'current' : 'pending';
                  const isLast = i === PROJECT_STAGES.length - 1;
                  const dotBg = status === 'current' ? 'var(--orange)' : status === 'done' ? 'var(--green)' : 'transparent';
                  const dotBorder = status === 'current' ? 'var(--orange)' : status === 'done' ? 'var(--green)' : 'var(--border-md)';
                  const lineBg = status === 'done' ? 'var(--green)' : 'var(--border)';
                  const titleColor = status === 'pending' ? 'var(--text-mid)' : 'var(--text)';
                  const dateExtra = stage.key === 'filming_scheduled' && clientInfo?.filming_date
                    ? new Date(clientInfo.filming_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                    : null;
                  return (
                    <li key={stage.key} style={{
                      display: 'grid', gridTemplateColumns: '36px 1fr', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 54 }}>
                        <span aria-hidden style={{
                          width: 30, height: 30, borderRadius: '50%',
                          background: dotBg, border: `2px solid ${dotBorder}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 14, flexShrink: 0,
                          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                        }}>{status === 'done' ? '✓' : stage.emoji}</span>
                        {!isLast && <span aria-hidden style={{ flex: 1, width: 2, background: lineBg, marginTop: 4 }} />}
                      </div>
                      <div style={{ paddingBottom: 18 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: status === 'current' ? 700 : 600, color: titleColor, fontSize: 14.5 }}>
                            {stage.label}
                          </span>
                          {status === 'current' && (
                            <span style={{
                              padding: '2px 8px', borderRadius: 999,
                              background: 'rgba(232,105,43,.16)', border: '1px solid rgba(232,105,43,.45)',
                              color: '#FFB58A', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                            }}>VOUS ÊTES ICI</span>
                          )}
                        </div>
                        {dateExtra && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{dateExtra}</div>
                        )}
                        <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5 }}>
                          {stage.description}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            );
          })()}
        </div>

        {/* Status card + actions */}
        <div style={{
          background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
          padding: 'clamp(14px, 3vw, 20px)', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📝 Script — étape {currentStepIdx + 1}/{SCRIPT_STEPS.length}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: statusInfo.color,
                  boxShadow: `0 0 8px ${statusInfo.color}40`,
                }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</span>
              </div>
            </div>

            {/* Actions live BELOW the script (after reading). Top stays clean. */}
            {canValidate && (
              <span style={{
                fontSize: '0.78rem', color: 'var(--text-mid)', fontStyle: 'italic',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <span aria-hidden>👇</span> Lisez le script puis validez en bas
              </span>
            )}

            {script.status === 'confirmed' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
                background: 'rgba(34,197,94,.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,.2)',
              }}>
                <span style={{ fontSize: '1rem' }} aria-hidden>✅</span>
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
                  }}>↗️ Ouvrir</a>
                  <a href={v.video_url} download style={{
                    padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                    border: '1px solid var(--border-md)', color: 'var(--text)',
                    textDecoration: 'none', fontWeight: 600, fontSize: '0.8rem',
                  }}>⬇️ Télécharger</a>
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

        {/* Feedback tab */}
        {tab === 'feedback' && (
          <SatisfactionForm
            existing={satisfaction}
            onSubmit={handleSubmitSatisfaction}
            loading={actionLoading}
          />
        )}

        {/* Script view */}
        {tab === 'script' && (() => {
          const canAnnotate = script.status === 'proposition' || script.status === 'modified' || script.status === 'awaiting_changes';
          const openCount = annotations.filter(a => !a.resolved).length;
          return (
            <>
              {/* Helper bar — only when client can annotate AND nothing yet */}
              {canAnnotate && annotations.length === 0 && (
                <div style={{
                  marginBottom: 14, padding: '12px 16px', borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(250,204,21,.10), rgba(232,105,43,.08))',
                  border: '1px dashed rgba(250,204,21,.40)',
                  display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.86rem',
                  color: 'var(--text)',
                }}>
                  <span aria-hidden style={{ fontSize: '1.4rem' }}>🖍️</span>
                  <div style={{ flex: 1 }}>
                    <strong>Comment commenter le script ?</strong> Sélectionnez n&apos;importe quel passage avec votre souris (ou doigt sur mobile) — un bouton « 💬 Annoter » apparaîtra automatiquement. Cliquez dessus pour ajouter votre remarque.
                  </div>
                </div>
              )}

              <ScriptAnnotator
                content={script.content}
                annotations={annotations}
                onCreate={canAnnotate ? createAnnotation : undefined}
                onUpdate={updateAnnotation}
                onDelete={canAnnotate ? deleteAnnotation : undefined}
                canAnnotate={canAnnotate}
                canReply={canAnnotate}
                hideResolveButton
                emptyHint={canAnnotate
                  ? 'Sélectionnez un passage du script pour y attacher un commentaire.'
                  : script.status === 'confirmed'
                    ? 'Le script est validé. ✅'
                    : 'Aucune annotation pour le moment.'}
              />

              {/* ───────── BOTTOM ACTION BAR ───────── */}
              {canValidate && (
                <div style={{
                  marginTop: 18, padding: '16px 18px', borderRadius: 14,
                  background: 'var(--night-card)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 14, flexWrap: 'wrap',
                  position: 'sticky', bottom: 12, zIndex: 5,
                  boxShadow: '0 8px 32px rgba(0,0,0,.45)',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    {openCount > 0 ? (
                      <>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                          📝 {openCount} modification{openCount > 1 ? 's' : ''} prête{openCount > 1 ? 's' : ''} à envoyer
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-mid)', marginTop: 2 }}>
                          L&apos;équipe recevra vos annotations et vous renverra une nouvelle version.
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                          {script.status === 'modified' ? '✨ Nouvelle version disponible' : '👀 Vous avez tout lu ?'}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-mid)', marginTop: 2 }}>
                          Validez le script pour qu&apos;on planifie le tournage, ou ajoutez des annotations si quelque chose ne vous convient pas.
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {openCount > 0 && (
                      <button onClick={sendAnnotationsToTeam} disabled={actionLoading} style={{
                        padding: '11px 20px', borderRadius: 10, background: 'var(--orange)',
                        color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700,
                        boxShadow: '0 4px 14px rgba(232,105,43,.4)',
                      }}>
                        📤 Envoyer mes modifications
                      </button>
                    )}
                    <button onClick={() => setShowValidationModal(true)} disabled={actionLoading} style={{
                      padding: '11px 22px', borderRadius: 10,
                      background: openCount > 0 ? 'transparent' : 'var(--green)',
                      color: openCount > 0 ? 'var(--green)' : '#fff',
                      border: openCount > 0 ? '1px solid var(--green)' : 'none',
                      cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700,
                      boxShadow: openCount > 0 ? 'none' : '0 4px 14px rgba(34,197,94,.4)',
                    }}>
                      ✅ Valider le script
                    </button>
                  </div>
                </div>
              )}

              {script.status === 'confirmed' && (
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <a href={`/portal/print?token=${token}`} target="_blank" rel="noreferrer" style={{
                    display: 'inline-block', padding: '9px 18px', borderRadius: 8,
                    background: 'var(--night-card)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', textDecoration: 'none', fontSize: '0.82rem',
                  }}>⬇️ Télécharger le script (PDF)</a>
                </div>
              )}
            </>
          );
        })()}

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

      {/* Live toast — fired when state changes during the session */}
      {liveToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 22px', borderRadius: 999,
            background: 'rgba(232,105,43,.95)', color: '#fff',
            boxShadow: '0 12px 36px rgba(0,0,0,.45)',
            fontSize: '0.92rem', fontWeight: 600, zIndex: 3000,
            maxWidth: 'calc(100vw - 32px)',
            animation: 'bm-toast-rise .35s ease',
          }}
        >
          <span aria-hidden style={{ fontSize: '1.2rem', lineHeight: 1 }}>{liveToast.emoji}</span>
          <span>{liveToast.message}</span>
          <button
            onClick={() => setLiveToast(null)}
            aria-label="Fermer"
            style={{
              background: 'rgba(0,0,0,.2)', border: 'none', color: '#fff',
              borderRadius: '50%', width: 22, height: 22, cursor: 'pointer',
              fontSize: '0.75rem', lineHeight: 1, padding: 0,
            }}
          >✕</button>
          <style>{`
            @keyframes bm-toast-rise {
              from { transform: translate(-50%, 16px); opacity: 0; }
              to   { transform: translate(-50%, 0);    opacity: 1; }
            }
          `}</style>
        </div>
      )}

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
