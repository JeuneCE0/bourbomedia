'use client';

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import type { Annotation } from '@/components/ScriptAnnotator';
import { fireLiveAlert, ensureNotificationPermission } from '@/lib/live-notify';
import TimestampedVideoPlayer from '@/components/TimestampedVideoPlayer';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

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
  email?: string;
  phone?: string;
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
  contract_signed_at?: string;
  paid_at?: string;
  onboarding_call_booked?: boolean;
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
  onboarding_call: 'Appel onboarding',
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

// Les clés préfixées par `__` sont des étapes internes au stepper, non des
// valeurs de status DB. Elles représentent les jalons du funnel /onboarding
// (contrat / paiement) qui ne se reflètent pas dans `clients.status`.
const PROJECT_STAGES = [
  { key: 'onboarding',          label: 'Inscription',           emoji: '👋',  description: 'Vous êtes inscrit·e — bienvenue !' },
  { key: '__contract',          label: 'Contrat signé',         emoji: '✍️',  description: 'Votre contrat de prestation est signé.' },
  { key: '__payment',           label: 'Paiement',              emoji: '💳',  description: 'Votre paiement est confirmé.' },
  { key: 'onboarding_call',     label: 'Appel onboarding',      emoji: '📞',  description: 'Réservez votre appel de cadrage avec notre équipe.' },
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
  // Video delivered but not yet validated → ask the client to review.
  // Skip if status is already past video_review (publication_pending / published)
  // — happens when admin moves the client manually without validating per se.
  const pastVideoStage = client?.status === 'publication_pending' || client?.status === 'published';
  if (hasDelivery && !client?.video_validated_at && !pastVideoStage) {
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
  // Video validated (ou admin a poussé en publication_pending), pas encore de date choisie
  if (hasDelivery
      && (client?.video_validated_at || client?.status === 'publication_pending')
      && !client?.publication_date_confirmed) {
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
  const lastSeenClientStatusRef = useRef<string | null>(null);
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

  // Toast when the admin moves the client to a new stage (drag/drop on the
  // production kanban or status dropdown). Lets the client know live that
  // the project just advanced.
  useEffect(() => {
    if (!clientInfo?.status) return;
    const previous = lastSeenClientStatusRef.current;
    if (previous !== null && previous !== clientInfo.status) {
      const stageMessages: Record<string, { emoji: string; message: string }> = {
        onboarding_call: { emoji: '📞', message: 'Réservez votre appel onboarding pour démarrer.' },
        script_writing:  { emoji: '✍️', message: 'Notre équipe a commencé à écrire votre script.' },
        filming_scheduled: { emoji: '🎬', message: 'Votre tournage est confirmé !' },
        filming_done:    { emoji: '🎞️', message: 'Tournage terminé — montage en cours.' },
        editing:         { emoji: '🎞️', message: 'Votre vidéo est en montage.' },
        video_review:    { emoji: '👀', message: 'Votre vidéo est livrée — à vous de la valider !' },
        publication_pending: { emoji: '🗓️', message: 'Choisissez la date de publication.' },
        published:       { emoji: '🎉', message: 'Votre vidéo est en ligne — bravo !' },
      };
      const msg = stageMessages[clientInfo.status];
      if (msg) showToast(msg.emoji, msg.message);

      // 🎊 Confettis sur les transitions célébrables (uniquement si le
      // statut vient de changer, pas au 1er load — sauf published qui se
      // déclenche aussi une fois en lifetime).
      const CELEBRATE_BIG = new Set(['video_review', 'published']);
      const CELEBRATE_SMALL = new Set(['filming_scheduled', 'script_validated', 'publication_pending']);
      if (CELEBRATE_BIG.has(clientInfo.status)) {
        import('@/lib/celebrate').then(m => m.fireOnce(`portal:${token}`, clientInfo.status!, true));
      } else if (CELEBRATE_SMALL.has(clientInfo.status)) {
        import('@/lib/celebrate').then(m => m.fireOnce(`portal:${token}`, clientInfo.status!, false));
      }
    }
    lastSeenClientStatusRef.current = clientInfo.status;
  }, [clientInfo?.status, showToast, token]);

  // Confetti à l'arrivée sur le portail si le projet est déjà publié et que le
  // client n'a pas encore "vu" la célébration (par device).
  useEffect(() => {
    if (clientInfo?.status === 'published' && token) {
      import('@/lib/celebrate').then(m => m.fireOnce(`portal:${token}`, 'published', true));
    }
  }, [clientInfo?.status, token]);

  // Live polling — faster cadence when the user is on the script or comments
  // tab so admin replies and team comments feel instantaneous. We bump from
  // 60s (passive) to 5s (active tab) to stay within Vercel/Supabase quotas
  // while still feeling near-real-time.
  useEffect(() => {
    if (!token) return;
    // Polling cadence : faster on script/comments tabs (5s) where the client
    // expects near-real-time updates from admin annotations & replies. On
    // other tabs we still poll every 10s so any admin stage change (script
    // sent, video delivered, status moved manually) is reflected within ~10s.
    const ms = (tab === 'script' || tab === 'comments') ? 5_000 : 10_000;
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
    <div style={{
      maxWidth: 800, margin: '0 auto', padding: 'clamp(16px, 3vw, 28px)',
    }}>
      {/* Header skeleton */}
      <div className="bm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          padding: 20, borderRadius: 14,
          background: 'var(--night-card)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ height: 24, width: '50%', borderRadius: 6, background: 'linear-gradient(90deg, rgba(255,255,255,.04) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,.04) 100%)', backgroundSize: '200% 100%', animation: 'bm-shimmer 1.4s ease-in-out infinite' }} />
          <div style={{ height: 14, width: '70%', borderRadius: 6, background: 'linear-gradient(90deg, rgba(255,255,255,.04) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,.04) 100%)', backgroundSize: '200% 100%', animation: 'bm-shimmer 1.4s ease-in-out infinite' }} />
        </div>
        {/* Roadmap skeleton (8 lignes) */}
        <div style={{
          padding: 20, borderRadius: 14,
          background: 'var(--night-card)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {[0,1,2,3,4,5,6,7].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(90deg, rgba(255,255,255,.04) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,.04) 100%)', backgroundSize: '200% 100%', animation: 'bm-shimmer 1.4s ease-in-out infinite' }} />
              <div style={{ flex: 1, height: 14, borderRadius: 6, background: 'linear-gradient(90deg, rgba(255,255,255,.04) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,.04) 100%)', backgroundSize: '200% 100%', animation: 'bm-shimmer 1.4s ease-in-out infinite' }} />
            </div>
          ))}
        </div>
      </div>
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
    // No script yet — show a contextual screen depending on the client's
    // current stage. Onboarding / onboarding_call need their own actionable
    // content (contract + payment / booking calendar). Otherwise fall back
    // to the "we're writing your script" message.
    return <NoScriptStage clientInfo={clientInfo} token={token} onRefresh={() => { loadScript(); loadNotifications(); }} />;
  }

  const currentStepIdx = SCRIPT_STEPS.findIndex(s => s.key === script.status);
  const statusInfo = SCRIPT_STEPS[currentStepIdx] || SCRIPT_STEPS[0];
  const canValidate = script.status === 'proposition' || script.status === 'modified';

  const deliveredVideos = videos.filter(v => v.delivered_at);
  const hasDelivery = deliveredVideos.length > 0 || (clientInfo?.delivered_at && clientInfo.video_url);
  const clientStatus = clientInfo?.status || '';

  // Étapes "calendrier uniquement" : on n'affiche que la timeline + le calendrier
  // pertinent. Pas d'onglets vidéo/feedback/etc. qui distrairaient de l'action
  // attendue (réserver le créneau).
  const isPublicationCalendarOnly =
    hasDelivery
    && (clientInfo?.video_validated_at || clientStatus === 'publication_pending')
    && !clientInfo?.publication_date_confirmed;

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

      <main className="bm-portal-main" style={{
        flex: 1,
        // When the user is reading/annotating the script, give the page much
        // more horizontal room so the script breathes. For other tabs we keep
        // a comfortable reading width.
        maxWidth: tab === 'script' ? 1180 : 760,
        width: '100%', margin: '0 auto', padding: 'clamp(14px, 3vw, 24px)',
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
              marginBottom: 14, padding: '16px 18px', borderRadius: 12,
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
          marginBottom: 14, padding: '16px 18px', borderRadius: 12,
          background: 'var(--night-card)', border: '1px solid var(--border)',
        }}>
          <h3 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '0.95rem', color: 'var(--text)', margin: '0 0 16px',
          }}>
            🗺️ Avancement de votre projet
          </h3>
          {(() => {
            // Pour le statut DB 'onboarding', on affine selon les flags du funnel
            // (contrat signé / paiement / appel réservé) — sinon, le stepper
            // resterait bloqué sur "Inscription" pendant tout le pré-appel.
            const stageIdx = (() => {
              if (clientStatus === 'onboarding' && clientInfo) {
                if (!clientInfo.contract_signed_at) return 1; // current : Contrat
                if (!clientInfo.paid_at) return 2;            // current : Paiement
                if (!clientInfo.onboarding_call_booked) return 3; // current : Appel
                // Tous les flags onboarding sont OK mais le status n'a pas
                // encore été flippé en 'onboarding_call' / 'script_writing'
                // (race entre webhook GHL et refresh client) → on affiche
                // déjà l'écriture du script comme étape courante pour ne
                // pas figer l'utilisateur sur "Appel onboarding".
                return 4;
              }
              return PROJECT_STAGES.findIndex(s => s.key === clientStatus);
            })();
            const effectiveIdx = stageIdx >= 0 ? stageIdx : 0;
            const total = PROJECT_STAGES.length;
            // Progress = stages done + 0.5 pour l'étape courante
            const progressPct = Math.min(100, Math.round(((effectiveIdx + 0.5) / total) * 100));

            // ETA prédite pour les pending steps : on suppose ~2 jours ouvrés
            // entre chaque étape, sauf publication (mardi/jeudi prochain).
            const baseDate = clientInfo?.updated_at ? new Date(clientInfo.updated_at) : new Date();
            const confirmedPublicationDate = clientInfo?.publication_date_confirmed && clientInfo?.publication_deadline
              ? new Date(clientInfo.publication_deadline)
              : null;
            const stageEta = (i: number, key: string): string | null => {
              if (i <= effectiveIdx) return null;
              const stepsAhead = i - effectiveIdx;
              if (key === 'published') {
                // Date confirmée par le client → affichée en vert via dateExtra,
                // pas d'estimation à dupliquer ici.
                if (confirmedPublicationDate) return null;
                const d = nextPublicationSlot(addBusinessDays(baseDate, (stepsAhead - 1) * 2));
                return `Estimation : ${fmtDate(d)}`;
              }
              const d = addBusinessDays(baseDate, stepsAhead * 2);
              const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
              if (days <= 0) return null;
              if (days === 1) return 'Estimation : demain';
              if (days <= 7) return `Estimation : dans ~${days}j`;
              return `Estimation : ${fmtDate(d)}`;
            };

            return (
              <>
                {/* Progress bar */}
                <div style={{ marginBottom: 22 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 6, fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                      Étape {effectiveIdx + 1} sur {total}
                    </span>
                    <span style={{ color: 'var(--orange)', fontWeight: 800, fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 16 }}>
                      {progressPct}%
                    </span>
                  </div>
                  <div style={{
                    height: 8, borderRadius: 99,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', width: `${progressPct}%`,
                      background: clientStatus === 'published'
                        ? 'linear-gradient(90deg, var(--green) 0%, #16A34A 100%)'
                        : 'linear-gradient(90deg, var(--orange) 0%, #C45520 100%)',
                      transition: 'width .8s cubic-bezier(.4,1.3,.6,1)',
                      borderRadius: 99,
                    }} />
                  </div>
                </div>

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
                      : stage.key === 'published' && confirmedPublicationDate
                        ? confirmedPublicationDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                        : null;
                    const eta = stageEta(i, stage.key);
                    const isCurrent = status === 'current';
                    return (
                      <li key={stage.key} style={{
                        display: 'grid', gridTemplateColumns: '36px 1fr', gap: 12, alignItems: 'flex-start',
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 54 }}>
                          <span aria-hidden style={{
                            width: isCurrent ? 36 : 30, height: isCurrent ? 36 : 30, borderRadius: '50%',
                            background: dotBg, border: `2px solid ${dotBorder}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontSize: isCurrent ? 16 : 14, flexShrink: 0,
                            fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                            boxShadow: isCurrent ? '0 0 0 6px rgba(232,105,43,.18)' : 'none',
                            transition: 'all .3s ease',
                          }}>{status === 'done' ? '✓' : stage.emoji}</span>
                          {!isLast && <span aria-hidden style={{ flex: 1, width: 2, background: lineBg, marginTop: 4 }} />}
                        </div>
                        <div style={{
                          paddingBottom: 18,
                          padding: isCurrent ? '8px 12px' : '0',
                          marginBottom: isCurrent ? 18 : 0,
                          marginTop: isCurrent ? -4 : 0,
                          borderRadius: isCurrent ? 10 : 0,
                          background: isCurrent ? 'rgba(232,105,43,.06)' : 'transparent',
                          border: isCurrent ? '1px solid rgba(232,105,43,.25)' : 'none',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: isCurrent ? 700 : 600, color: titleColor, fontSize: isCurrent ? 15 : 14.5 }}>
                              {stage.label}
                            </span>
                            {isCurrent && (
                              <span className="bm-pulse-glow" style={{
                                padding: '2px 8px', borderRadius: 999,
                                background: 'rgba(232,105,43,.16)', border: '1px solid rgba(232,105,43,.45)',
                                color: '#FFB58A', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                              }}>VOUS ÊTES ICI</span>
                            )}
                          </div>
                          {dateExtra && (
                            <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2, fontWeight: 600 }}>📅 {dateExtra}</div>
                          )}
                          {eta && (
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                              ⏱️ {eta}
                            </div>
                          )}
                          <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5 }}>
                            {stage.description}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            );
          })()}
        </div>

        {/* Filming booking — only when client is actively in the script_validated
            stage AND has no filming_date yet. As soon as the booking is confirmed
            (filming_date saved) OR the admin moves the client past this stage
            (filming_scheduled / filming_done / editing / video_review / etc.),
            the calendar disappears. */}
        {clientInfo?.status === 'script_validated' && !clientInfo?.filming_date && !hasDelivery && (
          <FilmingBookingPanel token={token!} onConfirmed={() => { loadScript(); loadNotifications(); }} actionLoading={actionLoading} />
        )}

        {/* Publication date picker — Tuesdays / Thursdays only */}
        {hasDelivery
          && (clientInfo?.video_validated_at || clientInfo?.status === 'publication_pending')
          && !clientInfo?.publication_date_confirmed && (
          <PublicationDatePicker
            token={token!}
            clientInfo={clientInfo}
            onConfirmed={() => { loadScript(); loadNotifications(); }}
          />
        )}

        {/* Confirmed publication banner — hidden once status='published' since
            <PublishedCelebration> already shows the date. Avoids duplicate. */}
        {clientInfo?.status !== 'published' && clientInfo?.publication_date_confirmed && clientInfo?.publication_deadline && (
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
          // Étape "Date de publication" : on cache tous les onglets pour ne
          // laisser que la timeline + le calendrier de réservation.
          const tabsList: ('video' | 'script' | 'comments' | 'feedback')[] = isPublicationCalendarOnly ? [] : [
            ...(hasDelivery ? ['video' as const] : []),
            ...(isInReview ? ['script' as const, 'comments' as const] : []),
            ...(hasDelivery ? ['feedback' as const] : []),
          ];
          if (tabsList.length === 0) return null;
          if (!tabsList.includes(tab)) {
            setTimeout(() => setTab(tabsList[0]), 0);
          }
          const tabLabel = (t: string) => t === 'video' ? '🎬' : t === 'script' ? '📄' : t === 'comments' ? '💬' : '⭐';
          const tabName = (t: string) => t === 'video' ? `Vos vidéos${deliveredVideos.length > 1 ? ` (${deliveredVideos.length})` : ''}`
            : t === 'script' ? 'Script'
            : t === 'comments' ? `Commentaires${script.script_comments?.length ? ` (${script.script_comments.length})` : ''}`
            : `Feedback${satisfaction ? ' ✓' : ''}`;
          return (
            <>
              {/* Top tabs (desktop visible, hidden on mobile via class) */}
              <div className="bm-portal-top-tabs" style={{
                display: 'flex', gap: 0, marginBottom: 20,
                borderBottom: '1px solid var(--border)', overflowX: 'auto',
              }}>
                {tabsList.map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    padding: '10px 18px', border: 'none', cursor: 'pointer',
                    fontSize: '0.8rem', fontWeight: tab === t ? 600 : 400,
                    background: 'transparent',
                    color: tab === t ? 'var(--orange)' : 'var(--text-muted)',
                    borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
                    transition: 'all .15s', whiteSpace: 'nowrap', minHeight: 44,
                  }}>
                    <span aria-hidden style={{ marginRight: 6, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>{tabLabel(t)}</span>
                    {tabName(t)}
                  </button>
                ))}
              </div>

              {/* Mobile bottom tab bar (sticky, fixed) */}
              <nav className="bm-portal-bottom-tabs" aria-label="Navigation portail" style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
                display: 'none', // affiché via media query CSS plus bas
                background: 'var(--night-card)',
                borderTop: '1px solid var(--border-md)',
                paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-around', alignItems: 'stretch',
                  padding: '8px 4px',
                }}>
                  {tabsList.map(t => {
                    const active = tab === t;
                    return (
                      <button key={t} onClick={() => setTab(t)} style={{
                        flex: 1, padding: '8px 4px', border: 'none',
                        background: 'transparent', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                        color: active ? 'var(--orange)' : 'var(--text-muted)',
                        fontSize: '0.66rem', fontWeight: active ? 700 : 500,
                        minHeight: 50,
                        borderRadius: 8,
                        transition: 'background .15s',
                      }}>
                        <span aria-hidden style={{ fontSize: '1.4rem', lineHeight: 1, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>{tabLabel(t)}</span>
                        <span style={{ fontSize: '0.64rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 78 }}>
                          {t === 'video' ? 'Vidéo' : t === 'script' ? 'Script' : t === 'comments' ? 'Comm.' : 'Avis'}
                        </span>
                        {active && <div style={{ width: 18, height: 2, borderRadius: 1, background: 'var(--orange)' }} />}
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* CSS responsive : top tabs cachés < 768px, bottom tabs visibles */}
              <style>{`
                @media (max-width: 767px) {
                  .bm-portal-top-tabs { display: none !important; }
                  .bm-portal-bottom-tabs { display: block !important; }
                  .bm-portal-main { padding-bottom: max(72px, env(safe-area-inset-bottom, 0px) + 70px) !important; }
                }
              `}</style>
            </>
          );
        })()}
        {/* Video delivery view (multi-video) */}
        {tab === 'video' && hasDelivery && !isPublicationCalendarOnly && (
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
                {/* Use the timestamped player when the client is in the review/validation
                    phase — they can pin per-second feedback. After validation, fall back
                    to the standard embed. */}
                {!clientInfo?.video_validated_at && token ? (
                  <TimestampedVideoPlayer
                    videoId={v.id}
                    videoUrl={v.video_url}
                    thumbnailUrl={v.thumbnail_url}
                    token={token}
                  />
                ) : (
                  <VideoEmbed url={v.video_url} thumbnail={v.thumbnail_url} />
                )}
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

            {/* Validation / demande de modifications : sous la vidéo et ses
                retours timestampés, pas en haut du portail. Ne s'affiche que
                si la vidéo est livrée et non encore validée par le client. */}
            {hasDelivery && !clientInfo?.video_validated_at
              && clientInfo?.status !== 'publication_pending'
              && clientInfo?.status !== 'published' && (
              <VideoReviewPanel
                token={token!}
                hasDelivery={!!hasDelivery}
                clientInfo={clientInfo}
                onActed={() => { loadScript(); loadNotifications(); }}
              />
            )}

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
        {tab === 'feedback' && !isPublicationCalendarOnly && (
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
              {/* Version selector — visible quand y'a au moins V2 */}
              <ScriptVersionPills token={token!} currentVersion={script.version} currentContent={script.content} />

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
  const calendarUrl = process.env.NEXT_PUBLIC_GHL_PUBLICATION_CALENDAR_URL
    || 'https://api.leadconnectorhq.com/widget/booking/RRDC3HvypJEIvLxjy3Gg';
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [showDateForm, setShowDateForm] = useState(false);
  const [pickedDate, setPickedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reveal the "I picked a date" button shortly after the iframe loads
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

  // Étape "Date de publication" : status=publication_pending agit comme un
  // signal admin que la vidéo est implicitement validée — on affiche le
  // calendrier même si video_validated_at n'a jamais été set côté client.
  if (!clientInfo?.video_validated_at && clientInfo?.status !== 'publication_pending') return null;
  if (clientInfo?.publication_date_confirmed) return null;

  async function confirm() {
    if (!pickedDate) return;
    if (!window.confirm('Avez-vous bien finalisé et confirmé votre date de publication ?')) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_publication_date', date: pickedDate }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || 'Erreur — réessayez ou contactez l\'équipe.');
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
            Réservez un créneau via le calendrier ci-dessous. Les publications sont planifiées le <strong>mardi</strong> ou le <strong>jeudi</strong>.
          </p>
        </div>
      </div>

      <GhlBookingEmbed
        url={calendarUrl}
        title="Réservation publication"
        onLoad={() => setIframeLoaded(true)}
      />

      {showButton && !showDateForm && (
        <button
          onClick={() => setShowDateForm(true)}
          style={{
            marginTop: 14, width: '100%', padding: '13px 22px', borderRadius: 12,
            background: 'var(--orange)', color: '#fff', border: 'none',
            cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700,
            boxShadow: '0 4px 14px rgba(232,105,43,.4)',
          }}
        >
          ✅ Confirmer ma date de publication
        </button>
      )}

      {showDateForm && (
        <div style={{
          marginTop: 14, padding: '14px 16px', borderRadius: 12,
          background: 'var(--night-mid)', border: '1px solid var(--border-md)',
        }}>
          <label style={{
            fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600,
            display: 'block', marginBottom: 6,
          }}>
            📅 Date que vous venez de réserver (mardi ou jeudi)
          </label>
          <input
            type="date"
            value={pickedDate}
            onChange={e => setPickedDate(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 8,
              background: 'var(--night-card)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.92rem', outline: 'none', fontFamily: 'inherit',
            }}
          />
          {error && (
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.82rem',
            }}>❌ {error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              onClick={() => { setShowDateForm(false); setPickedDate(''); setError(''); }}
              disabled={submitting}
              style={{
                padding: '9px 16px', borderRadius: 8, background: 'transparent',
                border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.85rem',
              }}
            >Annuler</button>
            <button
              onClick={confirm}
              disabled={!pickedDate || submitting}
              style={{
                padding: '11px 20px', borderRadius: 10, background: 'var(--orange)',
                color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.88rem',
                fontWeight: 700, opacity: !pickedDate || submitting ? 0.5 : 1,
                boxShadow: '0 4px 14px rgba(232,105,43,.4)',
              }}
            >
              {submitting ? '⏳ Enregistrement…' : '💾 Confirmer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilmingBookingPanel({ token, onConfirmed, actionLoading }: {
  token: string;
  onConfirmed: () => void;
  actionLoading: boolean;
}) {
  // Calendrier de tournage GHL. Le fallback générique NEXT_PUBLIC_GHL_CALENDAR_URL
  // remontait l'agenda d'onboarding par erreur quand GHL_FILMING_CALENDAR_URL n'était
  // pas configurée — on default désormais sur l'ID GHL du calendrier tournage.
  const calendarUrl = process.env.NEXT_PUBLIC_GHL_FILMING_CALENDAR_URL
    || 'https://api.leadconnectorhq.com/widget/booking/vKw4x99jCNnZnl5FuSig';
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Show "I booked" button 30s after iframe loads — laisse le temps au client
  // de finaliser dans GHL et au webhook de propager. Cohérent avec l'appel onboarding.
  useEffect(() => {
    if (!showButton) {
      const delay = iframeLoaded ? 30000 : 35000;
      const timer = setTimeout(() => setShowButton(true), delay);
      return () => clearTimeout(timer);
    }
  }, [iframeLoaded, showButton]);

  async function confirmBooking() {
    if (!window.confirm('Avez-vous bien finalisé et confirmé la réservation de votre tournage ?')) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`/api/scripts?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_filming_booked' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || 'Erreur — réessayez ou contactez l\'équipe.');
        return;
      }
      onConfirmed();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      marginBottom: 14, padding: '16px 18px', borderRadius: 12,
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
          <GhlBookingEmbed
            url={calendarUrl}
            title="Réservation tournage"
            onLoad={() => setIframeLoaded(true)}
          />

          {showButton ? (
            <>
              <button
                onClick={confirmBooking}
                disabled={submitting || actionLoading}
                style={{
                  marginTop: 14, width: '100%', padding: '13px 22px', borderRadius: 12,
                  background: 'var(--orange)', color: '#fff', border: 'none',
                  cursor: submitting ? 'wait' : 'pointer', fontSize: '0.95rem', fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(232,105,43,.4)',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? '⏳ Enregistrement…' : '✅ J\'ai réservé mon créneau'}
              </button>
              {error && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 6,
                  background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.8rem',
                }}>{error}</div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: '14px 0 0' }}>
              Réservez votre créneau ci-dessus. Le bouton de confirmation apparaîtra dans quelques secondes.
            </p>
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

/* ── GHL booking widget embed ──────────────────────────────────────────── */
// Mirrors the official GHL embed snippet exactly:
//   <iframe scrolling="no" id="<calendarId>_<ts>" src="..." />
//   <script src="https://link.msgsndr.com/js/form_embed.js"></script>
// The form_embed.js script auto-resizes the iframe to fit its content.

let formEmbedScriptLoaded = false;

function GhlBookingEmbed({ url, title, onLoad }: { url: string; title: string; onLoad?: () => void }) {
  // Inject the form_embed.js script once for the lifetime of the page
  useEffect(() => {
    if (formEmbedScriptLoaded) return;
    if (typeof document === 'undefined') return;
    const existing = document.querySelector('script[src="https://link.msgsndr.com/js/form_embed.js"]');
    if (existing) { formEmbedScriptLoaded = true; return; }
    const s = document.createElement('script');
    s.src = 'https://link.msgsndr.com/js/form_embed.js';
    s.type = 'text/javascript';
    s.async = true;
    document.body.appendChild(s);
    formEmbedScriptLoaded = true;
  }, []);

  // Stable iframe id matching GHL's pattern (calendarId_timestamp). Le script
  // form_embed.js retrouve l'iframe par id pour pousser les resize via
  // postMessage — un id qui change à chaque render casse ce mécanisme et
  // l'iframe reste figée à sa hauteur initiale, masquant les créneaux.
  const calendarId = url.split('/').pop() || 'calendar';
  const iframeId = useMemo(() => `${calendarId}_${Date.now()}`, [calendarId]);

  return (
    <div style={{
      borderRadius: 12, border: '1px solid var(--border-md)',
      background: '#fff', minHeight: 720,
    }}>
      <iframe
        id={iframeId}
        src={url}
        title={title}
        scrolling="no"
        onLoad={onLoad}
        style={{ width: '100%', border: 'none', display: 'block', minHeight: 720 }}
      />
    </div>
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
      marginBottom: 14, padding: '16px 18px', borderRadius: 12,
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
      marginBottom: 14, padding: '20px', borderRadius: 12,
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

/* ── Script version selector (pill bar) ───────────────────────────── */

interface ScriptVersionRow {
  id: string;
  version: number;
  content: unknown;
  status: string;
  created_at: string;
}

function ScriptVersionPills({ token, currentVersion, currentContent }: {
  token: string;
  currentVersion?: number;
  currentContent: unknown;
}) {
  const [versions, setVersions] = useState<ScriptVersionRow[]>([]);
  const [previewing, setPreviewing] = useState<ScriptVersionRow | null>(null);

  useEffect(() => {
    fetch(`/api/scripts/versions?token=${token}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setVersions(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [token]);

  if (versions.length === 0) return null;

  const allVersions = [
    { v: currentVersion || 1, label: `V${currentVersion || 1}`, current: true, content: currentContent, created_at: '' as string },
    ...versions.map(v => ({ v: v.version, label: `V${v.version}`, current: false, content: v.content, created_at: v.created_at })),
  ].sort((a, b) => b.v - a.v);

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap',
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--night-mid)', border: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          📚 Versions :
        </span>
        {allVersions.map((v, i) => {
          const isPreview = previewing?.version === v.v;
          const isCurrent = v.current;
          return (
            <button
              key={`v${v.v}-${i}`}
              onClick={() => {
                if (isCurrent) setPreviewing(null);
                else setPreviewing({ id: '', version: v.v, content: v.content, status: '', created_at: v.created_at });
              }}
              style={{
                padding: '5px 12px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600,
                background: isCurrent ? 'var(--orange)' : isPreview ? 'rgba(232,105,43,.18)' : 'var(--night-card)',
                color: isCurrent ? '#fff' : isPreview ? 'var(--orange)' : 'var(--text-mid)',
                border: `1px solid ${isCurrent || isPreview ? 'var(--orange)' : 'var(--border-md)'}`,
                cursor: 'pointer',
              }}
            >
              {v.label}{isCurrent ? ' · actuelle' : ''}
            </button>
          );
        })}
        {previewing && (
          <button
            onClick={() => setPreviewing(null)}
            style={{
              marginLeft: 'auto', padding: '5px 12px', borderRadius: 999, fontSize: '0.74rem',
              background: 'transparent', border: '1px solid var(--border-md)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >× Retour à l&apos;actuelle</button>
        )}
      </div>

      {previewing && (
        <div style={{
          marginBottom: 14, padding: '14px 16px', borderRadius: 12,
          background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.30)',
        }}>
          <div style={{ fontSize: '0.78rem', color: '#D8B4FE', fontWeight: 600, marginBottom: 8 }}>
            📜 Aperçu de la V{previewing.version}
            {previewing.created_at && ` — ${new Date(previewing.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`}
          </div>
          <div
            style={{
              padding: '12px 14px', borderRadius: 8,
              background: 'var(--night-card)', border: '1px solid var(--border)',
              fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.6,
              maxHeight: 400, overflowY: 'auto',
            }}
            dangerouslySetInnerHTML={{
              __html: typeof previewing.content === 'string'
                ? previewing.content
                : JSON.stringify(previewing.content),
            }}
          />
        </div>
      )}
    </>
  );
}

/* ── Contextual screen when no script exists yet ─────────────────────── */

function NoScriptStage({ clientInfo, token, onRefresh }: { clientInfo: ClientDelivery | null; token: string | null; onRefresh: () => void }) {
  const status = clientInfo?.status || 'script_writing';
  const onboardingCalendarUrl = process.env.NEXT_PUBLIC_GHL_ONBOARDING_CALENDAR_URL
    || process.env.NEXT_PUBLIC_GHL_CALENDAR_URL
    || 'https://api.leadconnectorhq.com/widget/booking/2fmSZkWpwEulfZsvpPmh';

  // 1. Onboarding — driven par les flags, pas par le status :
  //    !contract_signed_at  → signature du contrat (iframe inline)
  //    !paid_at             → paiement (Stripe Embedded Checkout inline)
  //    !onboarding_call_booked → réservation de l'appel (à venir, prochain commit)
  if (status === 'onboarding') {
    if (!clientInfo?.contract_signed_at && token) {
      return (
        <NoScriptShell
          emoji="✍️"
          title="Signez votre contrat"
          subtitle="Lisez, remplissez et signez votre contrat ci-dessous. Cela formalise notre collaboration."
        >
          <ContractStep clientInfo={clientInfo} token={token} onSigned={onRefresh} />
        </NoScriptShell>
      );
    }

    if (!clientInfo?.paid_at && token) {
      return (
        <NoScriptShell
          emoji="💳"
          title="Paiement sécurisé"
          subtitle="Réglez votre prestation en toute sécurité avec Stripe."
        >
          <PaymentStep token={token} onPaid={onRefresh} />
        </NoScriptShell>
      );
    }

    if (!clientInfo?.onboarding_call_booked && token) {
      return (
        <NoScriptShell
          emoji="📞"
          title="Réservez votre appel onboarding"
          subtitle="Un appel de cadrage de 30 min avec notre équipe pour bien démarrer votre vidéo."
        >
          <OnboardingCallStep token={token} calendarUrl={onboardingCalendarUrl} onBooked={onRefresh} />
        </NoScriptShell>
      );
    }
  }

  // 2. Onboarding call — appel réservé, on attend le rendez-vous puis l'écriture
  // du script. (Le branchement status='onboarding' ci-dessus gère la réservation
  // tant qu'elle n'est pas faite.)
  if (status === 'onboarding_call') {
    return (
      <NoScriptShell
        emoji="📞"
        title="Appel onboarding réservé"
        subtitle="Votre rendez-vous est planifié. Notre équipe attaque l'écriture de votre script juste après l'appel."
      />
    );
  }

  // 3. Script writing — team is on it. Empty state magnifié avec ETA.
  if (status === 'script_writing') {
    const updatedAt = clientInfo?.updated_at ? new Date(clientInfo.updated_at) : null;
    const eta = updatedAt ? addBusinessDays(updatedAt, 3) : null;
    const daysRemaining = eta ? Math.max(0, Math.ceil((eta.getTime() - Date.now()) / 86400000)) : null;
    return (
      <NoScriptShell
        emoji="✍️"
        title="Votre script est en préparation"
        subtitle="Notre équipe planche sur votre vidéo. On revient vers vous très vite avec une 1ère version à valider."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480, margin: '0 auto' }}>
          <div style={{
            padding: '14px 18px', borderRadius: 12,
            background: 'rgba(232,105,43,.08)', border: '1px solid rgba(232,105,43,.25)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span aria-hidden style={{ fontSize: '1.4rem' }}>⏱️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>
                {daysRemaining !== null && daysRemaining <= 1
                  ? "Estimation : d'ici demain"
                  : daysRemaining !== null && daysRemaining <= 5
                    ? `Estimation : dans environ ${daysRemaining} jours ouvrés`
                    : 'Estimation : 3-5 jours ouvrés'}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Vous serez notifié·e dès la livraison
              </div>
            </div>
          </div>
          <div style={{
            padding: '14px 18px', borderRadius: 12,
            background: 'var(--night-card)', border: '1px solid var(--border)',
            fontSize: '0.84rem', color: 'var(--text-mid)', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--text)' }}>Que se passe-t-il en coulisses ?</strong>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: '0.82rem' }}>
              <li>Analyse de votre commerce et de votre cible</li>
              <li>Recherche d&apos;angle créatif et structure (hook + bénéfices + CTA)</li>
              <li>Rédaction d&apos;une 1ère version pensée pour votre audience</li>
              <li>Relecture interne avant envoi</li>
            </ol>
          </div>
        </div>
      </NoScriptShell>
    );
  }

  // 4. Filming scheduled / done / editing — script validé mais on est pas
  // encore en review vidéo. Cas peu fréquent (ce path n'est atteint que si
  // hasDelivery=false ET pas de script chargé), mais on prévoit un fallback.
  if (status === 'filming_scheduled' || status === 'filming_done' || status === 'editing') {
    const messages: Record<string, { emoji: string; title: string; subtitle: string }> = {
      filming_scheduled: { emoji: '📅', title: 'Tournage planifié', subtitle: 'Votre tournage est confirmé. À très bientôt !' },
      filming_done: { emoji: '🎬', title: 'Tournage dans la boîte !', subtitle: 'L\'équipe lance le montage. Vous recevrez la vidéo très vite.' },
      editing: { emoji: '🎞️', title: 'Votre vidéo est en montage', subtitle: 'Compte à rebours avant la livraison ! On vous envoie un message dès que c\'est prêt.' },
    };
    const m = messages[status];
    return <NoScriptShell emoji={m.emoji} title={m.title} subtitle={m.subtitle} />;
  }

  // 5. Default fallback
  return (
    <NoScriptShell
      emoji="✍️"
      title="Votre script est en préparation"
      subtitle="Notre équipe travaille sur votre script vidéo. Vous recevrez une notification dès qu'il sera prêt pour votre relecture."
    />
  );
}

/* ── Étape appel onboarding (inline dans /portal — booking GHL) ─────── */
function OnboardingCallStep({ token, calendarUrl, onBooked }: {
  token: string;
  calendarUrl: string;
  onBooked: () => void;
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 30s d'attente avant d'afficher le bouton — laisse le temps au client de
  // finaliser la réservation et au webhook GHL de remonter le rendez-vous.
  useEffect(() => {
    if (!showButton) {
      const delay = iframeLoaded ? 30000 : 35000;
      const timer = setTimeout(() => setShowButton(true), delay);
      return () => clearTimeout(timer);
    }
  }, [iframeLoaded, showButton]);

  async function handleBooked() {
    if (!confirm('Avez-vous bien finalisé et confirmé votre rendez-vous d’onboarding ?')) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`/api/onboarding?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'call_booked', date: new Date().toISOString() }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur');
      }
      onBooked();
    } catch (e: unknown) {
      setError((e as Error).message || "Nous n'avons pas pu confirmer votre réservation. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <GhlBookingEmbed
        url={calendarUrl}
        title="Appel onboarding"
        onLoad={() => setIframeLoaded(true)}
      />

      {showButton ? (
        <>
          <button
            onClick={handleBooked}
            disabled={submitting}
            style={{
              padding: '13px 22px', borderRadius: 12,
              background: 'var(--orange)', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700,
              boxShadow: '0 4px 14px rgba(232,105,43,.4)',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? '⏳ Vérification…' : '✅ J\'ai réservé mon appel'}
          </button>
          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,.08)', borderLeft: '3px solid var(--red)', borderRadius: 6, color: '#fca5a5', fontSize: '0.84rem' }}>
              {error}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: 0 }}>
          Réservez votre créneau ci-dessus. Le bouton de confirmation apparaîtra dans quelques secondes.
        </p>
      )}
    </div>
  );
}

/* ── Étape paiement (inline dans /portal — Stripe Embedded Checkout) ─ */
function PaymentStep({ token, onPaid }: { token: string; onPaid: () => void }) {
  const searchParams = useSearchParams();
  const paymentReturn = searchParams.get('payment') === 'success';
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (paymentReturn) return; // Le webhook va valider, on attend le refresh.
    if (clientSecret) return;
    (async () => {
      try {
        const r = await fetch(`/api/onboarding?token=${token}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create_payment', returnPath: '/portal' }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erreur Stripe');
        setClientSecret(data.clientSecret);
      } catch (e: unknown) {
        setLoadError((e as Error).message || 'Impossible d\'initialiser le paiement.');
      }
    })();
  }, [token, clientSecret, paymentReturn]);

  // Stripe redirige vers ?payment=success — on poll le portail jusqu'à ce que
  // le webhook ait posé paid_at, puis on quitte cette étape.
  useEffect(() => {
    if (!paymentReturn) return;
    const interval = setInterval(() => onPaid(), 3000);
    return () => clearInterval(interval);
  }, [paymentReturn, onPaid]);

  if (paymentReturn) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid var(--border-md)', borderTopColor: 'var(--orange)',
          margin: '0 auto 18px', animation: 'spin 1s linear infinite',
        }} />
        <h3 style={{ color: 'var(--text)', fontSize: '1rem', margin: '0 0 6px' }}>Paiement en cours de vérification…</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
          Cette page se mettra à jour automatiquement.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,.10)', borderLeft: '3px solid var(--red)', borderRadius: 6, color: '#fca5a5', fontSize: '0.85rem' }}>
        ❌ {loadError}
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div style={{ padding: 16, borderRadius: 10, background: 'var(--night-mid)', border: '1px dashed var(--border-md)', fontSize: '0.85rem', color: 'var(--text-mid)', textAlign: 'center' }}>
        ⚠ Stripe n&apos;est pas configuré côté front (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY manquante).
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid var(--border-md)', borderTopColor: 'var(--orange)',
          margin: '0 auto 16px', animation: 'spin 1s linear infinite',
        }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement du paiement…</p>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden' }}>
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

/* ── Étape contrat (inline dans /portal) ───────────────────────────── */
function ContractStep({ clientInfo, token, onSigned }: {
  clientInfo: ClientDelivery | null;
  token: string;
  onSigned: () => void;
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const contractUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_GHL_CONTRACT_URL || '';
    if (!base || !clientInfo) return base;
    const nameParts = clientInfo.contact_name?.trim().split(' ') || [];
    const params = new URLSearchParams();
    if (nameParts[0]) params.set('first_name', nameParts[0]);
    if (nameParts.length > 1) params.set('last_name', nameParts.slice(1).join(' '));
    if (clientInfo.email) params.set('email', clientInfo.email);
    if (clientInfo.phone) params.set('phone', clientInfo.phone);
    if (clientInfo.business_name) params.set('companyName', clientInfo.business_name);
    const sep = base.includes('?') ? '&' : '?';
    return base + sep + params.toString();
  }, [clientInfo]);

  useEffect(() => {
    if (!showButton) {
      const delay = iframeLoaded ? 2500 : 8000;
      const timer = setTimeout(() => setShowButton(true), delay);
      return () => clearTimeout(timer);
    }
  }, [iframeLoaded, showButton]);

  async function handleSigned() {
    if (!confirm('Avez-vous bien finalisé et confirmé la signature de votre contrat ?')) return;
    setChecking(true);
    setError('');
    try {
      const r = await fetch(`/api/onboarding?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_contract' }),
      });
      const data = await r.json();
      if (!r.ok || !data.signed) {
        setError(data.error || "Nous n'avons pas pu confirmer votre signature. Réessayez ou contactez-nous.");
        return;
      }
      onSigned();
    } catch {
      setError("Erreur réseau, réessayez.");
    } finally {
      setChecking(false);
    }
  }

  if (!contractUrl) {
    return (
      <div style={{ padding: 16, borderRadius: 10, background: 'var(--night-mid)', border: '1px dashed var(--border-md)', fontSize: '0.85rem', color: 'var(--text-mid)', textAlign: 'center' }}>
        ⚠ Le lien de contrat n&apos;est pas configuré côté serveur. Contactez l&apos;équipe BourbonMédia.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-md)', background: '#fff' }}>
        <iframe
          src={contractUrl}
          onLoad={() => setIframeLoaded(true)}
          style={{ width: '100%', height: '78vh', minHeight: 600, border: 'none', display: 'block' }}
          title="Contrat de prestation"
          allow="camera;microphone"
        />
      </div>

      {showButton ? (
        <>
          <div style={{
            padding: '10px 14px', background: 'rgba(250,204,21,.08)',
            borderLeft: '3px solid var(--yellow)', borderRadius: 6,
            color: 'var(--yellow)', fontSize: '0.82rem', lineHeight: 1.5,
          }}>
            ⚠ Avant de continuer, clique sur <strong>« Terminé »</strong> en bas du contrat ci-dessus pour finaliser ta signature, <em>puis</em> sur le bouton ci-dessous.
          </div>
          <button
            onClick={handleSigned}
            disabled={checking}
            style={{
              padding: '13px 22px', borderRadius: 12,
              background: 'var(--orange)', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700,
              boxShadow: '0 4px 14px rgba(232,105,43,.4)',
              opacity: checking ? 0.6 : 1,
            }}
          >
            {checking ? '⏳ Vérification…' : '✅ J\'ai signé mon contrat'}
          </button>
          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,.08)', borderLeft: '3px solid var(--red)', borderRadius: 6, color: '#fca5a5', fontSize: '0.84rem' }}>
              {error}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', margin: 0 }}>
          Prenez le temps de lire et signer le contrat ci-dessus
        </p>
      )}
    </div>
  );
}

function NoScriptShell({ emoji, title, subtitle, children }: { emoji: string; title: string; subtitle: string; children?: React.ReactNode }) {
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
      <main style={{ flex: 1, maxWidth: 720, width: '100%', margin: '0 auto', padding: 'clamp(20px, 5vw, 40px)', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', margin: '20px 0' }}>{emoji}</div>
        <h2 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
          fontSize: '1.4rem', color: 'var(--text)', margin: '0 0 10px',
        }}>{title}</h2>
        <p style={{ color: 'var(--text-mid)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 auto 24px', maxWidth: 520 }}>
          {subtitle}
        </p>
        {children && <div style={{ textAlign: 'left' }}>{children}</div>}
      </main>
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
