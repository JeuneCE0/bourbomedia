const YOUSIGN_API_KEY = process.env.YOUSIGN_API_KEY || '';
const YOUSIGN_BASE = process.env.YOUSIGN_SANDBOX === 'true'
  ? 'https://api-sandbox.yousign.app/v3'
  : 'https://api.yousign.app/v3';

function headers() {
  return {
    'Authorization': `Bearer ${YOUSIGN_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function createSignatureRequest(name: string): Promise<string | null> {
  if (!YOUSIGN_API_KEY) return null;
  try {
    const r = await fetch(`${YOUSIGN_BASE}/signature_requests`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name,
        delivery_mode: 'none',
        timezone: 'Indian/Reunion',
      }),
    });
    const data = await r.json();
    return data.id || null;
  } catch {
    return null;
  }
}

export async function uploadDocument(signatureRequestId: string, fileBase64: string, filename: string): Promise<string | null> {
  if (!YOUSIGN_API_KEY) return null;
  try {
    const r = await fetch(`${YOUSIGN_BASE}/signature_requests/${signatureRequestId}/documents`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        nature: 'signable_document',
        file_name: filename,
        file_content: fileBase64,
      }),
    });
    const data = await r.json();
    return data.id || null;
  } catch {
    return null;
  }
}

export async function addSigner(
  signatureRequestId: string,
  documentId: string,
  signerInfo: { firstName: string; lastName: string; email: string; phone?: string }
): Promise<{ signerId: string; signatureLink: string } | null> {
  if (!YOUSIGN_API_KEY) return null;
  try {
    const r = await fetch(`${YOUSIGN_BASE}/signature_requests/${signatureRequestId}/signers`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        info: {
          first_name: signerInfo.firstName,
          last_name: signerInfo.lastName,
          email: signerInfo.email,
          phone_number: signerInfo.phone,
          locale: 'fr',
        },
        signature_level: 'electronic_signature',
        signature_authentication_mode: 'no_otp',
        fields: [{
          type: 'signature',
          document_id: documentId,
          page: 1,
          x: 100,
          y: 700,
          width: 200,
          height: 60,
        }],
      }),
    });
    const data = await r.json();
    return { signerId: data.id, signatureLink: data.signature_link || '' };
  } catch {
    return null;
  }
}

export async function activateSignatureRequest(signatureRequestId: string): Promise<boolean> {
  if (!YOUSIGN_API_KEY) return false;
  try {
    const r = await fetch(`${YOUSIGN_BASE}/signature_requests/${signatureRequestId}/activate`, {
      method: 'POST',
      headers: headers(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function getSignatureRequestStatus(signatureRequestId: string): Promise<string | null> {
  if (!YOUSIGN_API_KEY) return null;
  try {
    const r = await fetch(`${YOUSIGN_BASE}/signature_requests/${signatureRequestId}`, {
      headers: headers(),
    });
    const data = await r.json();
    return data.status || null;
  } catch {
    return null;
  }
}
