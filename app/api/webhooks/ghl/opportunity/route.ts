import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { resolveMapping, stageIdToProspectStatus } from '@/lib/ghl-opportunities';
import { matchClientFromContact } from '@/lib/ghl-appointments';

// GHL workflow trigger "Opportunity Stage Changed" → POSTs here.
// Configure the workflow webhook with the same secret as the appointment one:
//   POST https://<host>/api/webhooks/ghl/opportunity?secret=<GHL_WEBHOOK_SECRET>
//
// Expected payload (tolerates flat or nested):
//   { opportunity: { id, name, pipelineId, pipelineStageId, contactId, status }, contact: { ... } }

type GhlOppPayload = {
  opportunity?: Record<string, unknown>;
  contact?: Record<string, unknown>;
} & Record<string, unknown>;

function pick<T = string>(obj: Record<string, unknown> | undefined, ...keys: string[]): T | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || '';
  const expected = process.env.GHL_WEBHOOK_SECRET || '';
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: GhlOppPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const opp = (payload.opportunity as Record<string, unknown>) || payload;
  const opportunityId = pick<string>(opp, 'id', 'opportunityId', '_id');
  const pipelineId = pick<string>(opp, 'pipelineId', 'pipeline_id') || '';
  const pipelineStageId = pick<string>(opp, 'pipelineStageId', 'pipeline_stage_id') || '';
  const opportunityName = pick<string>(opp, 'name', 'opportunityName') || null;
  const contactId = pick<string>(opp, 'contactId', 'contact_id')
    || pick<string>((payload.contact as Record<string, unknown>) || {}, 'id', '_id');

  if (!opportunityId) {
    return NextResponse.json({ error: 'missing opportunity id' }, { status: 400 });
  }

  const { mapping, pipeline } = await resolveMapping();
  const prospect_status = pipelineStageId ? stageIdToProspectStatus(mapping, pipelineStageId) : null;
  const stageName = pipeline?.stages.find(s => s.id === pipelineStageId)?.name || null;

  // Pull contact info if available (GHL doesn't always inline it)
  const contact = (payload.contact as Record<string, unknown>) || {};
  const contactEmail = pick<string>(contact, 'email');
  const contactPhone = pick<string>(contact, 'phone');
  const contactNameRaw = pick<string>(contact, 'name', 'fullName', 'contactName');
  const firstName = pick<string>(contact, 'firstName', 'first_name');
  const lastName = pick<string>(contact, 'lastName', 'last_name');
  const contactName = contactNameRaw || [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  const monetaryValueRaw = pick<number | string>(opp, 'monetaryValue', 'monetary_value');
  const monetaryValue = typeof monetaryValueRaw === 'string' ? parseFloat(monetaryValueRaw) : monetaryValueRaw;
  const ghlCreatedAt = pick<string>(opp, 'createdAt', 'created_at', 'dateAdded');
  const ghlUpdatedAt = pick<string>(opp, 'updatedAt', 'updated_at', 'dateUpdated');

  // Resolve the linked Bourbomedia client (best effort, by ghl_contact_id /
  // email / phone / name). Lets the fiche client surface the opportunity.
  const clientId = await matchClientFromContact({
    ghl_contact_id: contactId || null,
    email: contactEmail || null,
    phone: contactPhone || null,
    first_name: firstName || null,
    last_name: lastName || null,
  });

  // Mirror to gh_opportunities (best effort — primary use is funnel metrics)
  try {
    const oppRow: Record<string, unknown> = {
      ghl_opportunity_id: opportunityId,
      ghl_contact_id: contactId || null,
      pipeline_id: pipelineId,
      pipeline_stage_id: pipelineStageId,
      pipeline_stage_name: stageName,
      name: opportunityName,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      contact_name: contactName,
      client_id: clientId,
      monetary_value_cents: monetaryValue ? Math.round(monetaryValue * 100) : null,
      prospect_status,
      ghl_created_at: ghlCreatedAt ? new Date(ghlCreatedAt).toISOString() : null,
      ghl_updated_at: ghlUpdatedAt ? new Date(ghlUpdatedAt).toISOString() : null,
      raw_payload: payload as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };
    await supaFetch('gh_opportunities?on_conflict=ghl_opportunity_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(oppRow),
    }, true);
  } catch { /* tolerate */ }

  // Update every gh_appointments row tied to this opportunity. If we don't have
  // the opportunity_id stored yet, fall back to ghl_contact_id (closing kind only).
  const patch: Record<string, unknown> = {
    pipeline_id: pipelineId || null,
    pipeline_stage_id: pipelineStageId || null,
    pipeline_stage_name: stageName,
    opportunity_name: opportunityName,
    updated_at: new Date().toISOString(),
  };
  if (prospect_status) patch.prospect_status = prospect_status;

  // Try by opportunity_id first
  let updated = 0;
  const byOppRes = await supaFetch(
    `gh_appointments?opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=id`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    true,
  );
  if (byOppRes.ok) {
    const rows = await byOppRes.json().catch(() => []);
    updated = rows.length || 0;
  }

  // If nothing was matched and we have a contactId, link the opportunity to
  // the most recent closing appointment for that contact.
  if (updated === 0 && contactId) {
    const lookup = await supaFetch(
      `gh_appointments?ghl_contact_id=eq.${encodeURIComponent(contactId)}`
      + `&calendar_kind=eq.closing`
      + `&select=id&order=starts_at.desc&limit=1`,
      {}, true,
    );
    if (lookup.ok) {
      const arr = await lookup.json();
      if (arr[0]?.id) {
        const linkPatch = { ...patch, opportunity_id: opportunityId };
        await supaFetch(`gh_appointments?id=eq.${encodeURIComponent(arr[0].id)}`, {
          method: 'PATCH',
          body: JSON.stringify(linkPatch),
        }, true);
        updated = 1;
      }
    }
  }

  return NextResponse.json({ ok: true, opportunityId, prospect_status, stageName, updated });
}
