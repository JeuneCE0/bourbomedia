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
  return res.json();
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
// Documents & Contracts
// ============================================================

const GHL_CONTRACT_TEMPLATE_NAME = process.env.GHL_CONTRACT_TEMPLATE_NAME || 'CONTRAT BBP - CLIENT';

export async function listDocumentTemplates(): Promise<Array<{ id: string; name: string }>> {
  if (!GHL_API_KEY || !LOCATION_ID) return [];
  try {
    const data = await ghlRequest('GET', `/documents/templates/?locationId=${LOCATION_ID}`);
    return data?.templates || data?.data || [];
  } catch {
    return [];
  }
}

export async function findContractTemplateId(): Promise<string | null> {
  const templates = await listDocumentTemplates();
  const tpl = templates.find((t: { name: string }) =>
    t.name === GHL_CONTRACT_TEMPLATE_NAME
  );
  return tpl?.id || null;
}

export async function sendDocumentFromTemplate(templateId: string, contactId: string, contactName: string, contactEmail: string): Promise<{ documentId: string; signingUrl: string } | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    const data = await ghlRequest('POST', '/documents/templates/send', {
      locationId: LOCATION_ID,
      templateId,
      recipients: [{
        contactId,
        name: contactName,
        email: contactEmail,
        role: 'signer',
      }],
    });
    return {
      documentId: data?.id || data?.documentId || '',
      signingUrl: data?.signingUrl || data?.signing_url || data?.url || '',
    };
  } catch {
    return null;
  }
}

export async function getDocumentStatus(documentId: string): Promise<{ status: string; signedAt?: string } | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    const data = await ghlRequest('GET', `/documents/${documentId}?locationId=${LOCATION_ID}`);
    return {
      status: data?.status || 'pending',
      signedAt: data?.signedAt || data?.signed_at || data?.completedAt || undefined,
    };
  } catch {
    return null;
  }
}

export async function createGhlContact(contactData: { firstName: string; lastName: string; email: string; phone?: string; companyName?: string }): Promise<string | null> {
  if (!GHL_API_KEY || !LOCATION_ID) return null;
  try {
    const data = await ghlRequest('POST', '/contacts/', {
      locationId: LOCATION_ID,
      ...contactData,
    });
    return data?.contact?.id || data?.id || null;
  } catch {
    return null;
  }
}
