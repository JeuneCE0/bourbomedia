import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ghlRequest } from '@/lib/ghl';

const LOCATION_ID = process.env.GHL_LOCATION_ID || '';

interface CustomField {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
}

let _cachedFields: CustomField[] | null = null;
let _cachedAt = 0;

async function getCustomFields(): Promise<CustomField[]> {
  // Cache the field metadata for 10 min — labels rarely change
  if (_cachedFields && Date.now() - _cachedAt < 10 * 60 * 1000) return _cachedFields;
  if (!LOCATION_ID) return [];
  try {
    const data = await ghlRequest('GET', `/locations/${LOCATION_ID}/customFields`);
    const fields: CustomField[] = (data?.customFields || []).map((f: { id: string; name: string; fieldKey?: string; dataType?: string }) => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
    }));
    _cachedFields = fields;
    _cachedAt = Date.now();
    return fields;
  } catch {
    return [];
  }
}

// GET /api/ghl/contact?id=<ghl_contact_id>
//   Returns the full GHL contact record : tags, custom fields (with labels),
//   address, source, dates… Used by the prospect modal to show a complete
//   GHL-like sidebar.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  try {
    const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(id)}`);
    const c = data?.contact || data;
    if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const fields = await getCustomFields();
    const fieldsById = new Map(fields.map(f => [f.id, f]));

    type RawCF = { id?: string; value?: unknown; field_value?: unknown };
    const rawCustomFields: RawCF[] = Array.isArray(c.customFields) ? c.customFields : [];
    const customFields = rawCustomFields
      .map(cf => {
        const meta = cf.id ? fieldsById.get(cf.id) : undefined;
        const raw = cf.value !== undefined ? cf.value : cf.field_value;
        return {
          id: cf.id || '',
          label: meta?.name || cf.id || 'Champ personnalisé',
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
      contact: {
        id: c.id || c._id,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        name: c.contactName || c.name || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null,
        email: c.email || null,
        phone: c.phone || null,
        companyName: c.companyName || null,
        address1: c.address1 || c.address || null,
        city: c.city || null,
        state: c.state || null,
        postalCode: c.postalCode || null,
        country: c.country || null,
        website: c.website || null,
        timezone: c.timezone || null,
        dnd: c.dnd || false,
        type: c.type || null,
        source: c.source || null,
        tags: Array.isArray(c.tags) ? c.tags : [],
        dateAdded: c.dateAdded || null,
        lastActivity: c.lastActivity || null,
        assignedTo: c.assignedTo || null,
        customFields,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
