import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/client-video-feedback
//   Aggrège les retours clients sur les vidéos qui exigent une action :
//     1. clients.video_changes_requested = true → l'admin doit reprendre
//        le montage suite au feedback global du client
//     2. videos.feedback[] avec author='client' et resolved≠true → annotations
//        ponctuelles (frame.io style) qu'il faut résoudre une par une
//   Powers le widget ClientFeedbackAlerts du dashboard. Le but est de mettre
//   ces actions en haut de l'écran, plus visibles que la sonnerie.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const [globalR, videosR] = await Promise.all([
    // Demandes globales : video_changes_requested + statut review
    supaFetch(
      `clients?video_changes_requested=eq.true`
      + `&select=id,business_name,contact_name,video_review_comment,updated_at,delivered_at`
      + `&order=updated_at.desc&limit=50`,
      {}, true,
    ),
    // Annotations frame.io non résolues par l'admin (resolved≠true côté JSONB)
    // Postgres-rest ne sait pas filtrer sur l'intérieur d'un JSONB array, donc
    // on pull tout et on filtre en mémoire (limite à 80 vidéos récentes).
    supaFetch(
      `videos?select=id,client_id,title,feedback,delivered_at,clients(business_name,contact_name)`
      + `&order=updated_at.desc&limit=80`,
      {}, true,
    ),
  ]);

  type GlobalRow = {
    id: string;
    business_name: string | null;
    contact_name: string | null;
    video_review_comment: string | null;
    updated_at: string | null;
    delivered_at: string | null;
  };
  type FbItem = {
    id: string;
    time_seconds: number;
    comment: string;
    author: 'client' | 'admin';
    resolved?: boolean;
    created_at: string;
  };
  type VidRow = {
    id: string;
    client_id: string;
    title: string | null;
    feedback: FbItem[] | null;
    delivered_at: string | null;
    clients: { business_name?: string; contact_name?: string } | null;
  };

  const globals: GlobalRow[] = globalR.ok ? await globalR.json() : [];
  const videos: VidRow[] = videosR.ok ? await videosR.json() : [];

  // Type unifié pour le rendu côté UI : un item = une carte
  type Alert = {
    kind: 'global_changes' | 'annotations';
    client_id: string;
    business_name: string;
    contact_name: string | null;
    timestamp: string;
    href: string;
    // global_changes only
    comment?: string | null;
    // annotations only
    annotations_count?: number;
    annotations_preview?: { time: number; text: string }[];
    video_title?: string | null;
  };

  const alerts: Alert[] = [];

  for (const c of globals) {
    alerts.push({
      kind: 'global_changes',
      client_id: c.id,
      business_name: c.business_name || 'Client',
      contact_name: c.contact_name,
      timestamp: c.updated_at || c.delivered_at || new Date().toISOString(),
      href: `/dashboard/clients/${c.id}?tab=delivery`,
      comment: c.video_review_comment,
    });
  }

  for (const v of videos) {
    const unresolved = (v.feedback || []).filter(f => f.author === 'client' && !f.resolved);
    if (unresolved.length === 0) continue;
    // Skip si on a déjà signalé ce client via global_changes — évite le bruit
    if (alerts.some(a => a.kind === 'global_changes' && a.client_id === v.client_id)) continue;
    const sorted = unresolved.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    alerts.push({
      kind: 'annotations',
      client_id: v.client_id,
      business_name: v.clients?.business_name || 'Client',
      contact_name: v.clients?.contact_name || null,
      timestamp: sorted[0]?.created_at || v.delivered_at || new Date().toISOString(),
      href: `/dashboard/clients/${v.client_id}?tab=delivery`,
      annotations_count: unresolved.length,
      annotations_preview: sorted.slice(0, 3).map(f => ({ time: f.time_seconds, text: f.comment })),
      video_title: v.title,
    });
  }

  alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({ alerts, total: alerts.length });
}
