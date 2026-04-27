import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/clients/timeline?id=<client_uuid>
//   Returns a unified chronological timeline for a client : all events,
//   appointments, payments, scripts, videos, feedback merged in one stream.
//   Powers the 'Conversation' tab on the client detail page.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  // Fetch the client to find linked GHL identifiers
  const cR = await supaFetch(
    `clients?id=eq.${encodeURIComponent(id)}&select=id,email,ghl_contact_id,created_at,paid_at,delivered_at,updated_at`,
    {}, true,
  );
  if (!cR.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const arr = await cR.json();
  const client = arr[0];
  if (!client) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Build "or" filters for cross-table joins
  const oppFilters: string[] = [`client_id.eq.${id}`];
  if (client.ghl_contact_id) oppFilters.push(`ghl_contact_id.eq.${client.ghl_contact_id}`);
  if (client.email) oppFilters.push(`contact_email.ilike.${encodeURIComponent(client.email.toLowerCase().trim())}`);
  const orFilter = `or=(${oppFilters.join(',')})`;

  // Pull everything in parallel
  const [eventsR, appointmentsR, paymentsR, scriptsR, videosR, commentsR] = await Promise.all([
    supaFetch(`client_events?client_id=eq.${id}&select=*&order=created_at.desc&limit=200`, {}, true),
    supaFetch(`gh_appointments?${orFilter}&select=id,calendar_kind,starts_at,status,notes,notes_completed_at,prospect_status,opportunity_name&order=starts_at.desc&limit=50`, {}, true),
    supaFetch(`payments?client_id=eq.${id}&select=*&order=created_at.desc&limit=50`, {}, true),
    supaFetch(`scripts?client_id=eq.${id}&select=id,title,status,version,created_at,updated_at&order=created_at.desc&limit=10`, {}, true),
    supaFetch(`videos?client_id=eq.${id}&select=id,title,status,delivered_at,feedback,created_at,updated_at&order=created_at.desc&limit=20`, {}, true),
    supaFetch(`script_comments?scripts.client_id=eq.${id}&select=id,script_id,content,author_name,author_type,created_at,scripts!inner(client_id)&order=created_at.desc&limit=50`, {}, true),
  ]);

  type TimelineItem = {
    id: string;
    timestamp: string;
    type: string;
    emoji: string;
    color: string;
    title: string;
    description?: string;
    actor?: string;
    href?: string;
  };
  const items: TimelineItem[] = [];

  // Client created
  items.push({
    id: `client-created-${id}`,
    timestamp: client.created_at,
    type: 'client_created',
    emoji: '👋',
    color: 'var(--orange)',
    title: 'Client ajouté',
  });

  // Events from client_events
  if (eventsR.ok) {
    const events: { id: string; type: string; payload: Record<string, unknown> | null; actor: string; created_at: string }[] = await eventsR.json();
    const EVENT_META: Record<string, { emoji: string; color: string; title: string }> = {
      status_changed:           { emoji: '🔄', color: 'var(--text-mid)', title: 'Statut modifié' },
      script_created:           { emoji: '✍️', color: '#FACC15', title: 'Script créé' },
      script_sent_to_client:    { emoji: '📤', color: 'var(--orange)', title: 'Script envoyé au client' },
      script_validated:         { emoji: '✅', color: 'var(--green)', title: 'Script validé par le client' },
      script_changes_requested: { emoji: '✏️', color: '#FACC15', title: 'Modifications demandées' },
      video_delivered:          { emoji: '🎬', color: 'var(--green)', title: 'Vidéo livrée' },
      filming_scheduled:        { emoji: '📅', color: '#3B82F6', title: 'Tournage planifié' },
      payment_received:         { emoji: '💸', color: 'var(--green)', title: 'Paiement reçu' },
      satisfaction_submitted:   { emoji: '⭐', color: '#FACC15', title: 'Avis client reçu' },
      publication_scheduled:    { emoji: '🗓️', color: '#FB923C', title: 'Date de publication choisie' },
    };
    for (const e of events) {
      const meta = EVENT_META[e.type] || { emoji: '•', color: 'var(--text-muted)', title: e.type };
      items.push({
        id: `event-${e.id}`,
        timestamp: e.created_at,
        type: e.type,
        emoji: meta.emoji,
        color: meta.color,
        title: meta.title,
        actor: e.actor,
      });
    }
  }

  // Appointments
  if (appointmentsR.ok) {
    type Appt = { id: string; calendar_kind: string; starts_at: string; status: string; notes: string | null; notes_completed_at: string | null; prospect_status: string | null; opportunity_name: string | null };
    const appts: Appt[] = await appointmentsR.json();
    const KIND: Record<string, { emoji: string; color: string; label: string }> = {
      closing:    { emoji: '📞', color: 'var(--orange)', label: 'Closing' },
      onboarding: { emoji: '🚀', color: '#14B8A6', label: 'Appel onboarding' },
      tournage:   { emoji: '🎬', color: '#3B82F6', label: 'Tournage' },
      other:      { emoji: '📅', color: 'var(--text-mid)', label: 'RDV' },
    };
    for (const a of appts) {
      const meta = KIND[a.calendar_kind] || KIND.other;
      const past = new Date(a.starts_at).getTime() < Date.now();
      const statusLabel = a.status === 'cancelled' ? ' annulé'
        : a.status === 'no_show' ? ' (no show)'
        : past && a.notes_completed_at ? ' ✓ documenté'
        : past ? ' à documenter'
        : ' à venir';
      items.push({
        id: `appt-${a.id}`,
        timestamp: a.starts_at,
        type: 'appointment',
        emoji: meta.emoji,
        color: meta.color,
        title: `${meta.label}${statusLabel}`,
        description: a.notes || undefined,
      });
    }
  }

  // Payments
  if (paymentsR.ok) {
    type Pay = { id: string; amount: number; description: string; status: string; stripe_payment_intent: string | null; created_at: string };
    const pays: Pay[] = await paymentsR.json();
    for (const p of pays) {
      items.push({
        id: `pay-${p.id}`,
        timestamp: p.created_at,
        type: 'payment',
        emoji: '💸',
        color: 'var(--green)',
        title: `Paiement de ${(p.amount / 100).toLocaleString('fr-FR')} €`,
        description: p.description || (p.stripe_payment_intent ? 'Stripe' : 'Manuel'),
      });
    }
  }

  // Scripts
  if (scriptsR.ok) {
    type Sc = { id: string; title: string; status: string; version: number; created_at: string; updated_at: string };
    const scripts: Sc[] = await scriptsR.json();
    for (const s of scripts) {
      items.push({
        id: `script-${s.id}`,
        timestamp: s.updated_at || s.created_at,
        type: 'script',
        emoji: s.status === 'confirmed' ? '✅' : s.status === 'proposition' || s.status === 'modified' ? '📤' : '✍️',
        color: '#FACC15',
        title: `Script v${s.version} — ${s.status}`,
        description: s.title,
      });
    }
  }

  // Videos + their feedback
  if (videosR.ok) {
    type Vid = { id: string; title: string | null; status: string; delivered_at: string | null; feedback: { id: string; time_seconds: number; comment: string; author: string; created_at: string }[] | null; created_at: string };
    const vids: Vid[] = await videosR.json();
    for (const v of vids) {
      if (v.delivered_at) {
        items.push({
          id: `vid-delivered-${v.id}`,
          timestamp: v.delivered_at,
          type: 'video_delivered',
          emoji: '🎬',
          color: 'var(--green)',
          title: 'Vidéo livrée au client',
          description: v.title || undefined,
        });
      }
      if (Array.isArray(v.feedback)) {
        for (const f of v.feedback) {
          const m = Math.floor(f.time_seconds / 60);
          const s = Math.floor(f.time_seconds % 60);
          items.push({
            id: `feedback-${v.id}-${f.id}`,
            timestamp: f.created_at,
            type: 'video_feedback',
            emoji: f.author === 'admin' ? '👤' : '🙋',
            color: f.author === 'admin' ? '#3B82F6' : 'var(--orange)',
            title: `Modif vidéo à ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`,
            description: f.comment,
            actor: f.author,
          });
        }
      }
    }
  }

  // Script comments (annotations)
  if (commentsR.ok) {
    type Cm = { id: string; content: string; author_name: string; author_type: string; created_at: string };
    const comments: Cm[] = await commentsR.json();
    for (const c of comments) {
      items.push({
        id: `comment-${c.id}`,
        timestamp: c.created_at,
        type: 'comment',
        emoji: c.author_type === 'admin' ? '💬' : '🗨️',
        color: c.author_type === 'admin' ? '#3B82F6' : 'var(--orange)',
        title: `Commentaire script (${c.author_name})`,
        description: c.content,
        actor: c.author_type,
      });
    }
  }

  // Sort all items by timestamp desc
  items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  return NextResponse.json({ items });
}
