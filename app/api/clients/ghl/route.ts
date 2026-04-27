import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

// GET /api/clients/ghl?id=<client_uuid>
//   Returns all GHL data linked to the client : opportunities + appointments
//   (closing / onboarding / tournage). Used by the "Closing & RDV" tab on the
//   client detail page so the admin sees everything in one place.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  // Fetch the client's email + ghl_contact_id to broaden the join (some legacy
  // rows may not have client_id set yet)
  const cR = await supaFetch(
    `clients?id=eq.${encodeURIComponent(id)}&select=id,email,ghl_contact_id&limit=1`,
    {}, true,
  );
  if (!cR.ok) return NextResponse.json({ error: 'fetch client failed' }, { status: 500 });
  const arr = await cR.json();
  const client = arr[0];
  if (!client) return NextResponse.json({ error: 'client not found' }, { status: 404 });

  // Build "or" filter : client_id match OR ghl_contact_id match OR email match
  const orFilters: string[] = [`client_id.eq.${id}`];
  if (client.ghl_contact_id) orFilters.push(`ghl_contact_id.eq.${client.ghl_contact_id}`);
  if (client.email) orFilters.push(`contact_email.ilike.${encodeURIComponent(client.email.toLowerCase().trim())}`);
  const orParam = `or=(${orFilters.join(',')})`;

  const [oppRes, apptRes] = await Promise.all([
    supaFetch(
      `gh_opportunities?${orParam}&select=*&order=ghl_updated_at.desc.nullslast&limit=20`,
      {}, true,
    ),
    supaFetch(
      `gh_appointments?${orParam}&select=*&order=starts_at.desc&limit=50`,
      {}, true,
    ),
  ]);

  const opportunities = oppRes.ok ? await oppRes.json() : [];
  const appointments = apptRes.ok ? await apptRes.json() : [];

  return NextResponse.json({ opportunities, appointments });
}
