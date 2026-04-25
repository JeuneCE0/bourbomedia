// Centralized fetch helper with consistent error handling.
// Replaces the patchwork of try/catch blocks across pages.

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiCallOptions extends RequestInit {
  json?: any;
  token?: string | null;
}

export async function apiCall<T = any>(url: string, opts: ApiCallOptions = {}): Promise<T> {
  const { json, token, headers, ...rest } = opts;
  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string>) };
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (token) {
    finalHeaders['Authorization'] = `Bearer ${token}`;
  }
  const r = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!r.ok) {
    let body: any = null;
    try {
      body = await r.json();
    } catch {
      body = await r.text().catch(() => null);
    }
    const message = (body && typeof body === 'object' && (body.error || body.message)) || r.statusText || 'Erreur';
    throw new ApiError(String(message), r.status, body);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

/** Friendly error message for end users. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Une erreur est survenue. Réessayez.';
}
