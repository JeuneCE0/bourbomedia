import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { pushNotesToGhl } from '@/lib/ghl-appointments';

// POST /api/gh-appointments/push-notes-to-ghl?since=YYYY-MM-DD
//
// Re-push vers GHL toutes les notes de RDV documentées localement sur la
// période demandée (default = aujourd'hui). Sert de rattrapage après la
// fix du bug pushNotesToGhl (PUT /contacts/{id} avec champ "notes"
// inexistant → les notes documentées sur l'admin ne montaient jamais
// sur les fiches prospects GHL).
//
// Idempotence : chaque save crée une nouvelle note datée côté GHL
// (préfixe "[Bourbomedia · timestamp]"). Re-exécuter sur la même
// période crée des doublons → l'admin doit doser. Par défaut limité à
// la journée d'aujourd'hui pour le rattrapage immédiat.
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const sinceParam = req.nextUrl.searchParams.get('since');
  const sinceIso = sinceParam
    ? new Date(sinceParam + 'T00:00:00Z').toISOString()
    : (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
      })();

  const r = await supaFetch(
    `gh_appointments?notes_completed_at=gte.${encodeURIComponent(sinceIso)}`
    + `&notes=not.is.null`
    + `&ghl_contact_id=not.is.null`
    + `&select=id,ghl_contact_id,notes,prospect_status,notes_completed_at,contact_name`
    + `&order=notes_completed_at.desc&limit=200`,
    {}, true,
  );
  if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });

  type Row = {
    id: string;
    ghl_contact_id: string;
    notes: string;
    prospect_status: string | null;
    notes_completed_at: string;
    contact_name: string | null;
  };
  const rows: Row[] = await r.json();

  let pushed = 0;
  let skipped = 0;
  const issues: string[] = [];

  for (const a of rows) {
    // Skip les notes auto-importées depuis GHL (préfixées "[Note GHL · …]")
    // — ce sont des notes qui viennent déjà de GHL, pas la peine de les
    // re-créer là-bas.
    if (a.notes.startsWith('[Note GHL')) {
      skipped++;
      continue;
    }
    try {
      const ok = await pushNotesToGhl(a.ghl_contact_id, a.notes, a.prospect_status);
      if (ok) {
        pushed++;
        // Marque comme synchro pour cohérence du UI
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ghl_synced_at: new Date().toISOString() }),
        }, true).catch(() => null);
      } else {
        skipped++;
        issues.push(`${a.contact_name || a.id} : push GHL refusé (env ou autom paused)`);
      }
    } catch (e: unknown) {
      skipped++;
      issues.push(`${a.contact_name || a.id} : ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    pushed,
    skipped,
    since: sinceIso,
    message: `${pushed} note${pushed > 1 ? 's' : ''} poussée${pushed > 1 ? 's' : ''} vers GHL.`,
    issues,
  });
}
