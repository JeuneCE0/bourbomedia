import { ghlRequest } from '@/lib/ghl';
import { getSetting, type GhlPipelineMapping } from '@/lib/app-settings';

const LOCATION_ID = process.env.GHL_LOCATION_ID || '';

export interface GhlPipelineStage {
  id: string;
  name: string;
}
export interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
}

export interface GhlOpportunityLite {
  id: string;
  name: string;
  contactId: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Cache pipelines for the duration of a request
let _cachedPipelines: GhlPipeline[] | null = null;

export async function listPipelines(): Promise<GhlPipeline[]> {
  if (_cachedPipelines) return _cachedPipelines;
  if (!LOCATION_ID) return [];
  try {
    const data = await ghlRequest('GET', `/opportunities/pipelines?locationId=${LOCATION_ID}`);
    const pipelines: GhlPipeline[] = (data?.pipelines || []).map((p: { id: string; name: string; stages?: { id: string; name: string }[] }) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages || []).map(s => ({ id: s.id, name: s.name })),
    }));
    _cachedPipelines = pipelines;
    return pipelines;
  } catch {
    return [];
  }
}

// Normalize for fuzzy match: lowercase + strip diacritics + collapse spaces
function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function findBourbonPipeline(): Promise<GhlPipeline | null> {
  const mapping = await getSetting('ghl_pipeline_mapping');
  const targetName = norm(mapping?.pipeline_name || 'Pipeline Bourbon Media');
  const pipelines = await listPipelines();
  return pipelines.find(p => norm(p.name) === targetName) || null;
}

export async function listOpportunitiesByContact(contactId: string): Promise<GhlOpportunityLite[]> {
  if (!LOCATION_ID || !contactId) return [];
  try {
    const data = await ghlRequest('GET', `/opportunities/search?location_id=${LOCATION_ID}&contact_id=${encodeURIComponent(contactId)}&limit=10`);
    return (data?.opportunities || []).map((o: Record<string, unknown>) => ({
      id: (o.id || o._id) as string,
      name: (o.name || '') as string,
      contactId: (o.contactId || (o.contact as { id?: string })?.id || contactId) as string,
      pipelineId: (o.pipelineId || '') as string,
      pipelineStageId: (o.pipelineStageId || '') as string,
      status: (o.status || '') as string,
      monetaryValue: o.monetaryValue as number | undefined,
      createdAt: o.createdAt as string | undefined,
      updatedAt: o.updatedAt as string | undefined,
    }));
  } catch {
    return [];
  }
}

export async function listOpportunitiesByPipeline(pipelineId: string, since?: string): Promise<GhlOpportunityLite[]> {
  if (!LOCATION_ID || !pipelineId) return [];
  try {
    const params = new URLSearchParams({
      location_id: LOCATION_ID,
      pipeline_id: pipelineId,
      limit: '100',
    });
    if (since) params.set('date', since);
    const data = await ghlRequest('GET', `/opportunities/search?${params.toString()}`);
    return (data?.opportunities || []).map((o: Record<string, unknown>) => ({
      id: (o.id || o._id) as string,
      name: (o.name || '') as string,
      contactId: (o.contactId || (o.contact as { id?: string })?.id || '') as string,
      pipelineId: (o.pipelineId || pipelineId) as string,
      pipelineStageId: (o.pipelineStageId || '') as string,
      status: (o.status || '') as string,
      monetaryValue: o.monetaryValue as number | undefined,
      createdAt: o.createdAt as string | undefined,
      updatedAt: o.updatedAt as string | undefined,
    }));
  } catch {
    return [];
  }
}

export async function updateOpportunityStage(opportunityId: string, pipelineId: string, pipelineStageId: string): Promise<boolean> {
  if (process.env.AUTOMATIONS_PAUSED === 'true') return false;
  if (!opportunityId || !pipelineId || !pipelineStageId) return false;
  try {
    await ghlRequest('PUT', `/opportunities/${opportunityId}`, {
      pipelineId,
      pipelineStageId,
    });
    return true;
  } catch {
    return false;
  }
}

// Resolve {pipeline_name → pipeline_id} and {stage_name → stage_id} from live GHL data.
// Returns the augmented mapping (with stage_ids filled in) ready to compare against ours.
export async function resolveMapping(): Promise<{ mapping: GhlPipelineMapping; pipeline: GhlPipeline | null }> {
  const mapping = await getSetting('ghl_pipeline_mapping');
  const pipeline = await findBourbonPipeline();
  if (!pipeline) return { mapping, pipeline: null };
  const stage_ids: Record<string, string> = {};
  for (const ghlStageName of Object.keys(mapping.stages)) {
    const target = norm(ghlStageName);
    const found = pipeline.stages.find(s => norm(s.name) === target);
    if (found) stage_ids[ghlStageName] = found.id;
  }
  return {
    mapping: { ...mapping, pipeline_id: pipeline.id, stage_ids },
    pipeline,
  };
}

// Reverse lookup: given a pipeline_stage_id, return our internal prospect_status.
export function stageIdToProspectStatus(mapping: GhlPipelineMapping, pipelineStageId: string): string | null {
  if (!mapping.stage_ids) return null;
  for (const [stageName, stageId] of Object.entries(mapping.stage_ids)) {
    if (stageId === pipelineStageId) {
      return mapping.stages[stageName] || null;
    }
  }
  return null;
}

// Forward lookup: given a prospect_status, return the GHL pipeline_stage_id.
export function prospectStatusToStageId(mapping: GhlPipelineMapping, prospectStatus: string): { pipelineId?: string; stageId?: string } {
  if (!mapping.stage_ids || !mapping.pipeline_id) return {};
  // Find the GHL stage name whose mapping value equals our status
  const stageName = Object.entries(mapping.stages).find(([, ourStatus]) => ourStatus === prospectStatus)?.[0];
  if (!stageName) return {};
  return { pipelineId: mapping.pipeline_id, stageId: mapping.stage_ids[stageName] };
}

// ── Calendar events ────────────────────────────────────────────────────────

export interface GhlCalendarEvent {
  id: string;
  calendarId: string;
  contactId?: string;
  startTime: string;
  endTime?: string;
  appointmentStatus?: string;
}

export async function listCalendarEvents(calendarId: string, startTime: string, endTime: string): Promise<{ events: GhlCalendarEvent[]; error?: string }> {
  if (!LOCATION_ID || !calendarId) return { events: [], error: 'missing locationId or calendarId' };
  // GHL /calendars/events expects epoch MILLISECONDS for startTime/endTime
  const startMs = new Date(startTime).getTime().toString();
  const endMs = new Date(endTime).getTime().toString();
  const params = new URLSearchParams({
    locationId: LOCATION_ID,
    calendarId,
    startTime: startMs,
    endTime: endMs,
  });
  try {
    const data = await ghlRequest('GET', `/calendars/events?${params.toString()}`);
    const events: GhlCalendarEvent[] = (data?.events || []).map((e: Record<string, unknown>) => ({
      id: (e.id || e._id) as string,
      calendarId: (e.calendarId || calendarId) as string,
      contactId: (e.contactId || (e.contact as { id?: string })?.id) as string | undefined,
      startTime: (e.startTime || e.startDate) as string,
      endTime: (e.endTime || e.endDate) as string | undefined,
      appointmentStatus: (e.appointmentStatus || e.status) as string | undefined,
    }));
    return { events };
  } catch (e) {
    return { events: [], error: (e as Error).message };
  }
}

export async function getContact(contactId: string): Promise<{ id: string; email?: string; phone?: string; firstName?: string; lastName?: string; name?: string } | null> {
  if (!LOCATION_ID || !contactId) return null;
  try {
    const data = await ghlRequest('GET', `/contacts/${contactId}`);
    const c = data?.contact || data;
    if (!c) return null;
    return {
      id: c.id || c._id,
      email: c.email,
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      name: c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || undefined,
    };
  } catch {
    return null;
  }
}
