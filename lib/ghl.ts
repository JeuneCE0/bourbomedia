const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.GHL_LOCATION_ID || '';

function headers() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
}

export async function ghlRequest(method: string, endpoint: string, body?: Record<string, unknown>) {
  const res = await fetch(GHL_BASE + endpoint, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`GHL ${res.status}: ${msg}`);
  }
  return data;
}

export async function sendWhatsAppMessage(contactId: string, message: string) {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    return await ghlRequest('POST', '/conversations/messages', {
      type: 'WhatsApp',
      contactId,
      message,
    });
  } catch {
    return null;
  }
}

export async function sendEmailMessage(contactId: string, subject: string, htmlBody: string) {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    return await ghlRequest('POST', '/conversations/messages', {
      type: 'Email',
      contactId,
      subject,
      html: htmlBody,
    });
  } catch {
    return null;
  }
}

export async function updateContactTags(contactId: string, tags: string[]) {
  if (!GHL_API_KEY) return null;
  try {
    return await ghlRequest('PUT', `/contacts/${contactId}`, { tags });
  } catch {
    return null;
  }
}

export function getLocationId() {
  return LOCATION_ID;
}

// ============================================================
// Documents & Contracts (GHL API: /proposals/*)
// ============================================================

const GHL_CONTRACT_TEMPLATE_NAME = process.env.GHL_CONTRACT_TEMPLATE_NAME || 'CONTRAT BBP - CLIENT';

export async function listDocumentTemplates(): Promise<Array<{ id: string; _id: string; name: string }>> {
  if (!GHL_API_KEY || !LOCATION_ID) return [];
  try {
    const data = await ghlRequest('GET', `/proposals/templates?locationId=${LOCATION_ID}`);
    return data?.data || [];
  } catch {
    return [];
  }
}

export async function findContractTemplateId(): Promise<string | null> {
  const templates = await listDocumentTemplates();
  const tpl = templates.find((t) => t.name === GHL_CONTRACT_TEMPLATE_NAME);
  return tpl?.id || tpl?._id || null;
}

export async function sendDocumentFromTemplate(templateId: string, contactId: string, userId: string): Promise<{ documentId: string; signingUrl: string } | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    const data = await ghlRequest('POST', '/proposals/templates/send', {
      locationId: LOCATION_ID,
      templateId,
      contactId,
      userId,
      sendDocument: true,
    });
    const link = data?.links?.[0];
    return {
      documentId: link?.documentId || data?.documentId || '',
      signingUrl: link?.referenceId ? `https://app.gohighlevel.com/v2/preview/${link.documentId}?referenceId=${link.referenceId}` : '',
    };
  } catch {
    return null;
  }
}

export async function getDocumentStatus(documentId: string): Promise<{ status: string; signedAt?: string } | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    const data = await ghlRequest('GET', `/proposals/document?locationId=${LOCATION_ID}&query=${documentId}&limit=1`);
    const doc = data?.data?.[0];
    if (!doc) return null;
    const status = Array.isArray(doc.status) ? doc.status[0] : doc.status;
    const isCompleted = status === 'completed' || status === 'accepted';
    return {
      status: status || 'pending',
      signedAt: isCompleted ? doc.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export async function createGhlContact(contactData: { firstName: string; lastName: string; email: string; phone?: string; companyName?: string }): Promise<string> {
  if (!GHL_API_KEY) throw new Error('GHL_API_KEY manquant');
  if (!LOCATION_ID) throw new Error('GHL_LOCATION_ID manquant');
  const data = await ghlRequest('POST', '/contacts/', {
    locationId: LOCATION_ID,
    ...contactData,
  });
  const id = data?.contact?.id || data?.id;
  if (!id) throw new Error('Réponse GHL inattendue: ' + JSON.stringify(data).slice(0, 200));
  return id;
}
