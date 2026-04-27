// GHL Invoices API helpers — pour récupérer les factures payées et les
// importer dans la table payments locale.
//
// Endpoint v2 : GET /invoices/?altId={locationId}&altType=location
// Doc : https://highlevel.stoplight.io/docs/integrations/d3a3a06d8df56-list-invoices

import { ghlRequest, getLocationId } from './ghl';

export interface GhlInvoice {
  id: string;
  name: string | null;
  invoiceNumber: string | null;
  currency: string;
  total: number;          // montant total (en unités majeures, EUR)
  amountPaid: number;     // montant payé
  status: string;         // 'paid' | 'sent' | 'draft' | 'partially_paid' | ...
  contactDetails: {
    id: string | null;
    name: string | null;
    email: string | null;
    phoneNo: string | null;
    companyName: string | null;
  };
  issueDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface RawInvoice {
  _id?: string;
  id?: string;
  name?: string;
  invoiceNumber?: string;
  currency?: string;
  total?: number;
  amountPaid?: number;
  status?: string;
  contactDetails?: {
    id?: string;
    name?: string;
    email?: string;
    phoneNo?: string;
    phone?: string;
    companyName?: string;
  };
  // GHL renvoie tantôt 'contactDetails', tantôt 'contact', tantôt à plat
  contact?: { id?: string; email?: string; phone?: string; name?: string; companyName?: string };
  contactId?: string;
  customerId?: string;
  customerEmail?: string;
  issueDate?: string;
  dueDate?: string;
  invoiceDate?: string;
  paidAt?: string;
  paymentDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

function normalize(raw: RawInvoice): GhlInvoice {
  // Cherche le contact où qu'il soit dans le payload
  const contactId = raw.contactDetails?.id || raw.contact?.id || raw.contactId || raw.customerId || null;
  const email = raw.contactDetails?.email || raw.contact?.email || raw.customerEmail || null;
  const name = raw.contactDetails?.name || raw.contact?.name || null;
  const phone = raw.contactDetails?.phoneNo || raw.contactDetails?.phone || raw.contact?.phone || null;
  const companyName = raw.contactDetails?.companyName || raw.contact?.companyName || null;

  return {
    id: raw._id || raw.id || '',
    name: raw.name || null,
    invoiceNumber: raw.invoiceNumber || null,
    currency: (raw.currency || 'EUR').toUpperCase(),
    total: typeof raw.total === 'number' ? raw.total : 0,
    amountPaid: typeof raw.amountPaid === 'number' ? raw.amountPaid : 0,
    status: raw.status || 'draft',
    contactDetails: { id: contactId, name, email, phoneNo: phone, companyName },
    issueDate: raw.issueDate || raw.invoiceDate || null,
    dueDate: raw.dueDate || null,
    paidAt: raw.paidAt || raw.paymentDate || raw.updatedAt || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

// Liste les factures GHL en paginant. status='paid' pour ne récupérer que celles
// effectivement encaissées. since (ISO ou ms) limite à partir d'une date.
export async function listGhlInvoices(opts: {
  status?: 'paid' | 'sent' | 'draft' | 'partially_paid' | 'all';
  limit?: number;
  daysBack?: number;
} = {}): Promise<GhlInvoice[]> {
  const locationId = getLocationId();
  if (!locationId) return [];

  const status = opts.status || 'paid';
  const pageSize = 100;
  const maxResults = opts.limit || 500;
  const all: GhlInvoice[] = [];
  let offset = 0;

  while (all.length < maxResults) {
    const params = new URLSearchParams({
      altId: locationId,
      altType: 'location',
      limit: String(pageSize),
      offset: String(offset),
    });
    if (status !== 'all') params.set('status', status);

    let data: { invoices?: RawInvoice[]; total?: number } | null = null;
    try {
      data = await ghlRequest('GET', `/invoices/?${params.toString()}`);
    } catch {
      break;
    }
    const batch = (data?.invoices || []).map(normalize);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  // Filter par date si demandé (paidAt si dispo, sinon updatedAt)
  if (opts.daysBack && opts.daysBack > 0) {
    const cutoff = Date.now() - opts.daysBack * 86_400_000;
    return all.filter(inv => {
      const ts = inv.paidAt || inv.updatedAt || inv.createdAt;
      if (!ts) return true;
      const t = new Date(ts).getTime();
      return Number.isNaN(t) || t >= cutoff;
    });
  }

  return all.slice(0, maxResults);
}
