'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { fireLiveAlert, ensureNotificationPermission } from '@/lib/live-notify';
import { SkeletonCard } from '@/components/ui/Skeleton';
import ThreadPanel from '@/components/ThreadPanel';
import PresenceIndicator from '@/components/PresenceIndicator';
import LinkGhlButton from '@/components/LinkGhlButton';

const ScriptEditor = dynamic(() => import('@/components/ScriptEditor'), { ssr: false });
const ScriptAnnotator = dynamic(() => import('@/components/ScriptAnnotator'), { ssr: false });

interface AdminAnnotationReply {
  id: string;
  author_type: 'client' | 'admin';
  author_name: string;
  text: string;
  created_at: string;
}

interface AdminAnnotation {
  id: string;
  quote: string;
  note: string;
  pos_from?: number | null;
  pos_to?: number | null;
  resolved: boolean;
  author_name?: string | null;
  author_type: 'client' | 'admin';
  created_at: string;
  script_version?: number | null;
  replies?: AdminAnnotationReply[];
}

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  email?: string;
  phone?: string;
  city?: string;
  category?: string;
  status: string;
  portal_token?: string;
  notes?: string;
  filming_date?: string;
  publication_deadline?: string;
  created_at: string;
  scripts?: Script[];
  video_url?: string;
  video_thumbnail_url?: string;
  delivery_notes?: string;
  delivered_at?: string;
  filming_checklist?: ChecklistItem[];
  filming_photos?: string[];
  filming_notes?: string;
  tags?: string[];
  todos?: TodoItem[];
  videos?: VideoItem[];
  provider_fees?: ProviderFee[];
  paid_at?: string;
  payment_amount?: number;
  ghl_contact_id?: string | null;
}

interface ProviderFee {
  id: string;
  type: 'filmmaker' | 'editor' | 'voiceover' | 'other';
  amount_cents: number;
  description?: string;
  paid_at?: string | null;
  created_at: string;
}

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

interface VideoItem {
  id: string;
  title?: string;
  video_url: string;
  thumbnail_url?: string;
  delivery_notes?: string;
  status: string;
  delivered_at?: string;
  created_at: string;
  feedback?: VideoFeedback[];
}

interface VideoFeedback {
  id: string;
  time_seconds: number;
  comment: string;
  author: 'client' | 'admin';
  created_at: string;
  resolved?: boolean;
}

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

interface Script {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  status: string;
  version: number;
  script_comments?: Comment[];
}

interface Comment {
  id: string;
  author_name: string;
  author_type: string;
  content: string;
  created_at: string;
}

interface ScriptVersion {
  id: string;
  version: number;
  content: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
  stripe_session_id?: string;
  stripe_payment_intent?: string;
  receipt_url?: string;
  invoice_pdf_url?: string;
  invoice_number?: string;
  created_at: string;
}

interface TimelineItem {
  id: string;
  timestamp: string;
  type: string;
  emoji: string;
  color: string;
  title: string;
  description?: string;
  actor?: string;
  href?: string;
}

interface GhlOpportunityRow {
  id: string;
  ghl_opportunity_id: string;
  pipeline_stage_name: string | null;
  name: string | null;
  monetary_value_cents: number | null;
  prospect_status: string | null;
  ghl_created_at: string | null;
  ghl_updated_at: string | null;
}

interface GhlAppointmentRow {
  id: string;
  ghl_appointment_id: string;
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: string;
  starts_at: string;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  opportunity_name: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  onboarding_call: 'Appel onboarding',
  script_writing: 'Écriture script',
  script_review: 'Relecture client',
  script_validated: 'Script validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tournage terminé',
  editing: 'Montage',
  video_review: 'Vidéo à valider',
  publication_pending: 'Date publication',
  published: 'Publié',
};

const STATUS_COLORS: Record<string, string> = {
  onboarding: '#8A7060',
  onboarding_call: '#14B8A6',
  script_writing: '#FACC15',
  script_review: '#F28C55',
  script_validated: '#22C55E',
  filming_scheduled: '#3B82F6',
  filming_done: '#8B5CF6',
  editing: '#EC4899',
  video_review: '#F97316',
  publication_pending: '#FB923C',
  published: '#22C55E',
};

const SCRIPT_STATUS: Record<string, string> = {
  draft: 'Brouillon',
  proposition: 'Proposition',
  awaiting_changes: 'Attente de modifications',
  modified: 'Modifié',
  confirmed: 'Confirmé',
};

const STEPS = Object.keys(STATUS_LABELS);

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const searchParams = useSearchParams();
  type TabKey = 'conversation' | 'info' | 'ghl' | 'script' | 'delivery' | 'payments';
  const initialTab = (() => {
    const t = searchParams.get('tab');
    return (['conversation', 'info', 'ghl', 'script', 'filming', 'delivery', 'payments'] as const).includes(t as TabKey) ? (t as TabKey) : 'conversation';
  })();

  const [client, setClient] = useState<Client | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTabState] = useState<TabKey>(initialTab);

  // Sync tab → URL so admin can share / refresh and stay on the right tab
  const setTab = useCallback((next: TabKey) => {
    setTabState(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next === 'conversation') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState({}, '', url.toString());
    }
  }, []);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  // Compteur incrémenté au clic sur "Enregistrer" — passé à <ScriptEditor> qui
  // déclenche un save manuel quand il change. Remplace l'autosave 2s qui flippait
  // silencieusement le status en 'modified' et faisait toaster faussement le client.
  const [scriptSaveTrigger, setScriptSaveTrigger] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [ghlData, setGhlData] = useState<{ opportunities: GhlOpportunityRow[]; appointments: GhlAppointmentRow[] }>({ opportunities: [], appointments: [] });
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  // Default payment = vidéo unique 500€ HT + 8.5% TVA = 542,50€ TTC
  const [paymentForm, setPaymentForm] = useState({ amount: '542.50', description: 'Vidéo unique (500€ HT + 8,5% TVA)', method: 'virement' as 'virement' | 'especes' | 'cheque' | 'autre' });
  const [addingPayment, setAddingPayment] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newTodo, setNewTodo] = useState('');
  const [newVideo, setNewVideo] = useState({ title: '', video_url: '', thumbnail_url: '', delivery_notes: '' });
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoUpload, setVideoUpload] = useState<{ name: string; pct: number } | null>(null);
  const [annotations, setAnnotations] = useState<AdminAnnotation[]>([]);
  const [feeForm, setFeeForm] = useState<{ type: 'filmmaker' | 'editor' | 'voiceover' | 'other'; amount: string; description: string }>({ type: 'filmmaker', amount: '', description: '' });
  const [addingFee, setAddingFee] = useState(false);

  async function addFee(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = parseFloat(feeForm.amount);
    if (!amountNum || amountNum <= 0) return;
    setAddingFee(true);
    try {
      const r = await fetch('/api/clients/fees', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          client_id: id, type: feeForm.type,
          amount_cents: Math.round(amountNum * 100),
          description: feeForm.description.trim() || undefined,
        }),
      });
      if (r.ok) {
        setFeeForm({ type: 'filmmaker', amount: '', description: '' });
        loadClient();
        notify('success', 'Frais ajouté');
      } else {
        notify('error', 'Erreur lors de l\'ajout');
      }
    } finally { setAddingFee(false); }
  }

  async function deleteFee(feeId: string) {
    if (!confirm('Supprimer ce frais ?')) return;
    try {
      const r = await fetch(`/api/clients/fees?client_id=${id}&fee_id=${feeId}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (r.ok) loadClient();
    } catch { /* */ }
  }

  function notify(type: 'error' | 'success', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function parseErr(r: Response): Promise<string> {
    try {
      const d = await r.json();
      return d.error || r.statusText || 'Erreur inconnue';
    } catch {
      return r.statusText || 'Erreur inconnue';
    }
  }

  const loadClient = useCallback(async () => {
    try {
      const r = await fetch(`/api/clients?id=${id}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await parseErr(r));
      const d = await r.json();
      setClient(d);
      if (d?.scripts?.length) {
        setScript(d.scripts[0]);
      }
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadClient(); }, [loadClient]);

  const loadPayments = useCallback(() => {
    fetch(`/api/payments?client_id=${id}`, { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) return;
        const d = await r.json();
        if (Array.isArray(d)) setPayments(d);
      })
      .catch(() => {});
  }, [id]);

  const loadGhl = useCallback(() => {
    fetch(`/api/clients/ghl?id=${id}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { opportunities: [], appointments: [] })
      .then(d => setGhlData({ opportunities: d.opportunities || [], appointments: d.appointments || [] }))
      .catch(() => {});
  }, [id]);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const r = await fetch(`/api/clients/timeline?id=${id}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setTimelineItems(Array.isArray(d.items) ? d.items : []);
      }
    } catch { /* noop */ } finally { setTimelineLoading(false); }
  }, [id]);

  useEffect(() => {
    if (tab === 'conversation') loadTimeline();
    if (tab === 'payments') loadPayments();
    if (tab === 'ghl') loadGhl();
  }, [tab, loadTimeline, loadPayments, loadGhl]);

  // Auto-refresh the conversation timeline every 15s so new events surface
  // without manual reload (paiement Stripe, validation script, feedback vidéo…).
  useEffect(() => {
    if (tab !== 'conversation') return;
    const t = setInterval(() => loadTimeline(), 15_000);
    return () => clearInterval(t);
  }, [tab, loadTimeline]);

  async function loadVersions() {
    if (!script) return;
    try {
      const r = await fetch(`/api/scripts/versions?script_id=${script.id}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await parseErr(r));
      setVersions(await r.json());
      setShowVersions(true);
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    }
  }

  const loadAnnotations = useCallback(async () => {
    if (!script) { setAnnotations([]); return; }
    try {
      const r = await fetch(`/api/scripts/annotations?script_id=${script.id}`, { headers: authHeaders() });
      if (!r.ok) { setAnnotations([]); return; }
      const data = await r.json();
      if (Array.isArray(data)) setAnnotations(data);
    } catch { /* table may not exist yet */ }
  }, [script]);

  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Live polling on the script tab — detect new client activity (comments,
  // annotations, replies) every 5s while the admin has the tab open.
  useEffect(() => {
    if (tab !== 'script' || !script) return;
    const interval = setInterval(() => {
      loadClient();
      loadAnnotations();
    }, 5_000);
    return () => clearInterval(interval);
  }, [tab, script, loadClient, loadAnnotations]);

  // Detect new client comments on the script
  const lastSeenAdminCommentIdRef = useRef<string | null>(null);
  useEffect(() => {
    const comments = script?.script_comments || [];
    if (comments.length === 0) { lastSeenAdminCommentIdRef.current = null; return; }
    const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const newest = sorted[sorted.length - 1];
    const prev = lastSeenAdminCommentIdRef.current;
    if (prev !== null && prev !== newest.id && newest.author_type === 'client') {
      fireLiveAlert(
        (e, msg) => notify('success', `${e} ${msg}`),
        '💬',
        `${newest.author_name || 'Le client'} a commenté le script`,
        { tag: `client-comment-${newest.id}` },
      );
    }
    lastSeenAdminCommentIdRef.current = newest.id;
  }, [script?.script_comments]);

  // Detect new client annotations
  const lastSeenAnnotationIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (annotations.length === 0) { lastSeenAnnotationIdsRef.current = new Set(); return; }
    const ids = new Set(annotations.map(a => a.id));
    const newClientAnnotations = annotations.filter(a => a.author_type === 'client' && !lastSeenAnnotationIdsRef.current.has(a.id));
    // Skip alerts on initial mount
    if (lastSeenAnnotationIdsRef.current.size === 0) {
      lastSeenAnnotationIdsRef.current = ids;
      return;
    }
    if (newClientAnnotations.length > 0) {
      const first = newClientAnnotations[0];
      const more = newClientAnnotations.length > 1 ? ` (+${newClientAnnotations.length - 1})` : '';
      fireLiveAlert(
        (e, msg) => notify('success', `${e} ${msg}`),
        '🖍️',
        `${first.author_name || 'Le client'} a annoté le script${more}`,
        { tag: `client-annot-${first.id}` },
      );
    }
    lastSeenAnnotationIdsRef.current = ids;
  }, [annotations]);

  // Detect new client replies on annotations
  const lastSeenAdminReplyIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (annotations.length === 0) { lastSeenAdminReplyIdsRef.current = new Set(); return; }
    const allIds = new Set<string>();
    const newClientReplies: { author: string; annotationId: string }[] = [];
    annotations.forEach(a => {
      (a.replies || []).forEach(r => {
        allIds.add(r.id);
        if (!lastSeenAdminReplyIdsRef.current.has(r.id) && r.author_type === 'client' && lastSeenAdminReplyIdsRef.current.size > 0) {
          newClientReplies.push({ author: r.author_name, annotationId: a.id });
        }
      });
    });
    if (lastSeenAdminReplyIdsRef.current.size === 0) {
      lastSeenAdminReplyIdsRef.current = allIds;
      return;
    }
    if (newClientReplies.length > 0) {
      const first = newClientReplies[0];
      const more = newClientReplies.length > 1 ? ` (+${newClientReplies.length - 1})` : '';
      fireLiveAlert(
        (e, msg) => notify('success', `${e} ${msg}`),
        '↩️',
        `${first.author} a répondu à une annotation${more}`,
        { tag: `client-reply-${first.annotationId}` },
      );
    }
    lastSeenAdminReplyIdsRef.current = allIds;
  }, [annotations]);

  // First user interaction → request notification permission
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

  // Auto-create the script when admin opens the Script tab and no script exists.
  // Removes the "Créer le script" friction step — the editor is ready immediately.
  // Tracks per-page-session attempts so we don't loop on failure.
  const autoCreateAttemptedRef = useRef(false);
  useEffect(() => {
    if (tab !== 'script') return;
    if (!client || script || loading || saving) return;
    if (autoCreateAttemptedRef.current) return;
    autoCreateAttemptedRef.current = true;
    void (async () => {
      try {
        setSaving(true);
        const r = await fetch('/api/scripts', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            client_id: client.id,
            title: `Script — ${client.business_name || 'Client'}`,
          }),
        });
        if (r.ok) {
          const created = await r.json();
          setScript({ ...created, script_comments: [] });
          if (client.status === 'onboarding') {
            await fetch('/api/clients', {
              method: 'PUT', headers: authHeaders(),
              body: JSON.stringify({ id: client.id, status: 'script_writing' }),
            });
            loadClient();
          }
        }
      } catch { /* silent fallback to manual button */ }
      finally { setSaving(false); }
    })();
  }, [tab, client, script, loading, saving, loadClient]);

  async function updateAnnotation(id: string, fields: { note?: string; resolved?: boolean; add_reply?: string }) {
    try {
      const r = await fetch(`/api/scripts/annotations`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ id, ...fields }),
      });
      if (r.ok) {
        const updated = await r.json();
        setAnnotations(prev => prev.map(a => a.id === id ? updated : a));
        if (fields.add_reply) notify('success', 'Réponse envoyée au client');
      }
    } catch { /* */ }
  }

  async function handleSaveScript(content: Record<string, unknown>) {
    setSaving(true);
    try {
      // No script yet? Create it (POST upserts: server matches by client_id + UNIQUE constraint).
      if (!script) {
        const created = await fetch('/api/scripts', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            client_id: id,
            title: `Script — ${client?.business_name || 'Client'}`,
            content,
            status: 'draft',
          }),
        });
        if (!created.ok) throw new Error(await parseErr(created));
        const newScript = await created.json();
        setScript({ ...newScript, script_comments: [] });
        // Bump client status to script_writing if still in onboarding
        if (client?.status === 'onboarding') {
          await fetch('/api/clients', {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify({ id, status: 'script_writing' }),
          });
        }
        notify('success', 'Script créé et enregistré');
        loadClient();
        return;
      }

      const r = await fetch('/api/scripts', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: script.id, content }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      // Use the server response to update local state — avoids a stale loadClient race
      const updated = await r.json();
      setScript(prev => prev ? { ...prev, ...updated } : updated);
      notify('success', 'Script enregistré');
      // Refresh comments / events in background (no await needed)
      loadClient();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleCreateScript() {
    setSaving(true);
    try {
      const r = await fetch('/api/scripts', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ client_id: id, title: `Script — ${client?.business_name}` }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      const created = await r.json();
      setScript({ ...created, script_comments: [] });
      await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status: 'script_writing' }),
      });
      setTab('script');
      notify('success', 'Script créé — commencez à rédiger');
      await loadClient();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleSendToClient() {
    if (!script) return;
    setSaving(true);
    try {
      const sr = await fetch('/api/scripts', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: script.id, status: 'proposition' }),
      });
      if (!sr.ok) throw new Error(await parseErr(sr));
      // Bump the client status to 'script_review' so the kanban / portal
      // reflect that the script is now with the client. Check explicitly
      // so a silent failure doesn't leave the client stuck in 'onboarding'.
      const cr = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status: 'script_review' }),
      });
      if (!cr.ok) throw new Error('Script envoyé mais le statut client n\'a pas pu être mis à jour : ' + (await parseErr(cr)));
      notify('success', 'Script envoyé · client → Relecture');
      loadClient();
      loadTimeline();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleUpdateStatus(status: string) {
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
      loadTimeline();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    }
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, ...editForm }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', 'Informations enregistrées');
      setEditing(false);
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setSaving(false); }
  }

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim() || !script) return;
    setSendingComment(true);
    try {
      const r = await fetch('/api/scripts/comments', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ script_id: script.id, content: comment, author_name: 'Admin' }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      setComment('');
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setSendingComment(false); }
  }

  async function handleAddChecklistItem() {
    if (!newChecklistItem.trim() || !client) return;
    const next = [...(client.filming_checklist || []), {
      id: crypto.randomUUID(),
      text: newChecklistItem.trim(),
      done: false,
    }];
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, filming_checklist: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      setNewChecklistItem('');
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleToggleChecklist(itemId: string) {
    if (!client) return;
    const next = (client.filming_checklist || []).map(i => i.id === itemId ? { ...i, done: !i.done } : i);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, filming_checklist: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleRemoveChecklist(itemId: string) {
    if (!client) return;
    const next = (client.filming_checklist || []).filter(i => i.id !== itemId);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, filming_checklist: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleSaveFilmingNotes(notes: string) {
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, filming_notes: notes }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleUploadPhoto(file: File) {
    setUploadingPhoto(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/upload', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      const { url } = await r.json();
      const next = [...(client?.filming_photos || []), url];
      const r2 = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, filming_photos: next }),
      });
      if (!r2.ok) throw new Error(await parseErr(r2));
      notify('success', 'Photo ajoutée');
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
    finally { setUploadingPhoto(false); }
  }

  async function handleRemovePhoto(url: string) {
    if (!client) return;
    const next = (client.filming_photos || []).filter(p => p !== url);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, filming_photos: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleAddTag() {
    const t = newTag.trim().toLowerCase();
    if (!t || !client) return;
    if ((client.tags || []).includes(t)) { notify('error', 'Tag déjà présent'); return; }
    const next = [...(client.tags || []), t];
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, tags: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      setNewTag('');
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleRemoveTag(tag: string) {
    if (!client) return;
    const next = (client.tags || []).filter(t => t !== tag);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, tags: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleAddTodo() {
    if (!newTodo.trim() || !client) return;
    const next: TodoItem[] = [...(client.todos || []), {
      id: crypto.randomUUID(), text: newTodo.trim(), done: false, created_at: new Date().toISOString(),
    }];
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, todos: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      setNewTodo('');
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleToggleTodo(todoId: string) {
    if (!client) return;
    const next = (client.todos || []).map(t => t.id === todoId ? { ...t, done: !t.done } : t);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, todos: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleRemoveTodo(todoId: string) {
    if (!client) return;
    const next = (client.todos || []).filter(t => t.id !== todoId);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, todos: next }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleUploadVideo(file: File) {
    if (!file.type.startsWith('video/')) {
      notify('error', 'Sélectionne un fichier vidéo (mp4, mov, webm…)');
      return;
    }
    setVideoUpload({ name: file.name, pct: 0 });
    try {
      const r = await fetch('/api/videos/upload-url', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ filename: file.name, contentType: file.type, clientId: id }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      const { uploadUrl, publicUrl } = await r.json();

      // XHR for upload progress (fetch can't report upload bytes)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setVideoUpload({ name: file.name, pct: Math.round((ev.loaded / ev.total) * 100) });
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload échoué (${xhr.status}) ${xhr.responseText || ''}`.trim()));
        };
        xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload"));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      setNewVideo(v => ({
        ...v,
        video_url: publicUrl,
        title: v.title || file.name.replace(/\.[^.]+$/, ''),
      }));
      notify('success', 'Vidéo importée — clique sur Enregistrer ou Livrer pour finaliser');
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally {
      setVideoUpload(null);
    }
  }

  async function handleAddVideo(e: React.FormEvent, deliver: boolean) {
    e.preventDefault();
    if (!newVideo.video_url) { notify('error', 'URL vidéo requise'); return; }
    setSavingVideo(true);
    try {
      const r = await fetch('/api/videos', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          client_id: id,
          title: newVideo.title || null,
          video_url: newVideo.video_url,
          thumbnail_url: newVideo.thumbnail_url || null,
          delivery_notes: newVideo.delivery_notes || null,
          status: deliver ? 'delivered' : 'draft',
        }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      // When delivering, also bump the client status so the portal knows to
      // show the video review step. Without this, the admin would have to
      // manually move the client to 'video_review' on the kanban — easy to
      // forget, leading to "I delivered the video but client sees nothing".
      if (deliver) {
        await fetch('/api/clients', {
          method: 'PUT', headers: authHeaders(),
          body: JSON.stringify({ id, status: 'video_review' }),
        }).catch(() => null);
      }
      notify('success', deliver ? 'Vidéo livrée · client → Vidéo à valider' : 'Vidéo enregistrée');
      setNewVideo({ title: '', video_url: '', thumbnail_url: '', delivery_notes: '' });
      loadClient();
      loadTimeline();
    } catch (e: unknown) { notify('error', (e as Error).message); }
    finally { setSavingVideo(false); }
  }

  async function handleToggleDeliverVideo(videoId: string, currentlyDelivered: boolean) {
    try {
      const r = await fetch('/api/videos', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: videoId, status: currentlyDelivered ? 'draft' : 'delivered' }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', currentlyDelivered ? 'Retirée de la livraison' : 'Vidéo livrée au client');
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleRemoveVideo(videoId: string) {
    if (!confirm('Supprimer cette vidéo ?')) return;
    try {
      const r = await fetch('/api/videos', {
        method: 'DELETE', headers: authHeaders(),
        body: JSON.stringify({ id: videoId }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', 'Vidéo supprimée');
      loadClient();
    } catch (e: unknown) { notify('error', (e as Error).message); }
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = parseFloat(paymentForm.amount);
    if (!amountNum || amountNum <= 0) { notify('error', 'Montant invalide'); return; }
    setAddingPayment(true);
    try {
      const methodLabel = paymentForm.method === 'virement' ? '🏦 Virement bancaire'
        : paymentForm.method === 'especes' ? '💵 Espèces'
        : paymentForm.method === 'cheque' ? '📝 Chèque'
        : '📌 Autre';
      const desc = paymentForm.description ? `${methodLabel} · ${paymentForm.description}` : methodLabel;
      const r = await fetch('/api/payments', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          client_id: id,
          amount: Math.round(amountNum * 100),
          description: desc,
        }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      // Also bump client.payment_amount + paid_at if not already set, so the
      // CA/finance KPIs reflect this manual payment immediately.
      if (!client?.paid_at) {
        await fetch('/api/clients', {
          method: 'PUT', headers: authHeaders(),
          body: JSON.stringify({
            id,
            payment_amount: Math.round(amountNum * 100),
            paid_at: new Date().toISOString(),
          }),
        }).catch(() => null);
      }
      notify('success', `${methodLabel} ajouté · ${amountNum} €`);
      setPaymentForm({ amount: '542.50', description: 'Vidéo unique (500€ HT + 8,5% TVA)', method: 'virement' });
      loadPayments();
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setAddingPayment(false); }
  }

  async function handleMarkFilmingDone() {
    if (!confirm('Marquer le tournage comme terminé ?')) return;
    await handleUpdateStatus('filming_done');
  }

  async function handleDelete() {
    if (!client) return;
    // UX optimiste avec undo : on redirige immédiatement, l'archive ne se commit
    // qu'après 5s si l'admin n'a pas cliqué Annuler. Pas d'archivage si undo.
    const businessName = client.business_name;
    let undone = false;
    router.push('/dashboard/pipeline?tab=clients');
    setTimeout(() => {
      if (typeof window === 'undefined') return;
      // Lazy import du toast pour rester en dehors du provider scope
      window.dispatchEvent(new CustomEvent('bbm-toast-undoable', { detail: {
        message: `📦 "${businessName}" archivé du pipeline onboarding`,
        emoji: '↩️',
        durationMs: 5000,
        onUndo: () => { undone = true; /* skip commit */ },
        onCommit: async () => {
          if (undone) return;
          await fetch('/api/clients', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) }).catch(() => null);
        },
      }}));
    }, 80);
  }

  if (loading) return (
    <div style={{ padding: '24px 28px', maxWidth: 960, margin: '0 auto' }}>
      <div className="bm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={4} />
      </div>
    </div>
  );
  if (!client) return <div style={{ padding: 32, color: 'var(--red)' }}>Client introuvable</div>;

  const portalUrl = client.portal_token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/portal?token=${client.portal_token}` : null;

  // Sum unresolved client feedback across all delivered videos — drives the
  // "Montage" tab badge so the admin sees pending modifications at a glance.
  const pendingFeedbackCount = (client.videos || [])
    .flatMap(v => (v.feedback || []) as VideoFeedback[])
    .filter(f => f.author === 'client' && !f.resolved)
    .length;

  const TAB_LIST: { key: typeof tab; label: string; badge?: string }[] = [
    { key: 'conversation', label: '💬 Conversation' },
    { key: 'script', label: 'Script', badge: script?.script_comments?.length ? `${script.script_comments.length}` : undefined },
    { key: 'delivery', label: 'Montage', badge: pendingFeedbackCount > 0 ? `${pendingFeedbackCount}` : (client.delivered_at ? '✓' : undefined) },
    { key: 'ghl', label: 'Closing & RDV' },
    { key: 'payments', label: 'Paiements', badge: payments.length > 0 ? `${payments.length}` : undefined },
    { key: 'info', label: 'Détails' },
  ];

  return (
    <div style={{ padding: '24px 28px 40px', maxWidth: 960, margin: '0 auto' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          padding: '10px 16px', borderRadius: 10, maxWidth: 380,
          background: toast.type === 'error' ? 'rgba(239,68,68,.95)' : 'rgba(34,197,94,.95)',
          color: '#fff', fontSize: '0.82rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          animation: 'slideIn .2s ease-out',
        }}>
          {toast.msg}
          <style>{`@keyframes slideIn { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/dashboard/clients')} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: '0.78rem', padding: 0, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: '0.9rem' }}>‹</span> Clients
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 style={{
                fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
                fontSize: '1.6rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
              }}>
                {client.business_name}
              </h1>
              <PresenceIndicator scope={`client/${id}`} />
              {!client.ghl_contact_id && (
                <LinkGhlButton
                  clientId={id}
                  size="sm"
                  label="🔗 Lier à GHL"
                  onLinked={loadClient}
                />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {client.contact_name}
              </span>
              {client.city && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', opacity: 0.7 }}>
                  · {client.city}
                </span>
              )}
              {client.category && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', opacity: 0.7 }}>
                  · {client.category}
                </span>
              )}
            </div>
          </div>

          {/* Right: status + actions */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <select
              value={client.status}
              onChange={e => handleUpdateStatus(e.target.value)}
              style={{
                padding: '6px 28px 6px 12px', borderRadius: 20,
                appearance: 'none',
                WebkitAppearance: 'none',
                background: `${STATUS_COLORS[client.status]}20 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E") no-repeat right 10px center`,
                color: STATUS_COLORS[client.status], border: 'none',
                fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                outline: 'none',
              }}
            >
              {STEPS.map(s => (
                <option key={s} value={s} style={{ background: 'var(--night)', color: 'var(--text)' }}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              {client.phone && (
                <a href={`https://wa.me/${client.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer"
                  className="bm-tip bm-tip-end" data-tip="Ouvrir une conversation WhatsApp"
                  aria-label="Ouvrir WhatsApp" style={miniActionStyle}>💬</a>
              )}
              {client.phone && (
                <a href={`tel:${client.phone}`}
                  className="bm-tip bm-tip-end" data-tip="Appeler le client"
                  aria-label="Appeler" style={miniActionStyle}>📞</a>
              )}
              {client.email && (
                <a href={`mailto:${client.email}`}
                  className="bm-tip bm-tip-end" data-tip="Envoyer un email"
                  aria-label="Email" style={miniActionStyle}>✉</a>
              )}
              {portalUrl && (
                <button onClick={() => { navigator.clipboard.writeText(portalUrl); notify('success', 'Lien portail copié'); }}
                  className="bm-tip bm-tip-end" data-tip="Copier le lien du portail client"
                  aria-label="Copier lien portail"
                  style={{ ...miniActionStyle, cursor: 'pointer' }}>🔗</button>
              )}
              <button onClick={handleDelete}
                className="bm-tip bm-tip-end" data-tip="Archiver — retire du pipeline onboarding (préserve l'opportunité GHL)"
                aria-label="Archiver"
                style={{ ...miniActionStyle, cursor: 'pointer', color: 'var(--text-muted)', opacity: 0.7 }}>📦</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs — scrollable horizontally on mobile (5 tabs fit on desktop) */}
      <div className="bm-tabs-row" style={{
        display: 'flex', gap: 2, marginBottom: 24,
        borderBottom: '1px solid var(--border)',
      }}>
        {TAB_LIST.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '10px 18px', border: 'none', cursor: 'pointer',
            fontSize: '0.82rem', fontWeight: tab === t.key ? 600 : 400,
            whiteSpace: 'nowrap',
            background: 'transparent',
            color: tab === t.key ? 'var(--orange)' : 'var(--text-muted)',
            borderBottom: tab === t.key ? '2px solid var(--orange)' : '2px solid transparent',
            marginBottom: -1,
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'color .15s',
          }}>
            {t.label}
            {t.badge && (
              <span style={{
                fontSize: '0.62rem', padding: '1px 6px', borderRadius: 8,
                background: tab === t.key ? 'rgba(232,105,43,.15)' : 'var(--night-mid)',
                color: tab === t.key ? 'var(--orange)' : 'var(--text-muted)',
                fontWeight: 600,
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <div key="tab-info" className="bm-fade-in" style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20 }}>
          {!editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginBottom: 20 }}>
                <InfoField label="Commerce" value={client.business_name} />
                <InfoField label="Contact" value={client.contact_name} />
                <InfoField label="Email" value={client.email} copyable />
                <InfoField label="Téléphone" value={client.phone} copyable />
                <InfoField label="Ville" value={client.city} />
                <InfoField label="Catégorie" value={client.category} />
                <InfoField label="Date tournage" value={client.filming_date ? new Date(client.filming_date).toLocaleDateString('fr-FR') : '—'} />
                <InfoField label="Deadline publication" value={client.publication_deadline ? new Date(client.publication_deadline).toLocaleDateString('fr-FR') : '—'} />
              </div>

              {portalUrl && (
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Portail client</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <code style={{
                      flex: 1, fontSize: '0.68rem', padding: '5px 8px', borderRadius: 6,
                      background: 'var(--night-mid)', color: 'var(--orange)', wordBreak: 'break-all',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{portalUrl}</code>
                    <button onClick={() => { navigator.clipboard.writeText(portalUrl); notify('success', 'Lien copié'); }} style={{
                      padding: '5px 10px', borderRadius: 6, background: 'var(--night-mid)',
                      border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                      cursor: 'pointer', fontSize: '0.72rem', whiteSpace: 'nowrap',
                    }}>Copier</button>
                  </div>
                </div>
              )}

              {/* Internal admin notes */}
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  Notes internes (invisibles pour le client)
                </span>
                <textarea
                  defaultValue={client.notes || ''}
                  onBlur={e => {
                    const v = e.target.value;
                    if (v !== (client.notes || '')) {
                      fetch('/api/clients', {
                        method: 'PUT', headers: authHeaders(),
                        body: JSON.stringify({ id, notes: v }),
                      }).then(async r => {
                        if (!r.ok) notify('error', await parseErr(r));
                        else { notify('success', 'Notes enregistrées'); loadClient(); }
                      });
                    }
                  }}
                  placeholder="Contexte, préférences client, rappels pour l'équipe…"
                  rows={3}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                    fontFamily: 'inherit', resize: 'vertical',
                  }}
                />
              </div>

              {/* Tags */}
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Tags
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(client.tags || []).map(t => (
                    <span key={t} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 4px 4px 10px', borderRadius: 14,
                      background: 'rgba(232,105,43,.1)', color: 'var(--orange)',
                      fontSize: '0.74rem', fontWeight: 500,
                    }}>
                      #{t}
                      <button onClick={() => handleRemoveTag(t)} style={{
                        background: 'none', border: 'none', color: 'var(--orange)',
                        cursor: 'pointer', fontSize: '0.78rem', lineHeight: 1, padding: '0 4px',
                      }}>✕</button>
                    </span>
                  ))}
                  <form onSubmit={(e) => { e.preventDefault(); handleAddTag(); }} style={{ display: 'flex', gap: 4 }}>
                    <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="+ tag"
                      style={{
                        padding: '4px 10px', borderRadius: 14, fontSize: '0.74rem',
                        background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                        color: 'var(--text)', outline: 'none', width: 80,
                      }}
                    />
                  </form>
                </div>
              </div>

              {/* TODOs */}
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Tâches internes
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {(client.todos || []).map(t => (
                    <div key={t.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 6,
                      background: t.done ? 'rgba(34,197,94,.04)' : 'var(--night-mid)',
                    }}>
                      <button onClick={() => handleToggleTodo(t.id)} style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        background: t.done ? 'var(--green)' : 'transparent',
                        border: `1.5px solid ${t.done ? 'var(--green)' : 'var(--border-md)'}`,
                        color: '#fff', cursor: 'pointer', fontSize: '0.6rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{t.done ? '✓' : ''}</button>
                      <span style={{
                        flex: 1, fontSize: '0.8rem',
                        color: t.done ? 'var(--text-muted)' : 'var(--text)',
                        textDecoration: t.done ? 'line-through' : 'none',
                      }}>{t.text}</span>
                      <button onClick={() => handleRemoveTodo(t.id)} style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', fontSize: '0.8rem', padding: 2,
                      }}>✕</button>
                    </div>
                  ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); handleAddTodo(); }} style={{ display: 'flex', gap: 6 }}>
                  <input value={newTodo} onChange={e => setNewTodo(e.target.value)} placeholder="Ajouter une tâche…"
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: '0.8rem',
                      background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                      color: 'var(--text)', outline: 'none',
                    }}
                  />
                  <button type="submit" disabled={!newTodo.trim()} style={{
                    padding: '6px 12px', borderRadius: 6, background: 'var(--orange)',
                    color: '#fff', border: 'none', fontSize: '0.78rem', cursor: 'pointer',
                    opacity: newTodo.trim() ? 1 : 0.5,
                  }}>+</button>
                </form>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditing(true); setEditForm(client); }} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                  border: '1px solid var(--border-md)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.8rem',
                }}>Modifier</button>
                <button onClick={handleDelete} title="Retire du pipeline onboarding · préserve l'opportunité GHL" style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                  border: '1px solid var(--border-md)', color: 'var(--text-mid)', cursor: 'pointer', fontSize: '0.8rem',
                }}>📦 Archiver</button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSaveInfo}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {([
                  ['business_name', 'Commerce'],
                  ['contact_name', 'Contact'],
                  ['email', 'Email'],
                  ['phone', 'Téléphone'],
                  ['city', 'Ville'],
                  ['category', 'Catégorie'],
                  ['filming_date', 'Date tournage'],
                  ['publication_deadline', 'Deadline publication'],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</span>
                    <input
                      type={key.includes('date') || key.includes('deadline') ? 'date' : 'text'}
                      value={(editForm as Record<string, string>)[key] || ''}
                      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6,
                        background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                        color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                      }}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditing(false)} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--border-md)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
                }}>Annuler</button>
                <button type="submit" disabled={saving} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--orange)',
                  color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          )}

        </div>
      )}

      {/* Conversation tab — unified timeline (events, RDV, paiements, scripts, vidéos, feedback, commentaires) */}
      {tab === 'conversation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ThreadPanel scopeType="client" scopeId={id} title="💬 Notes internes équipe" />
          <ConversationTimeline
            items={timelineItems}
            loading={timelineLoading}
            onJump={(t) => setTab(t)}
          />
        </div>
      )}

      {/* Closing & RDV tab — GHL opportunities + appointments linked to this client */}
      {tab === 'ghl' && (
        <GhlClientTab
          opportunities={ghlData.opportunities}
          appointments={ghlData.appointments}
        />
      )}

      {/* Script tab */}
      {tab === 'script' && (
        <div key="tab-script" className="bm-fade-in">
          {script ? (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: '0.72rem', padding: '4px 10px', borderRadius: 12, fontWeight: 600,
                    background: script.status === 'confirmed' ? 'rgba(34,197,94,.12)'
                      : script.status === 'awaiting_changes' ? 'rgba(250,204,21,.12)'
                      : script.status === 'proposition' || script.status === 'modified' ? 'rgba(232,105,43,.12)'
                      : 'var(--night-mid)',
                    color: script.status === 'confirmed' ? 'var(--green)'
                      : script.status === 'awaiting_changes' ? 'var(--yellow)'
                      : script.status === 'proposition' || script.status === 'modified' ? 'var(--orange)'
                      : 'var(--text-mid)',
                  }}>{SCRIPT_STATUS[script.status]}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>v{script.version}</span>
                  <button onClick={loadVersions} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline', padding: 0,
                  }}>Historique</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {client.portal_token && (
                    <a href={`/portal/print?token=${client.portal_token}`} target="_blank" rel="noreferrer" style={{
                      padding: '7px 14px', borderRadius: 8, background: 'var(--night-mid)',
                      border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                      fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'none',
                    }}>⇩ PDF</a>
                  )}
                  {(script.status === 'draft' || script.status === 'modified' || script.status === 'awaiting_changes') && (
                    <button onClick={handleSendToClient} disabled={saving} style={{
                      padding: '7px 14px', borderRadius: 8, background: 'var(--orange)',
                      color: '#fff', border: 'none', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600,
                    }}>
                      {saving ? 'Envoi…' : script.status === 'draft' ? 'Envoyer au client' : 'Renvoyer au client'}
                    </button>
                  )}
                </div>
              </div>
              {script.status === 'awaiting_changes' && (
                <div style={{
                  padding: '12px 14px', borderRadius: 10, marginBottom: 12,
                  background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.25)',
                  color: '#FDE68A', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <span aria-hidden style={{ fontSize: '1.2rem' }}>✏️</span>
                  <span style={{ flex: 1 }}>
                    <strong>Le client a demandé {annotations.filter(a => !a.resolved).length || 'des'} modification{(annotations.filter(a => !a.resolved).length || 0) !== 1 ? 's' : ''}.</strong>
                    {' '}Consultez les annotations dans le panneau de droite, modifiez le script puis cliquez sur <strong>Renvoyer au client</strong>.
                  </span>
                </div>
              )}
              {script.status === 'confirmed' && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                  background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)',
                  color: 'var(--green)', fontSize: '0.82rem',
                }}>
                  ✅ Script validé par le client
                </div>
              )}
              {/*
                Two views of the same script:
                - When there are annotations, default to the read-only annotator
                  so admin can see exactly what the client highlighted
                - The classic editor stays available below for actual editing
              */}
              {annotations.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10, gap: 8, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
                      💬 Annotations du client ({annotations.filter(a => !a.resolved).length} ouverte{annotations.filter(a => !a.resolved).length !== 1 ? 's' : ''} / {annotations.length} au total)
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Cliquez sur ✅ pour marquer comme traité après avoir modifié le script ci-dessous.
                    </span>
                  </div>
                  <ScriptAnnotator
                    content={script.content}
                    annotations={annotations}
                    onUpdate={updateAnnotation}
                    canAnnotate={false}
                    canReply={true}
                    emptyHint="Aucune annotation client pour le moment."
                  />
                </div>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, margin: '0 0 10px',
              }}>
                <h4 style={{
                  fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)',
                  margin: 0, textTransform: 'uppercase', letterSpacing: 0.5,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span aria-hidden>✏️</span> Édition du script
                </h4>
                <button
                  onClick={() => setScriptSaveTrigger(t => t + 1)}
                  disabled={saving}
                  style={{
                    padding: '6px 14px', borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', cursor: saving ? 'wait' : 'pointer',
                    fontSize: '0.78rem', fontWeight: 600,
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}
                </button>
              </div>
              <ScriptEditor
                content={script.content}
                onSave={handleSaveScript}
                saving={saving}
                saveTrigger={scriptSaveTrigger}
                aiContext={{
                  business_name: client.business_name,
                  category: client.category,
                  city: client.city,
                }}
              />

              {/* Comments (inline, below editor) */}
              <div style={{
                marginTop: 24, paddingTop: 20,
                borderTop: '1px solid var(--border)',
              }}>
                <h4 style={{
                  fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-mid)',
                  margin: '0 0 12px',
                }}>
                  Commentaires {script.script_comments?.length ? `(${script.script_comments.length})` : ''}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {script.script_comments && script.script_comments.length > 0 ? (
                    script.script_comments.map(c => (
                      <div key={c.id} style={{
                        padding: '10px 14px', borderRadius: 8,
                        background: c.author_type === 'admin' ? 'var(--night-mid)' : 'rgba(232,105,43,.06)',
                        border: `1px solid ${c.author_type === 'admin' ? 'var(--border)' : 'rgba(232,105,43,.15)'}`,
                        marginLeft: c.author_type === 'client' ? 20 : 0,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 600,
                            color: c.author_type === 'admin' ? 'var(--text-mid)' : 'var(--orange)',
                          }}>{c.author_name}</span>
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                            {new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>{c.content}</p>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>Aucun commentaire</p>
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
                <button type="submit" disabled={sendingComment || !comment.trim()} style={{
                  padding: '9px 16px', borderRadius: 8, background: 'var(--orange)',
                  color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.78rem',
                  cursor: 'pointer', opacity: sendingComment || !comment.trim() ? 0.5 : 1,
                }}>{sendingComment ? '…' : 'Envoyer'}</button>
                </form>
              </div>
            </>
          ) : (
            <div style={{
              textAlign: 'center', padding: '48px 20px',
              background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '3rem', marginBottom: 14 }} aria-hidden>📝</div>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '1rem', margin: '0 0 6px' }}>
                {saving ? 'Préparation du script en cours…' : 'Démarrer le script de ce client'}
              </p>
              <p style={{ color: 'var(--text-muted)', marginBottom: 18, fontSize: '0.85rem', lineHeight: 1.5 }}>
                {saving
                  ? 'Encore un instant — l\'éditeur va apparaître automatiquement.'
                  : 'L\'éditeur s\'ouvre dès qu\'on a créé l\'entrée. Cliquez sur le bouton ou attendez quelques secondes.'}
              </p>
              <button onClick={handleCreateScript} disabled={saving} style={{
                padding: '11px 24px', borderRadius: 10, background: 'var(--orange)',
                color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.9rem',
                cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1,
                boxShadow: '0 4px 14px rgba(232,105,43,.35)',
              }}>{saving ? '⏳ Création…' : '✍️ Créer et commencer à écrire'}</button>
            </div>
          )}
        </div>
      )}


      {/* Delivery tab */}
      {tab === 'delivery' && (
        <div key="tab-delivery" className="bm-fade-in" style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20 }}>
          <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Vidéos livrées</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {(client.videos || []).filter(v => v.status === 'delivered').length} vidéo(s) visible(s) côté client
                {(client.videos || []).filter(v => v.status === 'draft').length > 0 && ` · ${(client.videos || []).filter(v => v.status === 'draft').length} brouillon(s)`}
              </p>
            </div>
          </div>

          {/* Existing videos */}
          {client.videos && client.videos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {client.videos.map(v => (
                <div key={v.id} style={{
                  padding: 14, borderRadius: 10,
                  background: 'var(--night-mid)', border: `1px solid ${v.status === 'delivered' ? 'rgba(34,197,94,.2)' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 600 }}>
                        {v.title || 'Vidéo sans titre'}
                      </div>
                      <a href={v.video_url} target="_blank" rel="noreferrer" style={{
                        fontSize: '0.72rem', color: 'var(--orange)', wordBreak: 'break-all', textDecoration: 'none',
                      }}>{v.video_url} ↗</a>
                    </div>
                    <span style={{
                      fontSize: '0.68rem', padding: '3px 9px', borderRadius: 12, fontWeight: 600, whiteSpace: 'nowrap',
                      background: v.status === 'delivered' ? 'rgba(34,197,94,.12)' : 'rgba(250,204,21,.12)',
                      color: v.status === 'delivered' ? 'var(--green)' : 'var(--yellow)',
                    }}>{v.status === 'delivered' ? '✓ Livrée' : 'Brouillon'}</span>
                  </div>
                  {v.delivery_notes && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 8px', whiteSpace: 'pre-wrap' }}>
                      {v.delivery_notes}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button onClick={() => handleToggleDeliverVideo(v.id, v.status === 'delivered')} style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: '0.74rem', cursor: 'pointer',
                      background: v.status === 'delivered' ? 'var(--night-card)' : 'var(--green)',
                      color: v.status === 'delivered' ? 'var(--text-mid)' : '#fff',
                      border: v.status === 'delivered' ? '1px solid var(--border-md)' : 'none',
                    }}>{v.status === 'delivered' ? 'Retirer la livraison' : '✓ Livrer au client'}</button>
                    <button onClick={() => handleRemoveVideo(v.id)} style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: '0.74rem', cursor: 'pointer',
                      background: 'transparent', border: '1px solid rgba(239,68,68,.3)', color: 'var(--red)',
                    }}>✕ Supprimer</button>
                  </div>

                  {/* Feedback timestamps from client */}
                  {v.feedback && v.feedback.length > 0 && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <div style={{
                        fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span aria-hidden>💬</span>
                        Modifications demandées par le client ({v.feedback.filter(f => f.author === 'client').length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {v.feedback.map(f => {
                          const isClient = f.author === 'client';
                          const m = Math.floor(f.time_seconds / 60);
                          const s = Math.floor(f.time_seconds % 60);
                          return (
                            <div key={f.id} style={{
                              padding: '8px 10px', borderRadius: 8,
                              background: isClient ? 'rgba(232,105,43,.08)' : 'rgba(59,130,246,.06)',
                              border: `1px solid ${isClient ? 'rgba(232,105,43,.30)' : 'rgba(59,130,246,.25)'}`,
                              display: 'flex', alignItems: 'flex-start', gap: 8,
                            }}>
                              <span style={{
                                flexShrink: 0, padding: '2px 8px', borderRadius: 6,
                                background: isClient ? 'var(--orange)' : '#3B82F6', color: '#fff',
                                fontSize: '0.68rem', fontWeight: 700,
                                fontFamily: "'Bricolage Grotesque', sans-serif",
                              }}>
                                {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {f.comment}
                                </div>
                                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                  {isClient ? '🙋 Client' : '👤 Vous'}
                                  {' · '}
                                  {new Date(f.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new video */}
          <div style={{ borderTop: client.videos?.length ? '1px solid var(--border)' : 'none', paddingTop: client.videos?.length ? 16 : 0 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-mid)' }}>Ajouter une vidéo</h4>
            <form onSubmit={(e) => handleAddVideo(e, false)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input value={newVideo.title} onChange={e => setNewVideo({ ...newVideo, title: e.target.value })} placeholder="Titre (optionnel)"
                  style={videoInputStyle} />
                <input value={newVideo.thumbnail_url} onChange={e => setNewVideo({ ...newVideo, thumbnail_url: e.target.value })} placeholder="URL miniature (optionnel)"
                  style={videoInputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input type="url" required value={newVideo.video_url} onChange={e => setNewVideo({ ...newVideo, video_url: e.target.value })} placeholder="URL vidéo (YouTube, Vimeo, MP4…) ou importer depuis l'ordinateur →"
                  style={{ ...videoInputStyle, flex: 1 }} />
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  padding: '8px 14px', borderRadius: 8,
                  background: videoUpload ? 'var(--night-mid)' : 'var(--night-raised)',
                  border: '1px solid var(--border-md)', color: 'var(--text)',
                  fontSize: '0.78rem', cursor: videoUpload ? 'wait' : 'pointer',
                  opacity: videoUpload ? 0.7 : 1,
                }}>
                  <span aria-hidden="true">📁</span>
                  {videoUpload ? `Upload… ${videoUpload.pct}%` : 'Importer depuis mon ordinateur'}
                  <input type="file" accept="video/*" hidden disabled={!!videoUpload}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadVideo(f);
                      e.target.value = '';
                    }} />
                </label>
              </div>
              {videoUpload && (
                <div style={{ marginTop: -2 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{videoUpload.name}</span>
                    <span>{videoUpload.pct}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--night-raised)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${videoUpload.pct}%`, height: '100%', background: 'var(--orange)', transition: 'width .2s linear' }} />
                  </div>
                </div>
              )}
              <textarea value={newVideo.delivery_notes} onChange={e => setNewVideo({ ...newVideo, delivery_notes: e.target.value })} placeholder="Message pour le client (optionnel)" rows={2}
                style={{ ...videoInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="submit" disabled={savingVideo || !newVideo.video_url} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                  border: '1px solid var(--border-md)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.8rem',
                }}>{savingVideo ? '…' : 'Enregistrer brouillon'}</button>
                <button type="button" disabled={savingVideo || !newVideo.video_url} onClick={(e) => handleAddVideo(e as unknown as React.FormEvent, true)} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--green)',
                  color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                  opacity: newVideo.video_url ? 1 : 0.5,
                }}>{savingVideo ? '…' : '✓ Livrer maintenant'}</button>
              </div>
            </form>
          </div>

          {/* Legacy single-video form (only show if a single legacy video exists) */}
          {client.video_url && !client.videos?.some(v => v.video_url === client.video_url) && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                ⚠ Vidéo legacy détectée (champ unique). Réimportez-la dans la nouvelle table multi-vidéos.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Payments tab */}
      {tab === 'payments' && (
        <div key="tab-payments" className="bm-fade-in" style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20 }}>
          <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Paiements</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Total : {(payments.reduce((s, p) => s + p.amount, 0) / 100).toLocaleString('fr-FR')} €
              </p>
            </div>
          </div>

          {payments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {payments.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', borderRadius: 10,
                  background: 'var(--night-mid)', border: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 500 }}>
                      {(p.amount / 100).toLocaleString('fr-FR')} €
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {p.description || 'Paiement'} · {new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {p.invoice_pdf_url && (
                      <a href={p.invoice_pdf_url} target="_blank" rel="noreferrer" title="Télécharger la facture PDF" style={{
                        fontSize: '0.66rem', padding: '4px 10px', borderRadius: 8,
                        background: 'var(--orange)', color: '#fff',
                        textDecoration: 'none', fontWeight: 600,
                      }}>📄 Facture</a>
                    )}
                    {p.receipt_url && (
                      <a href={p.receipt_url} target="_blank" rel="noreferrer" title="Voir le reçu Stripe" style={{
                        fontSize: '0.66rem', padding: '4px 10px', borderRadius: 8,
                        background: 'transparent', border: '1px solid var(--border-md)',
                        color: 'var(--text-mid)', textDecoration: 'none', fontWeight: 600,
                      }}>🧾 Reçu</a>
                    )}
                    {p.stripe_payment_intent && (
                      <span style={{
                        fontSize: '0.65rem', padding: '3px 8px', borderRadius: 12,
                        background: 'rgba(99,102,241,.1)', color: '#6366f1',
                      }}>Stripe</span>
                    )}
                    <span style={{
                      fontSize: '0.7rem', padding: '3px 10px', borderRadius: 12, fontWeight: 600,
                      background: p.status === 'completed' ? 'rgba(34,197,94,.12)' : 'rgba(250,204,21,.12)',
                      color: p.status === 'completed' ? 'var(--green)' : 'var(--yellow)',
                    }}>
                      {p.status === 'completed' ? 'Payé' : p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20, marginBottom: 16 }}>
              Aucun paiement enregistré
            </p>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-mid)' }}>
              Ajouter un paiement manuel (virement, espèces, chèque…)
            </h4>
            <form onSubmit={handleAddPayment} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: '0 0 160px' }}>
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Méthode</span>
                <select
                  value={paymentForm.method}
                  onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value as 'virement' | 'especes' | 'cheque' | 'autre' })}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="virement">🏦 Virement bancaire</option>
                  <option value="especes">💵 Espèces</option>
                  <option value="cheque">📝 Chèque</option>
                  <option value="autre">📌 Autre</option>
                </select>
              </label>
              <label style={{ flex: '0 0 140px' }}>
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Montant (€)</span>
                <input
                  type="number" step="0.01" min="0"
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  placeholder="500.00"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
              </label>
              <label style={{ flex: 1, minWidth: 160 }}>
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Description</span>
                <input
                  type="text"
                  value={paymentForm.description}
                  onChange={e => setPaymentForm({ ...paymentForm, description: e.target.value })}
                  placeholder="Acompte, solde, option…"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
              </label>
              <button type="submit" disabled={addingPayment || !paymentForm.amount} style={{
                padding: '8px 16px', borderRadius: 8, background: 'var(--orange)',
                color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                opacity: addingPayment || !paymentForm.amount ? 0.5 : 1,
              }}>{addingPayment ? 'Ajout…' : '+ Ajouter'}</button>
            </form>
          </div>

          {/* ───────── Frais prestataires (filmmaker / montage / etc.) ───────── */}
          {(() => {
            const fees = (client?.provider_fees || []) as ProviderFee[];
            const totalFees = fees.reduce((s, f) => s + (f.amount_cents || 0), 0);
            const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
            const grossProfit = totalPayments - totalFees;
            const FEE_LABEL: Record<ProviderFee['type'], { emoji: string; label: string; color: string }> = {
              filmmaker: { emoji: '🎥', label: 'Filmmaker', color: '#3B82F6' },
              editor:    { emoji: '🎞️', label: 'Montage',   color: '#A855F7' },
              voiceover: { emoji: '🎙️', label: 'Voix off',  color: '#EC4899' },
              other:     { emoji: '🧾', label: 'Autre',     color: '#8A7060' },
            };
            return (
              <>
                <div style={{
                  marginTop: 26, paddingTop: 20, borderTop: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 14,
                }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                      💸 Frais prestataires
                    </h4>
                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Total dépensé : {(totalFees / 100).toLocaleString('fr-FR')} €
                      {totalPayments > 0 && (
                        <> · Bénéfice brut : <strong style={{ color: grossProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {(grossProfit / 100).toLocaleString('fr-FR')} €
                        </strong></>
                      )}
                    </p>
                  </div>
                </div>

                {fees.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {fees.map(f => {
                      const meta = FEE_LABEL[f.type];
                      return (
                        <div key={f.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 14px', borderRadius: 10,
                          background: 'var(--night-mid)', border: '1px solid var(--border)',
                          borderLeft: `3px solid ${meta.color}`,
                        }}>
                          <span aria-hidden style={{ fontSize: '1.1rem' }}>{meta.emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                              {meta.label}
                              {f.description && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {f.description}</span>}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              Ajouté le {new Date(f.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                          </div>
                          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--red)', whiteSpace: 'nowrap' }}>
                            -{(f.amount_cents / 100).toLocaleString('fr-FR')} €
                          </span>
                          <button onClick={() => deleteFee(f.id)} style={{
                            background: 'transparent', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', fontSize: '0.95rem', padding: 4,
                          }} title="Supprimer">🗑️</button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, marginBottom: 14,
                    background: 'var(--night-mid)', border: '1px dashed var(--border-md)',
                    fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center',
                  }}>
                    Aucun frais enregistré pour ce client.
                  </div>
                )}

                <form onSubmit={addFee} style={{
                  display: 'flex', gap: 8, padding: '12px',
                  background: 'var(--night-mid)', borderRadius: 10, alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <select value={feeForm.type} onChange={e => setFeeForm({ ...feeForm, type: e.target.value as ProviderFee['type'] })} style={{
                    padding: '8px 10px', borderRadius: 6, background: 'var(--night)',
                    border: '1px solid var(--border-md)', color: 'var(--text)', fontSize: '0.82rem', cursor: 'pointer',
                  }}>
                    <option value="filmmaker">🎥 Filmmaker</option>
                    <option value="editor">🎞️ Montage</option>
                    <option value="voiceover">🎙️ Voix off</option>
                    <option value="other">🧾 Autre</option>
                  </select>
                  <input
                    type="number" min="0" step="0.01" placeholder="Montant €"
                    value={feeForm.amount} onChange={e => setFeeForm({ ...feeForm, amount: e.target.value })}
                    style={{
                      width: 110, padding: '8px 10px', borderRadius: 6, background: 'var(--night)',
                      border: '1px solid var(--border-md)', color: 'var(--text)', fontSize: '0.82rem',
                    }}
                  />
                  <input
                    type="text" placeholder="Description (optionnel)"
                    value={feeForm.description} onChange={e => setFeeForm({ ...feeForm, description: e.target.value })}
                    style={{
                      flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 6, background: 'var(--night)',
                      border: '1px solid var(--border-md)', color: 'var(--text)', fontSize: '0.82rem',
                    }}
                  />
                  <button type="submit" disabled={addingFee || !feeForm.amount} style={{
                    padding: '8px 16px', borderRadius: 6, background: 'var(--orange)',
                    color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                    opacity: addingFee || !feeForm.amount ? 0.5 : 1,
                  }}>{addingFee ? '…' : '+ Frais'}</button>
                </form>
              </>
            );
          })()}
        </div>
      )}


      {/* Version history modal */}
      {showVersions && (
        <div onClick={() => setShowVersions(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text)' }}>Historique des versions</h3>
              <button onClick={() => setShowVersions(false)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1,
              }}>✕</button>
            </div>
            {versions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
                Aucune version antérieure
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {versions.map(v => (
                  <div key={v.id} style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--orange)' }}>
                        Version {v.version}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {new Date(v.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Statut : {SCRIPT_STATUS[v.status] || v.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const videoInputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
  color: 'var(--text)', fontSize: '0.82rem', boxSizing: 'border-box', outline: 'none',
};

const miniActionStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  background: 'var(--night-mid)', border: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '0.85rem', textDecoration: 'none', color: 'var(--text-mid)',
};

function ConversationTimeline({
  items, loading, onJump,
}: {
  items: TimelineItem[];
  loading: boolean;
  onJump: (tab: 'script' | 'delivery' | 'payments' | 'ghl' | 'info') => void;
}) {
  const [filter, setFilter] = useState<'all' | 'script' | 'video' | 'rdv' | 'paiement'>('all');

  const filtered = items.filter(it => {
    if (filter === 'all') return true;
    if (filter === 'script') return it.type.startsWith('script') || it.type === 'comment';
    if (filter === 'video') return it.type.startsWith('video') || it.type === 'video_feedback';
    if (filter === 'rdv') return it.type === 'appointment';
    if (filter === 'paiement') return it.type === 'payment' || it.type === 'payment_received';
    return true;
  });

  // Group by day for timeline UX
  const groups: { day: string; items: TimelineItem[] }[] = [];
  for (const it of filtered) {
    const d = new Date(it.timestamp);
    const dayKey = isNaN(d.getTime()) ? 'autre' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.day === dayKey) last.items.push(it);
    else groups.push({ day: dayKey, items: [it] });
  }

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'Tout' },
    { key: 'script', label: '📝 Script' },
    { key: 'video', label: '🎬 Vidéo' },
    { key: 'rdv', label: '📅 RDV' },
    { key: 'paiement', label: '💸 Paiements' },
  ];

  return (
    <div className="bm-fade-in" style={{
      background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20,
    }}>
      {/* Header + filters */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14, flexWrap: 'wrap', gap: 10,
      }}>
        <h3 style={{
          fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', margin: 0,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          💬 Conversation
          {items.length > 0 && (
            <span style={{
              fontSize: '0.68rem', padding: '2px 8px', borderRadius: 999,
              background: 'var(--night-mid)', color: 'var(--text-muted)', fontWeight: 600,
            }}>{items.length}</span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border-md)',
              background: filter === f.key ? 'rgba(232,105,43,.15)' : 'transparent',
              color: filter === f.key ? 'var(--orange)' : 'var(--text-muted)',
              fontSize: '0.72rem', fontWeight: filter === f.key ? 600 : 500, cursor: 'pointer',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '0.82rem' }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '14px 16px', borderRadius: 10,
          background: 'var(--night-mid)', border: '1px dashed var(--border-md)',
          fontSize: '0.82rem', color: 'var(--text-muted)',
        }}>
          {filter === 'all'
            ? 'Aucune activité encore. La timeline se remplit au fil du projet.'
            : 'Aucun événement de ce type pour ce client.'}
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* vertical line */}
          <div style={{
            position: 'absolute', left: 18, top: 6, bottom: 6, width: 2,
            background: 'var(--border-md)', opacity: 0.35,
          }} />
          {groups.map((g, gi) => (
            <div key={`${g.day}-${gi}`}>
              <div style={{
                position: 'sticky', top: 0, zIndex: 2, padding: '10px 0 8px 48px',
                fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                background: 'linear-gradient(to bottom, var(--night-card) 70%, transparent)',
              }}>{g.day}</div>
              {g.items.map(it => {
                const isClickable = ['script', 'video_delivered', 'video_feedback', 'payment', 'appointment'].includes(it.type);
                const handleClick = () => {
                  if (it.type.startsWith('script') || it.type === 'comment') onJump('script');
                  else if (it.type.startsWith('video')) onJump('delivery');
                  else if (it.type === 'payment') onJump('payments');
                  else if (it.type === 'appointment') onJump('ghl');
                };
                const time = new Date(it.timestamp);
                const timeLabel = isNaN(time.getTime()) ? '' : time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={it.id}
                    onClick={isClickable ? handleClick : undefined}
                    style={{
                      display: 'flex', gap: 14, alignItems: 'flex-start',
                      padding: '8px 8px 8px 0', position: 'relative',
                      cursor: isClickable ? 'pointer' : 'default',
                      borderRadius: 8, transition: 'background .12s',
                    }}
                    onMouseEnter={e => { if (isClickable) e.currentTarget.style.background = 'rgba(255,255,255,.02)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0, zIndex: 1,
                      background: 'var(--night-mid)', border: `2px solid ${it.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1rem',
                      fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                    }} aria-hidden>{it.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        gap: 8, alignItems: 'baseline', flexWrap: 'wrap',
                      }}>
                        <span style={{
                          fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600,
                        }}>{it.title}</span>
                        <span style={{
                          fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap',
                        }} title={it.actor}>
                          {it.actor === 'client' ? '👤' : it.actor === 'system' ? '⚙️' : it.actor ? '🛠️' : ''} {timeLabel}
                        </span>
                      </div>
                      {it.description && (
                        <div style={{
                          fontSize: '0.78rem', color: 'var(--text-mid)', marginTop: 3,
                          lineHeight: 1.45, wordBreak: 'break-word',
                        }}>{it.description}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value, copyable }: { label: string; value?: string | null; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const hasValue = value && value !== '—';
  const handleCopy = () => {
    if (!hasValue) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div>
      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.85rem', color: hasValue ? 'var(--text)' : 'var(--text-muted)' }}>{value || '—'}</span>
        {hasValue && copyable && (
          <button
            onClick={handleCopy}
            title={copied ? 'Copié !' : 'Copier'}
            aria-label={copied ? 'Copié' : `Copier ${label.toLowerCase()}`}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '0.78rem', color: copied ? 'var(--green)' : 'var(--text-muted)',
              padding: 2, lineHeight: 1, transition: 'color .15s',
            }}
          >
            {copied ? '✅' : '📋'}
          </button>
        )}
      </span>
    </div>
  );
}

/* ── Closing & RDV tab — surfaces all GHL data linked to the client ───── */

const KIND_META: Record<GhlAppointmentRow['calendar_kind'], { emoji: string; label: string; color: string }> = {
  closing:    { emoji: '📞', label: 'Closing',     color: 'var(--orange)' },
  onboarding: { emoji: '🚀', label: 'Onboarding',  color: '#14B8A6' },
  tournage:   { emoji: '🎬', label: 'Tournage',    color: '#3B82F6' },
  other:      { emoji: '📅', label: 'Rendez-vous', color: 'var(--text-mid)' },
};

const PROSPECT_LABEL: Record<string, { emoji: string; label: string; color: string }> = {
  reflection:         { emoji: '🤔', label: 'En réflexion',                 color: '#FACC15' },
  follow_up:          { emoji: '🔁', label: 'Follow-up',                    color: '#F97316' },
  ghosting:           { emoji: '👻', label: 'Ghosting',                     color: '#94A3B8' },
  awaiting_signature: { emoji: '✍️', label: 'Attente signature + paiement', color: '#3B82F6' },
  contracted:         { emoji: '🤝', label: 'Contracté',                    color: '#22C55E' },
  regular:            { emoji: '⭐', label: 'Client régulier',              color: '#A855F7' },
  not_interested:     { emoji: '🚫', label: 'Pas intéressé',                color: '#737373' },
  closed_lost:        { emoji: '❌', label: 'Perdu',                        color: '#EF4444' },
};

function fmtEUR(cents: number | null): string {
  if (!cents) return '—';
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function GhlClientTab({ opportunities, appointments }: { opportunities: GhlOpportunityRow[]; appointments: GhlAppointmentRow[] }) {
  const totalValue = opportunities.reduce((s, o) => s + (o.monetary_value_cents || 50000), 0);

  if (opportunities.length === 0 && appointments.length === 0) {
    return (
      <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🪧</div>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
          Aucune donnée GHL liée
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
          Aucune opportunité ni RDV GHL n&apos;a été trouvé pour ce client (matching par client_id, ghl_contact_id ou email).
        </p>
      </div>
    );
  }

  return (
    <div className="bm-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats strip */}
      <div style={{
        display: 'flex', gap: 0, background: 'var(--night-card)',
        borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <GhlStatCell label="Opportunités" value={opportunities.length.toString()} color="var(--orange)" />
        <GhlStatCell label="RDV" value={appointments.length.toString()} color="#3B82F6" />
        <GhlStatCell label="Valeur" value={fmtEUR(totalValue)} color="var(--green)" last />
      </div>

      {/* Opportunities */}
      <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 20px' }}>
        <h3 style={{
          fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 12px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span aria-hidden>🎯</span> Opportunités GHL
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            ({opportunities.length})
          </span>
        </h3>
        {opportunities.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Aucune opportunité dans le pipeline GHL pour ce client.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {opportunities.map(opp => {
              const status = opp.prospect_status ? PROSPECT_LABEL[opp.prospect_status] : null;
              return (
                <div key={opp.id} style={{
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--night-mid)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text)' }}>
                      {opp.name || 'Sans nom'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      🏷️ {opp.pipeline_stage_name || 'Stage inconnu'}
                      {opp.ghl_updated_at && ` · MAJ ${new Date(opp.ghl_updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
                    </div>
                  </div>
                  {opp.monetary_value_cents && (
                    <span style={{
                      fontSize: '0.92rem', fontWeight: 800, color: 'var(--green)',
                      fontFamily: "'Bricolage Grotesque', sans-serif",
                    }}>
                      {fmtEUR(opp.monetary_value_cents)}
                    </span>
                  )}
                  {status && (
                    <span style={{
                      fontSize: '0.68rem', padding: '3px 9px', borderRadius: 999, fontWeight: 600,
                      background: status.color + '20', color: status.color,
                      border: `1px solid ${status.color}40`, whiteSpace: 'nowrap',
                    }}>
                      {status.emoji} {status.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Appointments */}
      <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 20px' }}>
        <h3 style={{
          fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 12px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span aria-hidden>📅</span> Rendez-vous GHL
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            ({appointments.length})
          </span>
        </h3>
        {appointments.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Aucun RDV GHL pour ce client.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {appointments.map(a => {
              const meta = KIND_META[a.calendar_kind];
              const isPast = new Date(a.starts_at).getTime() < Date.now();
              const statusBadge = a.status === 'no_show' ? { label: 'No show', color: '#FCA5A5' }
                : a.status === 'cancelled' ? { label: 'Annulé', color: 'var(--text-muted)' }
                : null;
              return (
                <div key={a.id} style={{
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--night-mid)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  opacity: a.status === 'cancelled' || a.status === 'no_show' ? 0.6 : 1,
                }}>
                  <span aria-hidden style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--night-raised)', border: `1.5px solid ${meta.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.95rem',
                  }}>{meta.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>
                      {meta.label}
                      {isPast && a.notes_completed_at && (
                        <span style={{ marginLeft: 8, fontSize: '0.66rem', color: 'var(--green)' }}>✅ documenté</span>
                      )}
                      {isPast && !a.notes_completed_at && !statusBadge && (
                        <span style={{ marginLeft: 8, fontSize: '0.66rem', color: '#D8B4FE' }}>⏳ à documenter</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {fmtDateTime(a.starts_at)}
                    </div>
                    {a.notes && (
                      <div style={{
                        marginTop: 6, padding: '8px 10px', borderRadius: 6,
                        background: 'var(--night-raised)', border: '1px solid var(--border)',
                        fontSize: '0.78rem', color: 'var(--text-mid)', whiteSpace: 'pre-wrap',
                        maxHeight: 80, overflow: 'auto',
                      }}>
                        {a.notes}
                      </div>
                    )}
                  </div>
                  {statusBadge && (
                    <span style={{
                      fontSize: '0.66rem', padding: '3px 9px', borderRadius: 999, fontWeight: 600,
                      background: statusBadge.color + '20', color: statusBadge.color, whiteSpace: 'nowrap',
                    }}>
                      {statusBadge.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function GhlStatCell({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '12px 14px', textAlign: 'center',
      borderRight: last ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500,
        marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.05rem', fontWeight: 700, color,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}
