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
