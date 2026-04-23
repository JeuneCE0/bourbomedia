import { NextRequest, NextResponse } from 'next/server';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const PIPELINE_ID = 'pWEcPHjdG7FSXIKbGsKc';
const STAGE_LEADS = '66875cc0-0b57-47bf-b027-ef0187d77db9';
const STAGE_NON_QUALIFIE = 'b7acf2e0-7d3b-4eae-9af5-9fcee9a845ec';

const CUSTOM_FIELD_IDS: Record<string, string> = {
  type_de_commerce: '4Wq2dNSdRMXHVrUbq7Nw',
  ville_du_commerce: '7DJYjkcXLP9co0TREgOv',
  anciennet_du_commerce: 'epan9d4KV0FCch9rOHxX',
  exprience_publicit_en_ligne: 'xRtq6CEanWKiUcM7m2r5',
  objectif_principal: 'j9cM87WnIpB9nrE8XPMQ',
  dtail_objectif: 'FrcO6iq9kEFmObKMUjyv',
  prt__investir: 'pNLBnJGJuECrqBmDJw8O',
  qualifi: 'IUgqqqYSk8gVOyk9MaEl',
};

async function ghlFetch(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(GHL_BASE + endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + GHL_API_KEY,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();

    if (!GHL_API_KEY || !LOCATION_ID) {
      return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
    }

    if (!data || !data.name || !data.email || !data.phone) {
      return NextResponse.json({ error: 'Missing required fields', received: data }, { status: 400 });
    }

    const nameParts = data.name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';
    const isQualified = data.engagement !== 'Non';

    const contactResult = await ghlFetch('/contacts/', {
      locationId: LOCATION_ID,
      firstName,
      lastName,
      phone: data.phone,
      email: data.email,
      companyName: data.companyName || '',
      source: 'Landing Page BBP',
      tags: isQualified ? ['Qualifié', 'Formulaire BBP'] : ['Non-Qualifié', 'Formulaire BBP'],
      customFields: [
        { id: 'C6xpqArLhsVZ0qT4q5bJ', field_value: data.companyName || '' },
      ],
    });

    const contactId = contactResult.contact ? contactResult.contact.id : null;
    if (!contactId) {
      return NextResponse.json({ error: 'Contact creation failed', details: contactResult }, { status: 500 });
    }

    const oppResult = await ghlFetch('/opportunities/', {
      pipelineId: PIPELINE_ID,
      locationId: LOCATION_ID,
      name: data.name + ' — ' + (data.commerceType || 'N/A'),
      pipelineStageId: isQualified ? STAGE_LEADS : STAGE_NON_QUALIFIE,
      contactId,
      status: 'open',
      customFields: [
        { id: CUSTOM_FIELD_IDS.type_de_commerce, field_value: data.commerceType || '' },
        { id: CUSTOM_FIELD_IDS.ville_du_commerce, field_value: data.ville || '' },
        { id: CUSTOM_FIELD_IDS.anciennet_du_commerce, field_value: data.anciennete || '' },
        { id: CUSTOM_FIELD_IDS.exprience_publicit_en_ligne, field_value: data.expPub || '' },
        { id: CUSTOM_FIELD_IDS.objectif_principal, field_value: data.objectif || '' },
        { id: CUSTOM_FIELD_IDS.dtail_objectif, field_value: data.detailObjectif || '' },
        { id: CUSTOM_FIELD_IDS.prt__investir, field_value: data.engagement || '' },
        { id: CUSTOM_FIELD_IDS.qualifi, field_value: isQualified ? ['Oui'] : ['Non'] },
      ],
    });

    return NextResponse.json({
      success: true,
      qualified: isQualified,
      contactId,
      opportunityId: oppResult.opportunity ? oppResult.opportunity.id : null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
