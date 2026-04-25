import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { pushNotesToGhl } from '@/lib/ghl-appointments';

// GET /api/gh-appointments?pending=1     → appointments completed but not yet documented
// GET /api/gh-appointments?recent=1      → last ~30 appointments (for the admin history view)
// GET /api/gh-appointments?id=<uuid>     → single appointment
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const id = url.searchParams.get('id');
  const pending = url.searchParams.get('pending');
  const recent = url.searchParams.get('recent');

  let path: string;
  if (id) {
    path = `gh_appointments?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  } else if (pending) {
    path = `gh_appointments?status=eq.completed&notes_completed_at=is.null&select=*&order=starts_at.desc&limit=50`;
  } else if (recent) {
    path = `gh_appointments?select=*&order=starts_at.desc&limit=30`;
  } else {
    path = `gh_appointments?select=*&order=starts_at.desc&limit=30`;
  }

  const r = await supaFetch(path, {}, true);
  if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  const rows = await r.json();
  return NextResponse.json({ appointments: rows });
}

// PATCH /api/gh-appointments  body: { id, notes?, prospect_status?, client_id? }
// Updates the row, marks notes_completed_at, and pushes back to GHL.
export async function PATCH(req: NextRequest) {
  let body: { id?: string; notes?: string; prospect_status?: string | null; client_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const id = body.id;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.notes !== undefined) {
    patch.notes = body.notes;
    patch.notes_completed_at = body.notes ? new Date().toISOString() : null;
  }
  if (body.prospect_status !== undefined) patch.prospect_status = body.prospect_status;
  if (body.client_id !== undefined) patch.client_id = body.client_id;

  const r = await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }, true);

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return NextResponse.json({ error: 'update failed', detail: txt }, { status: 500 });
  }
  const rows = await r.json();
  const row = rows[0];

  // Sync back to GHL contact (best effort)
  if (row?.ghl_contact_id && (body.notes !== undefined || body.prospect_status !== undefined)) {
    try {
      const ok = await pushNotesToGhl(row.ghl_contact_id, body.notes || row.notes || '', body.prospect_status ?? row.prospect_status);
      if (ok) {
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ghl_synced_at: new Date().toISOString() }),
        }, true);
      }
    } catch { /* tolerate */ }
  }

  return NextResponse.json({ appointment: row });
}
