import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

interface ContactSuggestion {
  id: string;
  type: 'client' | 'prospect';
  contact_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  client_id: string | null; // pour deep-link sur la fiche
  ghl_contact_id: string | null; // pour le linker manuel
}

// GET /api/contacts/lookup?q=texte
//   Recherche unifiée : clients locaux + prospects GHL (gh_opportunities).
//   Match par contact_name, business_name (clients), name/contact_email (opps).
//   Utilisé par l'autocomplete du Co-Pilot "Brouillon de message".
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  if (q.length < 2) return NextResponse.json({ contacts: [] });

  const enc = encodeURIComponent(`%${q}%`);
  const out: ContactSuggestion[] = [];
  const seen = new Set<string>(); // dédup par email pour éviter doublons client/prospect

  try {
    // 1. Clients locaux (non archivés)
    const cR = await supaFetch(
      `clients?archived_at=is.null`
      + `&or=(business_name.ilike.${enc},contact_name.ilike.${enc},email.ilike.${enc})`
      + `&select=id,business_name,contact_name,email,phone,ghl_contact_id&limit=8&order=created_at.desc`,
      {}, true,
    );
    if (cR.ok) {
      const arr = await cR.json();
      for (const c of arr) {
        const key = (c.email || c.id).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: c.id,
          type: 'client',
          contact_name: c.contact_name,
          business_name: c.business_name,
          email: c.email,
          phone: c.phone,
          client_id: c.id,
          ghl_contact_id: c.ghl_contact_id || null,
        });
      }
    }

    // 2. Prospects GHL (déduplique par email avec les clients déjà trouvés)
    const oR = await supaFetch(
      `gh_opportunities?or=(name.ilike.${enc},contact_name.ilike.${enc},contact_email.ilike.${enc})`
      + `&select=id,name,contact_name,contact_email,contact_phone,client_id,ghl_contact_id&limit=8&order=ghl_updated_at.desc.nullslast`,
      {}, true,
    );
    if (oR.ok) {
      const arr = await oR.json();
      for (const o of arr) {
        const key = (o.contact_email || o.id).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: o.id,
          type: 'prospect',
          contact_name: o.contact_name,
          business_name: o.name,
          email: o.contact_email,
          phone: o.contact_phone,
          client_id: o.client_id,
          ghl_contact_id: o.ghl_contact_id || null,
        });
      }
    }
  } catch { /* tolerate */ }

  return NextResponse.json({ contacts: out.slice(0, 12) });
}
