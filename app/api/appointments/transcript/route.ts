import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { draftCallDocFromTranscript } from '@/lib/ai-copilot';
import { sendPushToAll } from '@/lib/push';

// POST /api/appointments/transcript
//
// Ingestion d'un transcript d'appel — canal-agnostique. Trois sources visées :
//   1. Collage manuel depuis le widget admin (auth : Bearer token).
//   2. Webhook externe (Plaud → Zapier "transcript_ready", n8n…) :
//      POST .../transcript?secret=<PLAUD_WEBHOOK_SECRET>
//   3. Pull OAuth Plaud côté cron (plus tard) — même endpoint.
//
// Body : {
//   appointment_id?: string,            // cible directe (collage in-app)
//   transcript?: string,                // requis sauf redraft
//   source?: string,                    // 'plaud' | 'paste' | 'zapier' | 'api'
//   external_id?: string,               // id enregistrement Plaud → idempotence
//   recorded_at?: string,               // ISO, pour matcher le bon RDV
//   redraft?: boolean,                  // re-générer le brouillon depuis le transcript stocké
//   contact?: { ghl_contact_id?, email?, phone?, name? }  // matching si pas d'appointment_id
// }
//
// On stocke le transcript sur le gh_appointment puis Claude pré-rédige des
// notes structurées + un statut suggéré (colonnes ai_*). On n'écrase JAMAIS
// `notes` — le brouillon reste une proposition que Siméon accepte au save.

interface ContactHint {
  ghl_contact_id?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

interface ApptRow {
  id: string;
  ghl_contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  calendar_kind: string;
  starts_at: string;
  notes_completed_at: string | null;
  opportunity_name: string | null;
  transcript: string | null;
  transcript_external_id: string | null;
}

const SELECT = 'id,ghl_contact_id,contact_name,contact_email,contact_phone,calendar_kind,'
  + 'starts_at,notes_completed_at,opportunity_name,transcript,transcript_external_id';

async function fetchAppt(filter: string): Promise<ApptRow[]> {
  const r = await supaFetch(`gh_appointments?${filter}&select=${SELECT}`, {}, true);
  if (!r.ok) return [];
  return r.json();
}

// Matche un transcript à un RDV à partir des indices contact + l'heure
// d'enregistrement. Cascade ghl_contact_id → email → phone, puis on garde le
// RDV le plus proche dans le temps (fenêtre 24h si recorded_at fourni), en
// privilégiant les appels closing pas encore documentés.
async function matchAppointment(contact: ContactHint, recordedAtMs: number | null): Promise<ApptRow | null> {
  const candidates = new Map<string, ApptRow>();
  const add = (rows: ApptRow[]) => rows.forEach(r => { if (!candidates.has(r.id)) candidates.set(r.id, r); });

  if (contact.ghl_contact_id) {
    add(await fetchAppt(`ghl_contact_id=eq.${encodeURIComponent(contact.ghl_contact_id)}&order=starts_at.desc&limit=10`));
  }
  if (contact.email) {
    add(await fetchAppt(`contact_email=ilike.${encodeURIComponent(contact.email.trim())}&order=starts_at.desc&limit=10`));
  }
  if (contact.phone) {
    const digits = contact.phone.replace(/\D/g, '');
    if (digits.length >= 6) {
      add(await fetchAppt(`contact_phone=ilike.%25${digits.slice(-9)}%25&order=starts_at.desc&limit=10`));
    }
  }
  const list = [...candidates.values()];
  if (list.length === 0) return null;

  const score = (a: ApptRow) => {
    let s = 0;
    if (!a.notes_completed_at) s += 100;          // pas encore documenté → prioritaire
    if (a.calendar_kind === 'closing') s += 10;   // un transcript d'appel = surtout du closing
    if (recordedAtMs) {
      const diffH = Math.abs(new Date(a.starts_at).getTime() - recordedAtMs) / 3_600_000;
      if (diffH > 24) return -1;                  // hors fenêtre → exclu
      s += Math.max(0, 24 - diffH);               // plus c'est proche, mieux c'est
    }
    return s;
  };

  let best: ApptRow | null = null;
  let bestScore = -Infinity;
  for (const a of list) {
    const s = score(a);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return bestScore < 0 ? null : best;
}

export async function POST(req: NextRequest) {
  // Auth : Bearer admin (collage in-app) OU secret partagé (webhook externe).
  const secret = req.nextUrl.searchParams.get('secret') || '';
  const expectedSecret = process.env.PLAUD_WEBHOOK_SECRET || '';
  const authed = requireAuth(req) || (!!expectedSecret && secret === expectedSecret);
  if (!authed) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let body: {
    appointment_id?: string;
    transcript?: string;
    source?: string;
    external_id?: string;
    recorded_at?: string;
    redraft?: boolean;
    contact?: ContactHint;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const source = (body.source || 'api').slice(0, 40);
  const externalId = body.external_id?.trim() || null;
  const recordedAtMs = body.recorded_at ? new Date(body.recorded_at).getTime() : null;

  // Idempotence : un même enregistrement source (external_id) ne re-déclenche
  // pas une ingestion (retry Zapier, double-fire). On renvoie l'existant.
  if (externalId && !body.redraft) {
    const existing = await fetchAppt(`transcript_external_id=eq.${encodeURIComponent(externalId)}&limit=1`);
    if (existing[0]) {
      return NextResponse.json({ appointment_id: existing[0].id, status: 'already_ingested' });
    }
  }

  // 1. Résoudre le RDV cible.
  let appt: ApptRow | null = null;
  if (body.appointment_id) {
    appt = (await fetchAppt(`id=eq.${encodeURIComponent(body.appointment_id)}&limit=1`))[0] || null;
  } else if (body.contact) {
    appt = await matchAppointment(body.contact, Number.isNaN(recordedAtMs) ? null : recordedAtMs);
  }
  if (!appt) {
    return NextResponse.json({ error: 'aucun rendez-vous correspondant', matched: false }, { status: 404 });
  }

  // 2. Texte du transcript : fourni, ou re-draft depuis le stocké.
  const transcript = (body.transcript ?? '').trim() || (body.redraft ? (appt.transcript || '') : '');
  if (!transcript) {
    return NextResponse.json({ error: 'transcript requis' }, { status: 400 });
  }

  // 3. Stocker le transcript (sauf redraft pur qui réutilise l'existant).
  if (!body.redraft || body.transcript) {
    await supaFetch(`gh_appointments?id=eq.${appt.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        transcript,
        transcript_source: source,
        transcript_external_id: externalId,
        transcript_received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }, true);
  }

  // 4. Auto-draft Claude (best-effort : si l'IA échoue, le transcript reste
  //    stocké et consultable, Siméon peut documenter à la main).
  let draft: Awaited<ReturnType<typeof draftCallDocFromTranscript>> | null = null;
  try {
    draft = await draftCallDocFromTranscript({
      transcript,
      contact_name: appt.contact_name,
      business_name: appt.opportunity_name,
      appointment_kind: appt.calendar_kind,
    });
    await supaFetch(`gh_appointments?id=eq.${appt.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ai_draft: draft.notes,
        ai_suggested_status: draft.suggested_status,
        ai_drafted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }, true);
  } catch { /* l'IA peut échouer (quota, transcript exotique) — non bloquant */ }

  // 5. Push admin best-effort — surtout utile sur le canal webhook où personne
  //    ne regarde l'app au moment où le transcript tombe.
  const who = appt.opportunity_name || appt.contact_name || 'Prospect';
  void sendPushToAll({
    title: draft ? '✨ Brouillon d\'appel prêt' : '🎙️ Transcript reçu',
    body: draft
      ? `${who} — notes pré-rédigées, à relire et valider.`
      : `${who} — transcript reçu, à documenter.`,
    url: '/dashboard',
    tag: `transcript-${appt.id}`,
  }).catch(() => null);

  return NextResponse.json({
    matched: true,
    appointment_id: appt.id,
    drafted: !!draft,
    draft_notes: draft?.notes ?? null,
    suggested_status: draft?.suggested_status ?? null,
    status_reason: draft?.status_reason ?? null,
  });
}
