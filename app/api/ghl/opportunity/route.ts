import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ghlRequest } from '@/lib/ghl';

const LOCATION_ID = process.env.GHL_LOCATION_ID || '';

interface CustomField {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
  model?: string; // 'contact' | 'opportunity'
}

let _cachedFields: CustomField[] | null = null;
let _cachedAt = 0;

async function getCustomFields(): Promise<CustomField[]> {
  if (_cachedFields && Date.now() - _cachedAt < 10 * 60 * 1000) return _cachedFields;
  if (!LOCATION_ID) return [];
  // Fetch les deux scopes (contact + opportunity) — sinon les labels des
  // CF opportunité ne sont pas résolus et apparaissent comme des IDs.
  const merged = new Map<string, CustomField>();
  for (const model of ['contact', 'opportunity'] as const) {
    try {
      const data = await ghlRequest('GET', `/locations/${LOCATION_ID}/customFields?model=${model}`);
      for (const f of (data?.customFields || []) as { id: string; name: string; fieldKey?: string; dataType?: string; model?: string }[]) {
        if (!merged.has(f.id)) merged.set(f.id, { id: f.id, name: f.name, fieldKey: f.fieldKey, dataType: f.dataType, model: f.model || model });
      }
    } catch { /* tolère un scope qui échoue */ }
  }
  _cachedFields = Array.from(merged.values());
  _cachedAt = Date.now();
  return _cachedFields;
}

// GET /api/ghl/opportunity?id=<ghl_opportunity_id>
//   Returns the opportunity with its customFields (labels resolved). GHL stores
//   custom fields at the opportunity level distinct from the contact level —
//   this endpoint surfaces those for the prospect modal.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  try {
    const data = await ghlRequest('GET', `/opportunities/${encodeURIComponent(id)}`);
    const o = data?.opportunity || data;
    if (!o) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const fields = await getCustomFields();
    const fieldsById = new Map(fields.map(f => [f.id, f]));

    type RawCF = { id?: string; value?: unknown; field_value?: unknown; fieldValue?: unknown };
    const rawCustomFields: RawCF[] = Array.isArray(o.customFields) ? o.customFields : [];
    const customFields = rawCustomFields
      .map(cf => {
        const meta = cf.id ? fieldsById.get(cf.id) : undefined;
        const raw = cf.value !== undefined ? cf.value : (cf.field_value !== undefined ? cf.field_value : cf.fieldValue);
        return {
          id: cf.id || '',
          label: meta?.name || cf.id || 'Champ',
          dataType: meta?.dataType || 'TEXT',
          value: raw,
        };
      })
      .filter(cf => {
        if (cf.value === null || cf.value === undefined) return false;
        if (typeof cf.value === 'string' && !cf.value.trim()) return false;
        if (Array.isArray(cf.value) && cf.value.length === 0) return false;
        return true;
      });

    return NextResponse.json({
      opportunity: {
        id: o.id || o._id,
        name: o.name || null,
        pipelineId: o.pipelineId || null,
        pipelineStageId: o.pipelineStageId || null,
        status: o.status || null,
        monetaryValue: o.monetaryValue ?? null,
        contactId: o.contactId || null,
        customFields,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
