import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { pushNotesToGhl } from '@/lib/ghl-appointments';
import { resolveMapping, prospectStatusToStageId, updateOpportunityStage } from '@/lib/ghl-opportunities';

// GET /api/gh-appointments?pending=1            → completed appointments awaiting notes
// GET /api/gh-appointments?follow_up=1          → reflection (J+2) / follow_up (J+7) due today
// GET /api/gh-appointments?recent=1             → last ~500 appointments (calendar / pipeline)
// GET /api/gh-appointments?from=YYYY-MM-DD&to=  → date range on starts_at (for calendar month)
// GET /api/gh-appointments?today=1              → today's appointments only
// GET /api/gh-appointments?id=<uuid>            → single appointment
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const id = url.searchParams.get('id');
  const pending = url.searchParams.get('pending');
  const recent = url.searchParams.get('recent');
  const followUp = url.searchParams.get('follow_up');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const today = url.searchParams.get('today');

  let path: string;
  if (id) {
    path = `gh_appointments?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  } else if (today) {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);   dayEnd.setHours(23, 59, 59, 999);
    path = `gh_appointments?starts_at=gte.${encodeURIComponent(dayStart.toISOString())}`
      + `&starts_at=lte.${encodeURIComponent(dayEnd.toISOString())}`
      + `&select=*&order=starts_at.asc&limit=200`;
  } else if (from && to) {
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999`).toISOString();
    path = `gh_appointments?starts_at=gte.${encodeURIComponent(fromIso)}`
      + `&starts_at=lte.${encodeURIComponent(toIso)}`
      + `&select=*&order=starts_at.asc&limit=2000`;
  } else if (pending) {
    // GHL flow: appointments are auto-confirmed on booking and stay 'scheduled' by
    // default. Only "No Show" or "Cancelled" are explicit negative signals — anything
    // else past its starts_at is treated as a call that happened and needs documenting.
    const nowIso = new Date().toISOString();
    path = `gh_appointments?starts_at=lt.${encodeURIComponent(nowIso)}`
      + `&notes_completed_at=is.null`
      + `&status=in.(scheduled,completed)`
      + `&select=*&order=starts_at.desc&limit=50`;
  } else if (followUp) {
    // Reflection (J+2) and follow_up (J+7) prospects whose relance window has been reached.
    // We pull both statuses and let the API filter by elapsed days vs target.
    const r = await supaFetch(
      `gh_appointments?prospect_status=in.(reflection,follow_up)`
      + `&notes_completed_at=not.is.null`
      + `&select=*&order=notes_completed_at.asc&limit=50`,
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
    const all = await r.json();
    const now = Date.now();
    const TARGET: Record<string, number> = { reflection: 2, follow_up: 7 };
    const due = all.filter((a: { prospect_status: string; notes_completed_at: string }) => {
      const target = TARGET[a.prospect_status] || 0;
      const elapsed = Math.floor((now - new Date(a.notes_completed_at).getTime()) / 86400000);
      return elapsed >= target;
    });
    return NextResponse.json({ appointments: due });
  } else if (recent) {
    path = `gh_appointments?select=*&order=starts_at.desc&limit=500`;
  } else {
    path = `gh_appointments?select=*&order=starts_at.desc&limit=500`;
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
  let synced = false;
  if (row?.ghl_contact_id && (body.notes !== undefined || body.prospect_status !== undefined)) {
    try {
      synced = await pushNotesToGhl(row.ghl_contact_id, body.notes || row.notes || '', body.prospect_status ?? row.prospect_status);
    } catch { /* tolerate */ }
  }

  // Push the prospect_status to the GHL opportunity stage (bidirectional pipeline sync)
  if (row?.opportunity_id && body.prospect_status !== undefined && body.prospect_status) {
    try {
      const { mapping } = await resolveMapping();
      const target = prospectStatusToStageId(mapping, body.prospect_status);
      if (target.pipelineId && target.stageId) {
        const ok = await updateOpportunityStage(row.opportunity_id, target.pipelineId, target.stageId);
        if (ok) synced = true;
      }
    } catch { /* tolerate */ }
  }

  if (synced) {
    await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ghl_synced_at: new Date().toISOString() }),
    }, true);
  }

  return NextResponse.json({ appointment: row });
}
