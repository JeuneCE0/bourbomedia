import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// Returns the list of dates already booked for filming and publication.
// Used by the portal pickers (Tue/Thu publication, 3h-block filming) to
// disable already-occupied slots, and by the admin views as well.
//
// Response: { bookedFilming: string[], bookedPublication: string[], excludeClientId?: string }
//   - bookedFilming: dates (YYYY-MM-DD) where a client.filming_date is set
//   - bookedPublication: dates where a client.publication_deadline is set
//                        AND publication_date_confirmed = true
//   - The current client's own booked date (resolved from token) is excluded
//     so they can re-confirm their existing slot without seeing it as "taken".

async function clientFromToken(token: string) {
  const r = await supaFetch(`clients?portal_token=eq.${token}&select=id,filming_date,publication_deadline,publication_date_confirmed`, {}, true);
  if (!r.ok) return null;
  const arr = await r.json();
  return arr[0] || null;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  let currentClientId: string | null = null;

  if (token) {
    const c = await clientFromToken(token);
    if (!c) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    currentClientId = c.id;
  } else if (!requireAuth(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const r = await supaFetch(
      'clients?select=id,filming_date,publication_deadline,publication_date_confirmed&or=(filming_date.not.is.null,publication_date_confirmed.eq.true)',
      {}, true,
    );
    if (!r.ok) return NextResponse.json({ bookedFilming: [], bookedPublication: [] });
    const data = await r.json();

    const bookedFilming: string[] = [];
    const bookedPublication: string[] = [];

    for (const c of data) {
      if (c.id === currentClientId) continue; // don't include the requester's own slots
      if (c.filming_date) {
        bookedFilming.push(String(c.filming_date).slice(0, 10));
      }
      if (c.publication_deadline && c.publication_date_confirmed) {
        bookedPublication.push(String(c.publication_deadline).slice(0, 10));
      }
    }

    return NextResponse.json({ bookedFilming, bookedPublication });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message, bookedFilming: [], bookedPublication: [] }, { status: 500 });
  }
}
