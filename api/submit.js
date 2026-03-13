// Serverless function — works on Netlify Functions, Vercel, Cloudflare Workers
// Deploy as: /api/submit (e.g., Netlify: netlify/functions/submit.js)

const GHL_API_KEY = 'pit-94070501-5ed0-4171-a8e9-28d51d143478';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'giq0vlSEOxHfJ0lmbR8u';
const PIPELINE_ID = 'pWEcPHjdG7FSXIKbGsKc';
const STAGE_LEADS = '66875cc0-0b57-47bf-b027-ef0187d77db9';
const STAGE_NON_QUALIFIE = 'b7acf2e0-7d3b-4eae-9af5-9fcee9a845ec';

const CUSTOM_FIELD_IDS = {
  type_de_commerce: '4Wq2dNSdRMXHVrUbq7Nw',
  ville_du_commerce: '7DJYjkcXLP9co0TREgOv',
  anciennet_du_commerce: 'epan9d4KV0FCch9rOHxX',
  exprience_publicit_en_ligne: 'xRtq6CEanWKiUcM7m2r5',
  objectif_principal: 'j9cM87WnIpB9nrE8XPMQ',
  dtail_objectif: 'FrcO6iq9kEFmObKMUjyv',
  prt__investir: 'pNLBnJGJuECrqBmDJw8O',
  qualifi: 'IUgqqqYSk8gVOyk9MaEl'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

async function ghlFetch(endpoint, body) {
  const res = await fetch(GHL_BASE + endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + GHL_API_KEY,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ─── Netlify Functions format ───
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);

    // Validate required fields
    if (!data.name || !data.email || !data.phone) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const nameParts = data.name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';
    const isQualified = data.engagement !== 'Non';

    // 1. Create or update contact
    const contactResult = await ghlFetch('/contacts/', {
      locationId: LOCATION_ID,
      firstName: firstName,
      lastName: lastName,
      phone: data.phone,
      email: data.email,
      source: 'Landing Page BBP',
      tags: isQualified ? ['Qualifié', 'Formulaire BBP'] : ['Non-Qualifié', 'Formulaire BBP']
    });

    const contactId = contactResult.contact ? contactResult.contact.id : null;
    if (!contactId) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Contact creation failed', details: contactResult })
      };
    }

    // 2. Create opportunity with custom fields
    const oppResult = await ghlFetch('/opportunities/', {
      pipelineId: PIPELINE_ID,
      locationId: LOCATION_ID,
      name: data.name + ' — ' + (data.commerceType || 'N/A'),
      pipelineStageId: isQualified ? STAGE_LEADS : STAGE_NON_QUALIFIE,
      contactId: contactId,
      status: 'open',
      customFields: [
        { id: CUSTOM_FIELD_IDS.type_de_commerce, field_value: data.commerceType || '' },
        { id: CUSTOM_FIELD_IDS.ville_du_commerce, field_value: data.ville || '' },
        { id: CUSTOM_FIELD_IDS.anciennet_du_commerce, field_value: data.anciennete || '' },
        { id: CUSTOM_FIELD_IDS.exprience_publicit_en_ligne, field_value: data.expPub || '' },
        { id: CUSTOM_FIELD_IDS.objectif_principal, field_value: data.objectif || '' },
        { id: CUSTOM_FIELD_IDS.dtail_objectif, field_value: data.detailObjectif || '' },
        { id: CUSTOM_FIELD_IDS.prt__investir, field_value: data.engagement || '' },
        { id: CUSTOM_FIELD_IDS.qualifi, field_value: isQualified ? ['Oui'] : ['Non'] }
      ]
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        qualified: isQualified,
        contactId: contactId,
        opportunityId: oppResult.opportunity ? oppResult.opportunity.id : null
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
