import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/inbox
//   Returns all "things needing action" for the admin in one payload :
//     - scripts à valider (status proposition/modified)
//     - feedbacks vidéo client non-résolus
//     - RDV passés sans notes_completed_at
//     - paiements en attente (clients statut publié sans paiement)
//     - tâches manuelles dues
//   Powers the unified Inbox page so the admin sees every action item without
//   hunting through tabs.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const nowIso = new Date().toISOString();

  const [scriptsR, videosR, apptsR, clientsR, tasksR] = await Promise.all([
    // Scripts en attente de validation client
    supaFetch(
      `scripts?status=in.(proposition,modified)&select=id,client_id,title,version,status,updated_at,clients(business_name)&order=updated_at.desc&limit=50`,
      {}, true,
    ),
    // Vidéos avec feedback client non-résolu (filtrage en mémoire car JSONB)
    supaFetch(
      `videos?select=id,client_id,title,status,feedback,delivered_at,clients(business_name)&order=updated_at.desc&limit=80`,
      {}, true,
    ),
    // RDV passés non documentés (notes_completed_at IS NULL)
    supaFetch(
      `gh_appointments?starts_at=lt.${encodeURIComponent(nowIso)}&notes_completed_at=is.null&status=neq.cancelled&select=id,client_id,calendar_kind,starts_at,contact_name,contact_email,opportunity_name&order=starts_at.desc&limit=30`,
      {}, true,
    ),
    // Clients livrés mais sans paiement enregistré (priorité commerciale)
    supaFetch(
      `clients?status=eq.published&payment_amount=is.null&select=id,business_name,contact_name,delivered_at&order=delivered_at.desc.nullslast&limit=20`,
      {}, true,
    ),
    // Tâches stockées dans clients.todos (JSONB) — on filtre en mémoire
    supaFetch(
      `clients?todos=not.eq.[]&select=id,business_name,todos&limit=200`,
      {}, true,
    ),
  ]);

  type Item = {
    id: string;
    kind: 'script' | 'video_feedback' | 'appointment' | 'payment' | 'task';
    client_id: string | null;
    client_name: string | null;
    title: string;
    description?: string;
    timestamp: string;
    href: string;
    priority: 'high' | 'normal';
  };
  const items: Item[] = [];

  if (scriptsR.ok) {
    type Sc = { id: string; client_id: string; title: string; version: number; status: string; updated_at: string; clients: { business_name: string } | null };
    const scripts: Sc[] = await scriptsR.json();
    for (const s of scripts) {
      items.push({
        id: `script-${s.id}`,
        kind: 'script',
        client_id: s.client_id,
        client_name: s.clients?.business_name || null,
        title: `Script v${s.version} en relecture client`,
        description: s.title,
        timestamp: s.updated_at,
        href: `/dashboard/clients/${s.client_id}?tab=script`,
        priority: 'normal',
      });
    }
  }

  if (videosR.ok) {
    type Fb = { id: string; comment: string; author: 'client' | 'admin'; resolved?: boolean; time_seconds: number; created_at: string };
    type Vid = { id: string; client_id: string; title: string | null; feedback: Fb[] | null; clients: { business_name: string } | null };
    const vids: Vid[] = await videosR.json();
    for (const v of vids) {
      const unresolved = (v.feedback || []).filter(f => f.author === 'client' && !f.resolved);
      if (unresolved.length === 0) continue;
      items.push({
        id: `video-${v.id}`,
        kind: 'video_feedback',
        client_id: v.client_id,
        client_name: v.clients?.business_name || null,
        title: `${unresolved.length} retour${unresolved.length > 1 ? 's' : ''} vidéo à traiter`,
        description: v.title || undefined,
        timestamp: unresolved[0]?.created_at || new Date().toISOString(),
        href: `/dashboard/clients/${v.client_id}?tab=delivery`,
        priority: unresolved.length >= 3 ? 'high' : 'normal',
      });
    }
  }

  if (apptsR.ok) {
    type Ap = { id: string; client_id: string | null; calendar_kind: string; starts_at: string; contact_name: string | null; contact_email: string | null; opportunity_name: string | null };
    const appts: Ap[] = await apptsR.json();
    const KIND_LABEL: Record<string, string> = { closing: 'Closing', onboarding: 'Onboarding', tournage: 'Tournage', other: 'RDV' };
    for (const a of appts) {
      const ageHours = (Date.now() - new Date(a.starts_at).getTime()) / 3600000;
      items.push({
        id: `appt-${a.id}`,
        kind: 'appointment',
        client_id: a.client_id,
        client_name: a.contact_name || a.opportunity_name || a.contact_email || null,
        title: `${KIND_LABEL[a.calendar_kind] || 'RDV'} à documenter`,
        description: a.opportunity_name || undefined,
        timestamp: a.starts_at,
        href: a.client_id ? `/dashboard/clients/${a.client_id}?tab=ghl` : '/dashboard/calendar',
        priority: ageHours > 48 ? 'high' : 'normal',
      });
    }
  }

  if (clientsR.ok) {
    type Cl = { id: string; business_name: string; contact_name: string; delivered_at: string | null };
    const cls: Cl[] = await clientsR.json();
    for (const c of cls) {
      items.push({
        id: `pay-${c.id}`,
        kind: 'payment',
        client_id: c.id,
        client_name: c.business_name,
        title: 'Paiement non enregistré',
        description: c.contact_name,
        timestamp: c.delivered_at || new Date().toISOString(),
        href: `/dashboard/clients/${c.id}?tab=payments`,
        priority: 'high',
      });
    }
  }

  if (tasksR.ok) {
    type Td = { id: string; text: string; done?: boolean; due_date?: string; priority?: 'low' | 'medium' | 'high' };
    type ClientTodos = { id: string; business_name: string; todos: Td[] | null };
    const cls: ClientTodos[] = await tasksR.json();
    for (const c of cls) {
      const todos = Array.isArray(c.todos) ? c.todos : [];
      for (const t of todos) {
        if (!t || t.done || !t.due_date) continue;
        const dueMs = new Date(t.due_date).getTime();
        const overdue = !Number.isNaN(dueMs) && dueMs < Date.now();
        items.push({
          id: `task-${c.id}-${t.id}`,
          kind: 'task',
          client_id: c.id,
          client_name: c.business_name,
          title: t.text,
          description: overdue
            ? `En retard depuis le ${new Date(t.due_date).toLocaleDateString('fr-FR')}`
            : `Échéance ${new Date(t.due_date).toLocaleDateString('fr-FR')}`,
          timestamp: t.due_date,
          href: `/dashboard/clients/${c.id}`,
          priority: overdue || t.priority === 'high' ? 'high' : 'normal',
        });
      }
    }
  }

  // Sort : high priority first, then most recent timestamp
  items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  const counts = {
    total: items.length,
    high: items.filter(i => i.priority === 'high').length,
    by_kind: {
      script: items.filter(i => i.kind === 'script').length,
      video_feedback: items.filter(i => i.kind === 'video_feedback').length,
      appointment: items.filter(i => i.kind === 'appointment').length,
      payment: items.filter(i => i.kind === 'payment').length,
      task: items.filter(i => i.kind === 'task').length,
    },
  };

  return NextResponse.json({ items, counts });
}
