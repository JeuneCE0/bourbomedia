'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Annotation } from '@/components/ScriptAnnotator';
import { fireLiveAlert, ensureNotificationPermission } from '@/lib/live-notify';

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
  publication_date_confirmed?: boolean;
  video_validated_at?: string | null;
  video_review_comment?: string | null;
  video_changes_requested?: boolean;
  contract_pdf_url?: string;
  contract_signature_link?: string;
  created_at?: string;
  updated_at?: string;
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
  video_review: 'Vidéo à valider',
  publication_pending: 'Publication à planifier',
  published: 'Vidéo publiée',
};

const PROJECT_STAGES = [
  { key: 'onboarding',          label: 'Inscription',           emoji: '👋',  description: 'Vous êtes inscrit·e — bienvenue !' },
  { key: 'script_writing',      label: 'Écriture du script',     emoji: '✍️',  description: 'Notre équipe écrit votre script sur mesure.' },
  { key: 'script_review',       label: 'Relecture du script',    emoji: '📝',  description: 'Le script vous est proposé pour relecture.' },
  { key: 'script_validated',    label: 'Réservez votre tournage', emoji: '✅', description: 'Choisissez votre créneau de tournage dans le calendrier ci-dessous.' },
  { key: 'filming_scheduled',   label: 'Tournage planifié',      emoji: '📅',  description: 'Une date de tournage est confirmée.' },
  { key: 'filming_done',        label: 'Tournage terminé',       emoji: '🎬',  description: 'Le tournage est dans la boîte !' },
  { key: 'editing',             label: 'Montage en cours',       emoji: '🎞️', description: 'Notre équipe monte votre vidéo.' },
  { key: 'video_review',        label: 'Vidéo à valider',        emoji: '👀',  description: 'Visionnez et validez votre vidéo (ou demandez des modifications).' },
  { key: 'publication_pending', label: 'Date de publication',    emoji: '🗓️', description: 'Choisissez la date de mise en ligne (mardi ou jeudi).' },
  { key: 'published',           label: 'Vidéo publiée',          emoji: '🎉',  description: 'Votre vidéo est en ligne — bravo !' },
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

// ── ETA helpers ────────────────────────────────────────────────────────────
// Skip weekends when adding business days.
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// Next Tuesday or Thursday strictly after `from`. Used for publication ETA.
function nextPublicationSlot(from: Date): Date {
  const d = new Date(from);
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 2 || dow === 4) return new Date(d);
  }
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function computeNextAction(
  scriptStatus: string | null,
  hasDelivery: boolean,
  hasFeedback: boolean,
  client?: { status?: string; video_validated_at?: string | null; publication_date_confirmed?: boolean; video_changes_requested?: boolean; updated_at?: string; created_at?: string; filming_date?: string; publication_deadline?: string } | null,
): NextAction {
  // Helper : pick the most recent timestamp we can rely on as "stage entered"
  const stageEnteredAt = client?.updated_at ? new Date(client.updated_at)
    : client?.created_at ? new Date(client.created_at)
    : new Date();

  // Highest-priority: if the project is already published, nothing else
  // matters — show the celebration state. (Without this guard, an old
  // 'Réservez votre tournage' message can leak in when hasDelivery is false
  // on a published client.)
  if (client?.status === 'published') {
    const pubDate = client.publication_deadline ? new Date(client.publication_deadline) : null;
    const isFuture = pubDate ? pubDate.getTime() > Date.now() : false;
    return {
      pill: { tone: 'green', emoji: '🎉', label: isFuture ? 'Bientôt en ligne' : 'Vidéo publiée' },
      description: pubDate
        ? (isFuture
            ? `Votre vidéo va bientôt être publiée — ${fmtDate(pubDate)}.`
            : `Votre vidéo est en ligne depuis le ${fmtDate(pubDate)}. Merci pour votre confiance !`)
        : 'Votre vidéo est publiée — merci pour votre confiance !',
    };
  }
  // Video delivered but not yet validated → ask the client to review
  if (hasDelivery && !client?.video_validated_at) {
    if (client?.video_changes_requested) {
      const eta = addBusinessDays(stageEnteredAt, 3);
      return {
        pill: { tone: 'blue', emoji: '✏️', label: 'Modifications en cours' },
        description: `Vos retours ont été pris en compte. Notre équipe ajuste le montage — nouvelle version vers le ${fmtDate(eta)}.`,
      };
    }
    return {
      pill: { tone: 'orange', emoji: '👀', label: 'Validez votre vidéo' },
      description: 'Votre vidéo est livrée — visionnez-la et validez-la (ou demandez des modifications).',
      cta: { label: 'Voir ma vidéo', tab: 'video' },
    };
  }
  // Video validated, but no publication date picked yet
  if (hasDelivery && client?.video_validated_at && !client?.publication_date_confirmed) {
    const nextSlot = nextPublicationSlot(new Date());
    return {
      pill: { tone: 'orange', emoji: '🗓️', label: 'Choisissez votre date de publication' },
      description: `Sélectionnez le mardi ou le jeudi de votre choix. Plus tôt disponible : ${fmtDate(nextSlot)}.`,
    };
  }
  if (hasDelivery && !hasFeedback && client?.publication_date_confirmed) {
    return {
      pill: { tone: 'orange', emoji: '⭐', label: 'Donnez-nous votre avis' },
      description: 'Votre vidéo est planifiée — on aimerait beaucoup connaître votre ressenti.',
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
    const eta = addBusinessDays(stageEnteredAt, 2);
    return {
      pill: { tone: 'blue', emoji: '✍️', label: 'On retravaille votre script' },
      description: `Vos retours ont été pris en compte. Nouvelle version prête vers le ${fmtDate(eta)}.`,
    };
  }
  // Once filming is booked, talk about the filming + delivery, not "réservez"
  if (client?.filming_date && (client?.status === 'filming_scheduled' || client?.status === 'filming_done' || client?.status === 'editing')) {
    const filming = new Date(client.filming_date);
    const now = new Date();
    if (filming > now) {
      return {
        pill: { tone: 'blue', emoji: '🎬', label: 'Tournage planifié' },
        description: `Tournage prévu ${fmtDate(filming)} — vidéo livrée environ 5 jours après (vers le ${fmtDate(addBusinessDays(filming, 5))}).`,
      };
    }
    const eta = addBusinessDays(filming, 5);
    return {
      pill: { tone: 'blue', emoji: '🎞️', label: 'Montage en cours' },
      description: `Notre équipe monte votre vidéo — livraison vers le ${fmtDate(eta)}.`,
    };
  }
  if (scriptStatus === 'confirmed') {
    return {
      pill: { tone: 'orange', emoji: '📅', label: 'Réservez votre tournage' },
      description: 'Votre script est validé. Choisissez maintenant un créneau de tournage (3h) dans le calendrier ci-dessous.',
    };
  }
  if (scriptStatus === 'draft' || !scriptStatus) {
    const eta = addBusinessDays(stageEnteredAt, 4);
    return {
      pill: { tone: 'blue', emoji: '⏳', label: 'Notre équipe rédige votre script' },
      description: `On compose un script personnalisé pour votre projet — prêt vers le ${fmtDate(eta)} (≈ 2-5 jours ouvrés).`,
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

  // Live polling — faster cadence when the user is on the script or comments
  // tab so admin replies and team comments feel instantaneous. We bump from
  // 60s (passive) to 5s (active tab) to stay within Vercel/Supabase quotas
  // while still feeling near-real-time.
  useEffect(() => {
    if (!token) return;
    const ms = (tab === 'script' || tab === 'comments') ? 5_000 : 30_000;
    const interval = setInterval(() => {
      loadScript();
      loadNotifications();
      if (tab === 'script') loadAnnotations();
    }, ms);
    return () => clearInterval(interval);
  }, [token, tab, loadScript, loadNotifications, loadAnnotations]);

  // Detect new admin comments on the script — fire a live alert with browser notif
  const lastSeenCommentIdRef = useRef<string | null>(null);
  useEffect(() => {
    const comments = script?.script_comments || [];
    if (comments.length === 0) { lastSeenCommentIdRef.current = null; return; }
    const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const newest = sorted[sorted.length - 1];
    const prev = lastSeenCommentIdRef.current;
    if (prev !== null && prev !== newest.id && newest.author_type !== 'client') {
      fireLiveAlert(showToast, '💬', `${newest.author_name || 'L\'équipe'} a commenté votre script`,
        { url: `/portal?token=${token}`, tag: `comment-${newest.id}` });
    }
    lastSeenCommentIdRef.current = newest.id;
  }, [script?.script_comments, showToast, token]);

  // Detect new admin replies on annotations
  const lastSeenReplyIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (annotations.length === 0) { lastSeenReplyIdsRef.current = new Set(); return; }
    const allReplyIds = new Set<string>();
    const newReplies: { author: string; annotationId: string }[] = [];
    annotations.forEach(a => {
      (a.replies || []).forEach(r => {
        allReplyIds.add(r.id);
        if (!lastSeenReplyIdsRef.current.has(r.id) && r.author_type === 'admin' && lastSeenReplyIdsRef.current.size > 0) {
          newReplies.push({ author: r.author_name, annotationId: a.id });
        }
      });
    });
    // Initial mount fills the set without firing alerts
    if (lastSeenReplyIdsRef.current.size === 0) {
      lastSeenReplyIdsRef.current = allReplyIds;
      return;
    }
    if (newReplies.length > 0) {
      const first = newReplies[0];
      const more = newReplies.length > 1 ? ` (+${newReplies.length - 1})` : '';
      fireLiveAlert(showToast, '↩️', `${first.author} a répondu à votre annotation${more}`,
        { url: `/portal?token=${token}`, tag: `reply-${first.annotationId}` });
    }
    lastSeenReplyIdsRef.current = allReplyIds;
  }, [annotations, showToast, token]);

  // First user interaction → request browser notification permission
  // (browsers block requestPermission outside a user gesture)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      ensureNotificationPermission().catch(() => null);
      window.removeEventListener('pointerdown', ask);
      window.removeEventListener('keydown', ask);
    };
    window.addEventListener('pointerdown', ask, { once: true });
    window.addEventListener('keydown', ask, { once: true });
    return () => {
      window.removeEventListener('pointerdown', ask);
      window.removeEventListener('keydown', ask);
    };
  }, []);

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
            <div className="bm-fade-in" style={{
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
          const next = computeNextAction(script.status, !!hasDelivery, !!satisfaction, clientInfo);
          const pill = PILL_STYLES[next.pill.tone];
          // Only display the publication countdown when the date is genuinely
          // confirmed — otherwise it's an internal estimate that depends on
          // script revisions, editing time, etc. Showing it as a hard date
          // misleads the client.
          const showDeadline = clientInfo?.publication_date_confirmed === true;
          const dl = showDeadline ? deadlineTone(clientInfo?.publication_deadline) : null;
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

        {/* Pre-filming checklist — visible 48h before tournage */}
        <FilmingPrepBanner filmingDate={clientInfo?.filming_date} />

        {/* Published celebration — visible once status='published' */}
        {clientInfo?.status === 'published' && (
          <>
            <PublishedCelebration
              publicationDate={clientInfo?.publication_deadline}
              videoUrl={deliveredVideos[0]?.video_url || clientInfo?.video_url}
            />
            <UpsellSection />
          </>
        )}

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
                            <span className="bm-pulse-glow" style={{
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

        {/* Filming booking — appears after script validation, before any date is set */}
        {(script?.status === 'confirmed' || clientInfo?.status === 'script_validated') && !clientInfo?.filming_date && (
          <FilmingBookingPanel token={token!} onConfirmed={() => { loadScript(); loadNotifications(); }} actionLoading={actionLoading} />
        )}

        {/* Video review — when a video is delivered but not yet validated by client */}
        {hasDelivery && !clientInfo?.video_validated_at && (
          <VideoReviewPanel
            token={token!}
            hasDelivery={!!hasDelivery}
            clientInfo={clientInfo}
            onActed={() => { loadScript(); loadNotifications(); }}
          />
        )}

        {/* Publication date picker — Tuesdays / Thursdays only */}
        {hasDelivery && clientInfo?.video_validated_at && !clientInfo?.publication_date_confirmed && (
          <PublicationDatePicker
            token={token!}
            clientInfo={clientInfo}
            onConfirmed={() => { loadScript(); loadNotifications(); }}
          />
        )}

        {/* Confirmed publication banner */}
        {clientInfo?.publication_date_confirmed && clientInfo?.publication_deadline && (
          <div className="bm-fade-in" style={{
            marginTop: 14, padding: '14px 18px', borderRadius: 12,
            background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.30)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span aria-hidden style={{ fontSize: '1.6rem' }}>📺</span>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                Publication confirmée le {new Date(clientInfo.publication_deadline).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-mid)', marginTop: 2 }}>
                Votre vidéo sera mise en ligne ce jour-là.
              </div>
            </div>
          </div>
        )}

        {/* Status card — visible UNIQUEMENT pendant la relecture (proposition /
            modified / awaiting_changes). Avant : la carte "On rédige" en haut suffit.
            Après validation : la stepper globale + les onglets vidéo prennent le relais. */}
        {(script.status === 'proposition' || script.status === 'modified' || script.status === 'awaiting_changes') && (
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

              {canValidate && (
                <span style={{
                  fontSize: '0.78rem', color: 'var(--text-mid)', fontStyle: 'italic',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <span aria-hidden>👇</span> Lisez le script puis validez en bas
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tabs — Script + Commentaires uniquement quand le client doit relire
            (proposition / modified / awaiting_changes). Une fois validé ou
            avant proposition, ces onglets disparaissent pour ne pas surcharger. */}
        {(() => {
          const isInReview = script.status === 'proposition' || script.status === 'modified' || script.status === 'awaiting_changes';
          const tabsList: ('video' | 'script' | 'comments' | 'feedback')[] = [
            ...(hasDelivery ? ['video' as const] : []),
            ...(isInReview ? ['script' as const, 'comments' as const] : []),
            ...(hasDelivery ? ['feedback' as const] : []),
          ];
          // No tabs at all → render nothing (status card already explains the state)
          if (tabsList.length === 0) return null;
          // If current tab is no longer available, fall back to the first one silently.
          if (!tabsList.includes(tab)) {
            setTimeout(() => setTab(tabsList[0]), 0);
          }
          return (
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
              {tabsList.map(t => (
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
          );
        })()}
        {/* Video delivery view (multi-video) */}
        {tab === 'video' && hasDelivery && (
          <div key="tab-video" className="bm-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
          <div key="tab-feedback" className="bm-fade-in">
            <SatisfactionForm
              existing={satisfaction}
              onSubmit={handleSubmitSatisfaction}
              loading={actionLoading}
            />
          </div>
        )}

        {/* Script view — only when actually in review (proposition/modified/awaiting_changes).
            Outside that window, the script content (with its 'Lecture seule' / annotations
            UI) must stay hidden to keep the portal clean for the client. */}
        {tab === 'script' && (script.status === 'proposition' || script.status === 'modified' || script.status === 'awaiting_changes') && (() => {
          // Always editable inside this gate (the outer condition ensures it)
          const openCount = annotations.filter(a => !a.resolved).length;
          return (
            <div key="tab-script" className="bm-fade-in">
              {/* Helper bar — only when nothing yet annotated */}
              {annotations.length === 0 && (
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
                onCreate={createAnnotation}
                onUpdate={updateAnnotation}
                onDelete={deleteAnnotation}
                canAnnotate
                canReply
                hideResolveButton
                emptyHint="Sélectionnez un passage du script pour y attacher un commentaire."
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

            </div>
          );
        })()}

        {/* Comments — same gate as Script view */}
        {tab === 'comments' && (script.status === 'proposition' || script.status === 'modified' || script.status === 'awaiting_changes') && (
          <div key="tab-comments" className="bm-fade-in">
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
        <div onClick={() => setShowValidationModal(false)} className="bm-modal-backdrop" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          backdropFilter: 'blur(4px)',
        }}>
          <div onClick={e => e.stopPropagation()} className="bm-modal-pop" style={{
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

function VideoReviewPanel({ token, hasDelivery, clientInfo, onActed }: {
  token: string;
  hasDelivery: boolean;
  clientInfo: ClientDelivery | null;
  onActed: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!hasDelivery) return null;
  if (clientInfo?.video_validated_at) return null; // already validated → don't show

  async function send(action: 'validate_video' | 'request_video_changes') {
    setSubmitting(true);
    try {
      await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: comment.trim() || undefined }),
      });
      onActed();
      setComment('');
      setMode('idle');
    } finally { setSubmitting(false); }
  }

  const inChangesMode = clientInfo?.video_changes_requested && mode === 'idle';

  return (
    <div className="bm-fade-in" style={{
      marginTop: 18, padding: '20px 22px', borderRadius: 14,
      background: 'var(--night-card)', border: '1px solid var(--border-orange)',
    }}>
      {inChangesMode ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span aria-hidden style={{ fontSize: '1.4rem' }}>✏️</span>
            <h3 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
              fontSize: '1.05rem', color: 'var(--text)', margin: 0,
            }}>
              Modifications en cours
            </h3>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-mid)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Vos retours ont bien été reçus. Notre équipe ajuste le montage et vous renverra une nouvelle version dès que c&apos;est prêt.
          </p>
          {clientInfo?.video_review_comment && (
            <blockquote style={{
              borderLeft: '3px solid var(--orange)', padding: '8px 12px', margin: '0 0 12px',
              background: 'rgba(232,105,43,.06)', borderRadius: '0 8px 8px 0',
              fontSize: '0.82rem', color: 'var(--text-mid)', fontStyle: 'italic',
            }}>
              « {clientInfo.video_review_comment} »
            </blockquote>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span aria-hidden style={{ fontSize: '1.4rem' }}>👀</span>
            <h3 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
              fontSize: '1.05rem', color: 'var(--text)', margin: 0,
            }}>
              Que pensez-vous de votre vidéo ?
            </h3>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-mid)', margin: '0 0 14px', lineHeight: 1.5 }}>
            {mode === 'changes'
              ? 'Précisez ce qu\'il faut modifier — soyez concret·e (timecodes, formulations, plans à changer).'
              : 'Validez si tout est OK pour passer à la planification de la publication. Sinon, demandez des modifications.'}
          </p>

          {mode === 'changes' && (
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Ex : à 0:34, le titre est trop long. Pourrait-on raccourcir ?"
              rows={4}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px',
                borderRadius: 10, background: 'var(--night-mid)',
                border: '1px solid var(--border-md)', color: 'var(--text)',
                fontSize: '0.9rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                marginBottom: 12,
              }}
            />
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {mode === 'idle' ? (
              <>
                <button onClick={() => setMode('changes')} disabled={submitting} style={{
                  padding: '11px 18px', borderRadius: 10, background: 'transparent',
                  border: '1px solid var(--yellow)', color: '#FDE68A',
                  cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600,
                }}>
                  ✏️ Demander des modifications
                </button>
                <button onClick={() => send('validate_video')} disabled={submitting} style={{
                  padding: '11px 22px', borderRadius: 10, background: 'var(--green)',
                  color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.9rem',
                  fontWeight: 700, boxShadow: '0 4px 14px rgba(34,197,94,.4)',
                }}>
                  {submitting ? '⏳' : '✅'} Valider la vidéo
                </button>
              </>
            ) : (
              <>
                <button onClick={() => { setMode('idle'); setComment(''); }} disabled={submitting} style={{
                  padding: '9px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.85rem',
                }}>Annuler</button>
                <button onClick={() => send('request_video_changes')} disabled={submitting || !comment.trim()} style={{
                  padding: '11px 18px', borderRadius: 10, background: 'var(--orange)',
                  color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.88rem',
                  fontWeight: 700, opacity: !comment.trim() || submitting ? 0.5 : 1,
                  boxShadow: '0 4px 14px rgba(232,105,43,.4)',
                }}>
                  {submitting ? '⏳ Envoi…' : '📤 Envoyer mes modifications'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PublicationDatePicker({ token, clientInfo, onConfirmed }: {
  token: string;
  clientInfo: ClientDelivery | null;
  onConfirmed: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [bookedSet, setBookedSet] = useState<Set<string>>(new Set());

  // Fetch already-booked publication slots so we can grey them out
  useEffect(() => {
    if (!token) return;
    fetch(`/api/calendar-slots?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { bookedPublication?: string[] } | null) => {
        if (d?.bookedPublication) setBookedSet(new Set(d.bookedPublication));
      })
      .catch(() => {});
  }, [token]);

  if (!clientInfo?.video_validated_at) return null;
  if (clientInfo?.publication_date_confirmed) return null; // already chosen

  // Generate next ~12 Tuesdays + Thursdays (mardi=2, jeudi=4) — we'll show 8
  // available; if many are taken, the loop keeps walking forward.
  const slots: { iso: string; label: string; weekday: 'Mardi' | 'Jeudi'; taken: boolean }[] = [];
  {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 2; slots.length < 10 && i < 120; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dow = d.getDay();
      if (dow === 2 || dow === 4) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        slots.push({
          iso,
          label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
          weekday: dow === 2 ? 'Mardi' : 'Jeudi',
          taken: bookedSet.has(iso),
        });
      }
    }
  }

  async function confirm() {
    if (!pickedDate) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_publication_date', date: pickedDate }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || 'Erreur');
        return;
      }
      onConfirmed();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bm-fade-in" style={{
      marginTop: 18, padding: '20px 22px', borderRadius: 14,
      background: 'var(--night-card)', border: '1px solid var(--border-orange)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span aria-hidden style={{ fontSize: '1.4rem' }}>🗓️</span>
        <div>
          <h3 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '1.1rem', color: 'var(--text)', margin: 0,
          }}>
            Choisissez votre date de publication
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)', margin: '4px 0 0', lineHeight: 1.5 }}>
            Les publications sont planifiées le <strong>mardi</strong> ou le <strong>jeudi</strong>.
          </p>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 14,
      }}>
        {slots.map(slot => {
          const selected = pickedDate === slot.iso;
          return (
            <button
              key={slot.iso}
              onClick={() => !slot.taken && setPickedDate(slot.iso)}
              disabled={slot.taken}
              className={slot.taken ? '' : 'bm-press'}
              title={slot.taken ? 'Ce créneau est déjà réservé' : undefined}
              style={{
                padding: '14px 12px', borderRadius: 10,
                background: slot.taken ? 'rgba(0,0,0,.25)' : selected ? 'rgba(232,105,43,.18)' : 'var(--night-mid)',
                border: slot.taken
                  ? '1px dashed var(--border-md)'
                  : selected ? '2px solid var(--orange)' : '1px solid var(--border-md)',
                color: slot.taken ? 'var(--text-muted)' : selected ? 'var(--text)' : 'var(--text-mid)',
                cursor: slot.taken ? 'not-allowed' : 'pointer',
                textAlign: 'left', position: 'relative',
                opacity: slot.taken ? 0.5 : 1,
                transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: slot.weekday === 'Mardi' ? '#FBBF24' : '#A78BFA', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {slot.weekday}{slot.taken && ' · réservé'}
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: slot.taken ? 'var(--text-muted)' : 'var(--text)', textDecoration: slot.taken ? 'line-through' : 'none' }}>
                {slot.label.charAt(0).toUpperCase() + slot.label.slice(1)}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.84rem',
        }}>❌ {error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button
          onClick={confirm}
          disabled={!pickedDate || submitting}
          style={{
            padding: '12px 22px', borderRadius: 10, background: 'var(--orange)',
            color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.9rem',
            fontWeight: 700, boxShadow: '0 4px 14px rgba(232,105,43,.4)',
            opacity: !pickedDate || submitting ? 0.5 : 1,
          }}
        >
          {submitting ? '⏳ Enregistrement…' : '✅ Confirmer cette date'}
        </button>
      </div>
    </div>
  );
}

function FilmingBookingPanel({ token, onConfirmed, actionLoading }: {
  token: string;
  onConfirmed: () => void;
  actionLoading: boolean;
}) {
  const calendarUrl = process.env.NEXT_PUBLIC_GHL_FILMING_CALENDAR_URL || process.env.NEXT_PUBLIC_GHL_CALENDAR_URL || '';
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [showDateForm, setShowDateForm] = useState(false);
  const [pickedDate, setPickedDate] = useState('');
  const [pickedTime, setPickedTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [bookedSet, setBookedSet] = useState<Set<string>>(new Set());

  // Show "I booked" button shortly after iframe loads (mirrors onboarding pattern)
  useEffect(() => {
    if (iframeLoaded && !showButton) {
      const t = setTimeout(() => setShowButton(true), 2500);
      return () => clearTimeout(t);
    }
    if (!iframeLoaded && !showButton) {
      const fallback = setTimeout(() => setShowButton(true), 8000);
      return () => clearTimeout(fallback);
    }
  }, [iframeLoaded, showButton]);

  // Fetch already-booked filming dates so we can warn before submission
  useEffect(() => {
    if (!token) return;
    fetch(`/api/calendar-slots?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { bookedFilming?: string[] } | null) => {
        if (d?.bookedFilming) setBookedSet(new Set(d.bookedFilming));
      })
      .catch(() => {});
  }, [token]);

  async function confirmBooking() {
    if (!pickedDate) return;
    setError('');
    if (bookedSet.has(pickedDate)) {
      setError('Cette date est déjà prise par un autre projet. Choisissez un autre jour.');
      return;
    }
    setSubmitting(true);
    try {
      const isoDate = new Date(`${pickedDate}T${pickedTime || '09:00'}`).toISOString();
      const r = await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_filming_booked', date: isoDate }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || 'Erreur — réessayez ou contactez l\'équipe.');
        return;
      }
      onConfirmed();
      setShowDateForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      marginBottom: 22, padding: '20px 22px', borderRadius: 14,
      background: 'var(--night-card)', border: '1px solid var(--border-orange)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span aria-hidden style={{ fontSize: '1.4rem' }}>📅</span>
        <div style={{ flex: 1 }}>
          <h3 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '1.1rem', color: 'var(--text)', margin: 0,
          }}>
            Réservez votre créneau de tournage
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)', margin: '4px 0 0', lineHeight: 1.5 }}>
            Choisissez une plage de <strong>3 heures</strong> dans le calendrier ci-dessous. Vous recevrez un email de confirmation.
          </p>
        </div>
      </div>

      {!calendarUrl ? (
        <div style={{
          padding: '14px 16px', borderRadius: 10,
          background: 'var(--night-mid)', border: '1px dashed var(--border-md)',
          fontSize: '0.85rem', color: 'var(--text-mid)', lineHeight: 1.5,
        }}>
          ⚠️ Le calendrier de tournage n&apos;est pas encore configuré. Notre équipe vous contactera directement pour caler la date.
        </div>
      ) : (
        <>
          <div style={{
            borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-md)',
            background: '#fff',
          }}>
            <iframe
              src={calendarUrl}
              onLoad={() => setIframeLoaded(true)}
              style={{ width: '100%', height: '70vh', minHeight: 550, border: 'none', display: 'block' }}
              title="Réservation tournage"
            />
          </div>

          {showButton && !showDateForm && (
            <button
              onClick={() => setShowDateForm(true)}
              disabled={actionLoading}
              style={{
                marginTop: 14, width: '100%', padding: '13px 22px', borderRadius: 12,
                background: 'var(--orange)', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700,
                boxShadow: '0 4px 14px rgba(232,105,43,.4)',
              }}
            >
              ✅ J&apos;ai réservé mon créneau
            </button>
          )}

          {showDateForm && (
            <div style={{
              marginTop: 14, padding: '16px 18px', borderRadius: 12,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
                Quelle date avez-vous réservée ?
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <input
                  type="date" value={pickedDate} onChange={e => setPickedDate(e.target.value)}
                  style={{
                    flex: '1 1 160px', padding: '10px 12px', borderRadius: 8,
                    background: 'var(--night)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.9rem', colorScheme: 'dark', outline: 'none',
                  }}
                />
                <input
                  type="time" value={pickedTime} onChange={e => setPickedTime(e.target.value)}
                  placeholder="Heure" step={1800}
                  style={{
                    flex: '1 1 120px', padding: '10px 12px', borderRadius: 8,
                    background: 'var(--night)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.9rem', colorScheme: 'dark', outline: 'none',
                  }}
                />
              </div>
              {pickedDate && bookedSet.has(pickedDate) && (
                <div style={{
                  padding: '8px 12px', borderRadius: 6, marginBottom: 10,
                  background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.8rem',
                }}>
                  ⚠️ Ce jour est déjà pris par un autre projet — choisissez-en un autre.
                </div>
              )}
              {error && (
                <div style={{
                  padding: '8px 12px', borderRadius: 6, marginBottom: 10,
                  background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.8rem',
                }}>{error}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowDateForm(false)} style={{
                  padding: '9px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.85rem',
                }}>Annuler</button>
                <button
                  onClick={confirmBooking}
                  disabled={!pickedDate || submitting || bookedSet.has(pickedDate)}
                  style={{
                    padding: '9px 18px', borderRadius: 8, background: 'var(--green)',
                    color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem',
                    fontWeight: 700, opacity: !pickedDate || submitting || bookedSet.has(pickedDate) ? 0.5 : 1,
                  }}
                >
                  {submitting ? '⏳ Enregistrement…' : '🎬 Confirmer mon tournage'}
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
                ⚠️ La date est obligatoire pour qu&apos;elle apparaisse dans l&apos;agenda de l&apos;équipe. 1 seul tournage par jour.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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

/* ── Filming prep checklist (visible 48h before shoot) ─────────────────── */

function FilmingPrepBanner({ filmingDate }: { filmingDate?: string }) {
  if (!filmingDate) return null;
  const filming = new Date(filmingDate);
  const now = Date.now();
  const hoursToFilming = (filming.getTime() - now) / 3600000;
  // Show only between J-2 and the filming time itself
  if (hoursToFilming > 48 || hoursToFilming < -2) return null;

  const isToday = hoursToFilming >= 0 && hoursToFilming < 24;
  const isTomorrow = hoursToFilming >= 24 && hoursToFilming <= 48;
  const label = isToday ? "🎬 Tournage aujourd'hui" : isTomorrow ? '🎬 Tournage demain' : '🎬 Tournage en cours';

  const items = [
    { emoji: '👔', text: 'Tenue préparée — couleurs unies, pas de logos visibles' },
    { emoji: '📍', text: 'Lieu de tournage propre et accessible — pensez à débarrasser' },
    { emoji: '💡', text: 'Lumière naturelle si possible — ouvrez les rideaux' },
    { emoji: '📵', text: 'Téléphone en silencieux — évitez les notifications pendant le tournage' },
    { emoji: '☕', text: 'Eau / café à disposition pour l\'équipe (3h sur place)' },
    { emoji: '🗣️', text: 'Pratiquez le script à voix haute une fois la veille' },
  ];

  return (
    <div style={{
      marginBottom: 22, padding: '20px 22px', borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(232,105,43,.10), rgba(250,204,21,.06))',
      border: '1px solid rgba(232,105,43,.40)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <h3 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '1rem', color: 'var(--text)', margin: 0,
        }}>
          {label}
        </h3>
        <span style={{
          fontSize: '0.74rem', color: 'var(--text-mid)',
          padding: '3px 10px', borderRadius: 999,
          background: 'var(--night-mid)', border: '1px solid var(--border-md)',
        }}>
          {filming.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-mid)', margin: '0 0 14px' }}>
        Quelques rappels pour que votre tournage se passe au mieux :
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '8px 12px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border)',
            fontSize: '0.85rem', color: 'var(--text)',
          }}>
            <span aria-hidden style={{ fontSize: '1.1rem', flexShrink: 0, lineHeight: 1.2 }}>{item.emoji}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Published celebration ─────────────────────────────────────────────── */

function PublishedCelebration({ publicationDate, videoUrl }: { publicationDate?: string; videoUrl?: string }) {
  const pubDate = publicationDate ? new Date(publicationDate) : null;
  const isFuture = pubDate ? pubDate.getTime() > Date.now() : false;
  const formattedDate = pubDate
    ? pubDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div style={{
      marginBottom: 22, padding: '24px', borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(34,197,94,.10), rgba(168,85,247,.06))',
      border: '1px solid rgba(34,197,94,.40)',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 6 }}>🎉</div>
        <h2 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
          fontSize: '1.25rem', color: 'var(--green)', margin: '0 0 4px',
        }}>
          {isFuture ? 'Bravo, votre vidéo va bientôt être publiée !' : 'Bravo, votre vidéo est en ligne !'}
        </h2>
        {formattedDate && (
          <p style={{ fontSize: '0.92rem', color: 'var(--text)', margin: '0 0 4px', fontWeight: 600 }}>
            📅 {isFuture ? 'Publication prévue' : 'Publiée'} le {formattedDate}
          </p>
        )}
        <p style={{ fontSize: '0.86rem', color: 'var(--text-mid)', margin: '6px 0 0' }}>
          On s&apos;occupe de la diffusion sur nos réseaux — vous n&apos;avez rien à faire.
        </p>
      </div>

      {/* Téléchargement seul ici — l'upsell vit dans sa propre section */}
      {videoUrl && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <a href={videoUrl} target="_blank" rel="noreferrer" style={{
            padding: '12px 22px', borderRadius: 10, textDecoration: 'none',
            background: 'var(--night-card)', border: '1px solid var(--border-md)',
            color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: '0.88rem', fontWeight: 600,
          }}>
            <span aria-hidden style={{ fontSize: '1.1rem' }}>📥</span>
            <span>Télécharger la vidéo</span>
          </a>
        </div>
      )}
    </div>
  );
}

/* ── Upsell section — drives the next sale ─────────────────────────────── */

interface UpsellOffer {
  emoji: string;
  badge?: string;
  title: string;
  price: string;
  description: string;
  bullets: string[];
  cta: string;
  mailtoSubject: string;
  highlight?: boolean;
}

const UPSELL_OFFERS: UpsellOffer[] = [
  {
    emoji: '🎬',
    title: 'Vidéo unique',
    price: '500 € HT',
    description: 'Une nouvelle vidéo sur mesure, du brief à la diffusion.',
    bullets: [
      'Script écrit par notre équipe',
      'Tournage 3h sur place',
      'Montage pro + livraison ~5 j',
      'Diffusion sur nos réseaux',
    ],
    cta: 'Commander une vidéo',
    mailtoSubject: 'Je veux commander une vidéo unique',
  },
  {
    emoji: '🚀',
    badge: 'Le plus choisi',
    title: 'Pack 3 vidéos',
    price: '1 350 € HT',
    description: 'Un pack pensé pour installer votre marque dans la durée.',
    bullets: [
      'Économisez 150 € (10 %)',
      'Calendrier éditorial inclus',
      'Cohérence visuelle garantie',
      'Diffusion mensuelle sur 3 mois',
    ],
    cta: 'Choisir le pack',
    mailtoSubject: 'Je veux le pack 3 vidéos',
    highlight: true,
  },
  {
    emoji: '💬',
    title: 'On en parle ?',
    price: 'Sur mesure',
    description: 'Plusieurs vidéos par mois, série, ou autre format ? Discutons.',
    bullets: [
      'Audit gratuit de vos besoins',
      'Devis personnalisé sous 48 h',
      'Tarifs dégressifs au volume',
    ],
    cta: 'Réserver un appel',
    mailtoSubject: 'Je veux discuter d\'un projet sur mesure',
  },
];

function UpsellSection() {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      marginBottom: 22, padding: 'clamp(28px, 4vw, 40px) clamp(20px, 3vw, 32px)', borderRadius: 18,
      background: 'radial-gradient(ellipse at top, rgba(232,105,43,.18), transparent 70%), linear-gradient(180deg, var(--night-card) 0%, var(--night-mid) 100%)',
      border: '1px solid rgba(232,105,43,.30)',
      boxShadow: '0 8px 40px rgba(0,0,0,.35)',
    }}>
      {/* Decorative gradient blob */}
      <div aria-hidden style={{
        position: 'absolute', top: -80, right: -80, width: 280, height: 280, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(232,105,43,.20), transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Header with eyebrow + big title */}
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 28, maxWidth: 640, marginInline: 'auto' }}>
        <div style={{
          display: 'inline-block', padding: '5px 14px', borderRadius: 999,
          background: 'rgba(232,105,43,.18)', border: '1px solid rgba(232,105,43,.45)',
          color: '#FFB58A', fontSize: '0.72rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14,
        }}>
          ⚡ Offre client — pour vous
        </div>
        <h2 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
          fontSize: 'clamp(1.6rem, 4vw, 2.1rem)', color: 'var(--text)',
          margin: '0 0 10px', lineHeight: 1.15, letterSpacing: '-0.02em',
        }}>
          On continue l&apos;aventure&nbsp;? <span style={{ color: 'var(--orange)' }}>🚀</span>
        </h2>
        <p style={{
          fontSize: 'clamp(0.92rem, 1.6vw, 1.05rem)', color: 'var(--text-mid)',
          margin: 0, lineHeight: 1.55,
        }}>
          Une vidéo isolée, c&apos;est sympa.
          <strong style={{ color: 'var(--text)' }}> Trois vidéos, c&apos;est ce qui transforme une marque en référence locale.</strong>
        </p>
      </div>

      {/* Trust strip */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 'clamp(16px, 4vw, 32px)',
        flexWrap: 'wrap', marginBottom: 24, paddingBottom: 22,
        borderBottom: '1px solid rgba(255,255,255,.06)',
      }}>
        <TrustStat number="80+" label="Commerces accompagnés à La Réunion" />
        <TrustStat number="500K+" label="Vues cumulées générées" />
        <TrustStat number="10 j" label="Délai moyen de production" />
      </div>

      {/* Offers */}
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        marginBottom: 24,
      }}>
        {UPSELL_OFFERS.map((offer, i) => (
          <UpsellCard key={i} offer={offer} />
        ))}
      </div>

      {/* Bottom clincher CTA */}
      <div style={{
        textAlign: 'center', padding: '18px 16px', borderRadius: 12,
        background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.25)',
      }}>
        <div style={{ fontSize: '0.92rem', color: 'var(--text)', marginBottom: 8, fontWeight: 600 }}>
          🎁 <strong>−10 % sur toute commande passée dans les 7 jours</strong> suivant la diffusion de votre vidéo
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-mid)' }}>
          Mentionnez ce code en réservant : <code style={{
            background: 'var(--night-card)', padding: '2px 8px', borderRadius: 4,
            color: 'var(--green)', fontWeight: 700, fontSize: '0.85rem',
          }}>FIDELE10</code>
        </div>
      </div>
    </div>
  );
}

function TrustStat({ number, label }: { number: string; label: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 90 }}>
      <div style={{
        fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
        fontSize: '1.5rem', color: 'var(--orange)', lineHeight: 1,
      }}>
        {number}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3 }}>
        {label}
      </div>
    </div>
  );
}

function UpsellCard({ offer }: { offer: UpsellOffer }) {
  const isHighlight = offer.highlight;
  return (
    <div style={{
      position: 'relative',
      padding: '22px 20px', borderRadius: 14,
      background: isHighlight
        ? 'linear-gradient(160deg, rgba(232,105,43,.20) 0%, rgba(232,105,43,.06) 100%)'
        : 'var(--night-card)',
      border: `${isHighlight ? '2px' : '1px'} solid ${isHighlight ? 'rgba(232,105,43,.65)' : 'var(--border-md)'}`,
      boxShadow: isHighlight
        ? '0 8px 32px rgba(232,105,43,.18), inset 0 1px 0 rgba(255,255,255,.05)'
        : '0 2px 10px rgba(0,0,0,.15)',
      display: 'flex', flexDirection: 'column', gap: 14,
      transform: isHighlight ? 'scale(1.02)' : 'none',
      transition: 'transform .2s ease',
    }}>
      {offer.badge && (
        <div style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          padding: '4px 14px', borderRadius: 999,
          background: 'linear-gradient(90deg, var(--orange), #C45520)',
          color: '#fff', boxShadow: '0 4px 12px rgba(232,105,43,.40)',
          fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
        }}>
          ⭐ {offer.badge}
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: 8, lineHeight: 1 }}>{offer.emoji}</div>
        <h3 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '1.1rem', color: 'var(--text)', margin: '0 0 8px',
        }}>
          {offer.title}
        </h3>
        <div style={{
          fontSize: '1.7rem', fontWeight: 900,
          color: isHighlight ? 'var(--orange)' : 'var(--text)',
          fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1.05,
          letterSpacing: '-0.02em',
        }}>
          {offer.price}
        </div>
      </div>

      <p style={{
        fontSize: '0.85rem', color: 'var(--text-mid)', margin: 0,
        lineHeight: 1.5, textAlign: 'center',
        paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,.06)',
      }}>
        {offer.description}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {offer.bullets.map((bullet, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            fontSize: '0.84rem', color: 'var(--text)',
          }}>
            <span aria-hidden style={{
              flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
              background: 'rgba(34,197,94,.18)', color: 'var(--green)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.72rem', fontWeight: 800, marginTop: 1,
            }}>✓</span>
            <span style={{ lineHeight: 1.45 }}>{bullet}</span>
          </li>
        ))}
      </ul>

      <a href={`mailto:contact@bourbonmedia.fr?subject=${encodeURIComponent(offer.mailtoSubject)}`} style={{
        display: 'block', padding: '13px 18px', borderRadius: 10, textAlign: 'center',
        background: isHighlight
          ? 'linear-gradient(90deg, var(--orange), #C45520)'
          : 'var(--night-mid)',
        color: isHighlight ? '#fff' : 'var(--orange)',
        border: isHighlight ? 'none' : '1.5px solid var(--orange)',
        boxShadow: isHighlight ? '0 6px 18px rgba(232,105,43,.35)' : 'none',
        textDecoration: 'none', fontSize: '0.92rem', fontWeight: 700,
        marginTop: 4, letterSpacing: '0.01em',
      }}>
        {offer.cta} →
      </a>
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
