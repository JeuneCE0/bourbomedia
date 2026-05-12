import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ghlRequest } from '@/lib/ghl';
import { listOpportunitiesByContact } from '@/lib/ghl-opportunities';

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
  // GHL renvoie les CF par scope (model=contact par défaut). Les champs de
  // qualification commerciale sont au niveau opportunité → on fetch les
  // deux scopes et on merge pour pouvoir résoudre les labels des deux.
  const merged = new Map<string, CustomField>();
  for (const model of ['contact', 'opportunity'] as const) {
    try {
      const data = await ghlRequest('GET', `/locations/${LOCATION_ID}/customFields?model=${model}`);
      for (const f of (data?.customFields || []) as { id: string; name: string; fieldKey?: string; dataType?: string }[]) {
        if (!merged.has(f.id)) merged.set(f.id, { id: f.id, name: f.name, fieldKey: f.fieldKey, dataType: f.dataType });
      }
    } catch { /* tolère un scope qui échoue */ }
  }
  _cachedFields = Array.from(merged.values());
  _cachedAt = Date.now();
  return _cachedFields;
}

// GET /api/ghl/contact?id=<ghl_contact_id>&merge_opps=1
//   Returns the full GHL contact record : tags, custom fields (with labels),
//   address, source, dates…
//   Si merge_opps=1, on récupère AUSSI les opportunités liées au contact (via
//   listOpportunitiesByContact + /opportunities/{id} pour avoir les CF) et on
//   merge leurs customFields avec ceux du contact (les CF de qualification
//   commerciale sont souvent au niveau opportunité dans GHL).
//   On dédup par id de champ → opportunité prioritaire en cas de collision.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  const mergeOpps = req.nextUrl.searchParams.get('merge_opps') === '1';
  // opp_id explicite : si le client connaît l'opp liée à ce contact (ex.
  // une page RDV qui a déjà l'opportunity_id en DB), on l'ajoute toujours
  // au merge même si listOpportunitiesByContact ne la renvoie pas (cas
  // observé : opps en pipeline non indexé, ou archivées côté GHL → la
  // recherche par contact renvoie 0 et le panel Qualification reste vide).
  const explicitOppId = req.nextUrl.searchParams.get('opp_id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  type CF = { id: string; label: string; dataType: string; value: unknown };

  function normalizeRawCustomFields(raw: unknown[], fieldsById: Map<string, CustomField>): CF[] {
    type RawCF = { id?: string; value?: unknown; field_value?: unknown; fieldValue?: unknown };
    const list: RawCF[] = Array.isArray(raw) ? raw as RawCF[] : [];
    return list
      .map(cf => {
        const meta = cf.id ? fieldsById.get(cf.id) : undefined;
        const v = cf.value !== undefined ? cf.value : (cf.field_value !== undefined ? cf.field_value : cf.fieldValue);
        return {
          id: cf.id || '',
          label: meta?.name || cf.id || 'Champ personnalisé',
          dataType: meta?.dataType || 'TEXT',
          value: v,
        };
      })
      .filter(cf => {
        if (cf.value === null || cf.value === undefined) return false;
        if (typeof cf.value === 'string' && !cf.value.trim()) return false;
        if (Array.isArray(cf.value) && cf.value.length === 0) return false;
        return true;
      });
  }

  try {
    const data = await ghlRequest('GET', `/contacts/${encodeURIComponent(id)}`);
    const c = data?.contact || data;
    if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const fields = await getCustomFields();
    const fieldsById = new Map(fields.map(f => [f.id, f]));

    const contactCustomFields = normalizeRawCustomFields(c.customFields || [], fieldsById);

    // Merge opportunity customFields (best effort)
    let mergedCustomFields = contactCustomFields;
    if (mergeOpps) {
      try {
        const opps = await listOpportunitiesByContact(id);
        const searchOppIds = opps.slice(0, 5).map(o => o.id); // limite 5 pour ne pas spammer
        // On force l'opp explicite EN TÊTE de la liste (priorité au merge)
        // ET on la dédupe pour ne pas la re-fetch deux fois si la recherche
        // l'a déjà renvoyée.
        const oppIds = explicitOppId
          ? [explicitOppId, ...searchOppIds.filter(o => o !== explicitOppId)]
          : searchOppIds;
        const oppCustomFields: CF[] = [];
        for (const oid of oppIds) {
          try {
            const od = await ghlRequest('GET', `/opportunities/${encodeURIComponent(oid)}`);
            const oRaw = (od?.opportunity || od)?.customFields || [];
            oppCustomFields.push(...normalizeRawCustomFields(oRaw, fieldsById));
          } catch { /* skip opp on error */ }
        }
        if (oppCustomFields.length > 0) {
          // Dédup : opportunité prioritaire (1ère occurrence gagne)
          const seen = new Set<string>();
          const merged: CF[] = [];
          for (const cf of [...oppCustomFields, ...contactCustomFields]) {
            if (seen.has(cf.id)) continue;
            seen.add(cf.id);
            merged.push(cf);
          }
          mergedCustomFields = merged;
        }
      } catch { /* tolerate */ }
    }

    const customFields = mergedCustomFields;

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
