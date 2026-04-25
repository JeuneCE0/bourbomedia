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

// Kill switch: when AUTOMATIONS_PAUSED=true, no client-facing WhatsApp/SMS/
// Email goes out from this codebase. Internal Slack alerts and in-app
// notifications are unaffected.
function automationsPaused(): boolean {
  return process.env.AUTOMATIONS_PAUSED === 'true';
}

export async function sendWhatsAppMessage(contactId: string, message: string) {
  if (automationsPaused()) return null;
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
  if (automationsPaused()) return null;
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

export async function sendDocumentFromTemplate(templateId: string, contactId: string, userId: string): Promise<{ documentId: string; signingUrl: string }> {
  if (!GHL_API_KEY) throw new Error('GHL_API_KEY manquant');
  if (!LOCATION_ID) throw new Error('GHL_LOCATION_ID manquant');
  if (!userId) throw new Error('GHL_USER_ID manquant — ajoute-le dans les variables Vercel');
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

export async function findSignedDocumentByContact(contactId: string, email?: string): Promise<{ signed: boolean; documentId?: string; signedAt?: string; debug?: unknown }> {
  if (!GHL_API_KEY || !LOCATION_ID) return { signed: false };
  const queries = [contactId];
  if (email) queries.push(email);

  for (const q of queries) {
    try {
      const data = await ghlRequest('GET', `/proposals/document?locationId=${LOCATION_ID}&query=${encodeURIComponent(q)}&limit=10`);
      const docs = data?.data || [];
      for (const doc of docs) {
        const status = Array.isArray(doc.status) ? doc.status[0] : doc.status;
        if (status === 'completed' || status === 'accepted' || status === 'signed') {
          return { signed: true, documentId: doc.id || doc._id, signedAt: doc.updatedAt };
        }
      }
    } catch { /* try next query */ }
  }

  // Debug: return what GHL sees for the first query
  try {
    const data = await ghlRequest('GET', `/proposals/document?locationId=${LOCATION_ID}&limit=5`);
    const docs = (data?.data || []).map((d: Record<string, unknown>) => ({
      id: d.id || d._id,
      name: d.name,
      status: d.status,
      email: d.email,
      contactId: d.contactId,
      updatedAt: d.updatedAt,
    }));
    return { signed: false, debug: docs };
  } catch {
    return { signed: false };
  }
}

export async function findGhlContactByEmail(email: string): Promise<string | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  const data = await ghlRequest('GET', `/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`);
  const contact = data?.contacts?.[0];
  return contact?.id || null;
}

export async function findGhlContactByEmailOrPhone(email: string, phone?: string): Promise<string | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    const byEmail = await ghlRequest('GET', `/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`);
    if (byEmail?.contacts?.[0]?.id) return byEmail.contacts[0].id;
    if (phone) {
      const byPhone = await ghlRequest('GET', `/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(phone)}&limit=1`);
      if (byPhone?.contacts?.[0]?.id) return byPhone.contacts[0].id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createGhlContact(contactData: { firstName: string; lastName: string; email: string; phone?: string; companyName?: string }): Promise<string> {
  if (!GHL_API_KEY) throw new Error('GHL_API_KEY manquant');
  if (!LOCATION_ID) throw new Error('GHL_LOCATION_ID manquant');
  try {
    const data = await ghlRequest('POST', '/contacts/', {
      locationId: LOCATION_ID,
      ...contactData,
    });
    const id = data?.contact?.id || data?.id;
    if (!id) throw new Error('Réponse GHL inattendue: ' + JSON.stringify(data).slice(0, 200));
    return id;
  } catch (e: unknown) {
    const msg = (e as Error).message || '';
    if (msg.includes('duplicate') || msg.includes('Duplicate') || msg.includes('409') || msg.includes('400')) {
      const existing = await findGhlContactByEmail(contactData.email);
      if (existing) return existing;
    }
    throw e;
  }
}
