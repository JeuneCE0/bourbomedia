import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';
import { ghlRequest } from '@/lib/ghl';

// POST /api/gh-appointments/resync-notes
//   Pour chaque gh_appointment dont les notes sont le placeholder
//   '✓ Documenté côté GHL (sync auto)' ou null avec notes_completed_at set,
//   on re-fetch les notes du contact GHL et on remplace par le vrai contenu.
//   Limite 50 par appel pour ne pas spammer GHL.
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const r = await supaFetch(
    `gh_appointments?or=(notes.like.*Document%C3%A9*GHL*,notes.is.null)`
    + `&notes_completed_at=not.is.null&ghl_contact_id=not.is.null`
    + `&select=id,starts_at,ghl_contact_id,notes_completed_at,notes&limit=50`,
    {}, true,
  );
  if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  type Row = { id: string; starts_at: string; ghl_contact_id: string; notes_completed_at: string | null; notes: string | null };
  const rows: Row[] = await r.json();

  let updated = 0;
  let skipped = 0;

  type GhlNote = { body?: string; dateAdded?: string; createdAt?: string };
  for (const a of rows) {
    try {
      const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(a.ghl_contact_id)}/notes`);
      const notes: GhlNote[] = data?.notes || [];
      const start = new Date(a.starts_at).getTime();
      const candidates = notes
        .map(n => ({ body: (n.body || '').trim(), ts: n.dateAdded || n.createdAt || '' }))
        .filter(n => n.body && !Number.isNaN(new Date(n.ts).getTime()) && new Date(n.ts).getTime() >= start)
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      if (candidates.length === 0) { skipped++; continue; }
      const top = candidates[0];
      // Skip si la note locale match déjà le body
      if (a.notes && a.notes.includes(top.body)) { skipped++; continue; }

      const stamp = new Date(top.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const noteBody = `[Note GHL · ${stamp}]\n${top.body}`;
      await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          notes: noteBody,
          notes_completed_at: top.ts,
          ghl_synced_at: new Date().toISOString(),
        }),
      }, true);
      updated++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({
    scanned: rows.length,
    updated,
    skipped,
    message: `${updated} note${updated > 1 ? 's' : ''} récupérée${updated > 1 ? 's' : ''} depuis GHL, ${skipped} sans changement.`,
  });
}
