import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { supaFetch } from '@/lib/supabase';

interface DuplicateMatch {
  source: 'client' | 'opportunity';
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  match_reason: 'email' | 'phone' | 'name';
  match_score: number; // 0-100
  href: string;
  status_label?: string | null;
}

// Normalize phone : keep only digits, last 9 (FR mobile mostly), insensible aux préfixes
function normalizePhone(p: string | null | undefined): string {
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  return digits.slice(-9); // last 9 digits = good FR/mobile match
}

function normalizeEmail(e: string | null | undefined): string {
  return (e || '').toLowerCase().trim();
}

function levenshteinSim(a: string, b: string): number {
  // Quick similarity 0-1 — Jaro-like via Levenshtein normalisé
  if (!a || !b) return 0;
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const matrix: number[][] = [];
  for (let i = 0; i <= lb; i++) matrix[i] = [i];
  for (let j = 0; j <= la; j++) matrix[0][j] = j;
  for (let i = 1; i <= lb; i++) {
    for (let j = 1; j <= la; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return 1 - (matrix[lb][la] / Math.max(la, lb));
}

// GET /api/contacts/duplicates?email=...&phone=...&name=...
//   Cherche dans clients + gh_opportunities. Retourne max 5 matches triés par score.
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const email = normalizeEmail(req.nextUrl.searchParams.get('email'));
  const phoneNorm = normalizePhone(req.nextUrl.searchParams.get('phone'));
  const name = (req.nextUrl.searchParams.get('name') || '').toLowerCase().trim();
  const excludeId = req.nextUrl.searchParams.get('exclude_id') || null;

  if (!email && !phoneNorm && name.length < 3) return NextResponse.json({ matches: [] });

  const matches: DuplicateMatch[] = [];

  // 1. Match par email exact (très fort signal)
  if (email) {
    const enc = encodeURIComponent(email);
    const [clR, oR] = await Promise.all([
      supaFetch(`clients?email=ilike.${enc}&archived_at=is.null&select=id,business_name,contact_name,email,phone,status&limit=5`, {}, true),
      supaFetch(`gh_opportunities?contact_email=ilike.${enc}&select=id,name,contact_name,contact_email,contact_phone,prospect_status,pipeline_stage_name&limit=5`, {}, true),
    ]);
    if (clR.ok) {
      const arr = await clR.json();
      for (const c of arr) {
        if (excludeId && c.id === excludeId) continue;
        matches.push({
          source: 'client',
          id: c.id,
          name: c.business_name || c.contact_name,
          email: c.email,
          phone: c.phone,
          match_reason: 'email',
          match_score: 100,
          href: `/dashboard/clients/${c.id}`,
          status_label: c.status,
        });
      }
    }
    if (oR.ok) {
      const arr = await oR.json();
      for (const o of arr) {
        if (excludeId && o.id === excludeId) continue;
        matches.push({
          source: 'opportunity',
          id: o.id,
          name: o.name || o.contact_name,
          email: o.contact_email,
          phone: o.contact_phone,
          match_reason: 'email',
          match_score: 100,
          href: `/dashboard/pipeline?q=${encodeURIComponent(o.contact_email || o.name || '')}`,
          status_label: o.prospect_status || o.pipeline_stage_name,
        });
      }
    }
  }

  // 2. Match par téléphone (si phone fourni et pas déjà trouvé par email)
  if (phoneNorm && phoneNorm.length >= 8) {
    // PostgREST ne supporte pas la normalisation côté server simplement → on
    // pull les rows avec phone non nul et on filtre côté Node.
    const [clR, oR] = await Promise.all([
      supaFetch(`clients?phone=not.is.null&archived_at=is.null&select=id,business_name,contact_name,email,phone,status&limit=200`, {}, true),
      supaFetch(`gh_opportunities?contact_phone=not.is.null&select=id,name,contact_name,contact_email,contact_phone,prospect_status&limit=200`, {}, true),
    ]);
    if (clR.ok) {
      const arr = await clR.json();
      for (const c of arr) {
        if (excludeId && c.id === excludeId) continue;
        if (matches.some(m => m.source === 'client' && m.id === c.id)) continue; // déjà trouvé via email
        if (normalizePhone(c.phone) === phoneNorm) {
          matches.push({
            source: 'client',
            id: c.id,
            name: c.business_name || c.contact_name,
            email: c.email,
            phone: c.phone,
            match_reason: 'phone',
            match_score: 95,
            href: `/dashboard/clients/${c.id}`,
            status_label: c.status,
          });
        }
      }
    }
    if (oR.ok) {
      const arr = await oR.json();
      for (const o of arr) {
        if (excludeId && o.id === excludeId) continue;
        if (matches.some(m => m.source === 'opportunity' && m.id === o.id)) continue;
        if (normalizePhone(o.contact_phone) === phoneNorm) {
          matches.push({
            source: 'opportunity',
            id: o.id,
            name: o.name || o.contact_name,
            email: o.contact_email,
            phone: o.contact_phone,
            match_reason: 'phone',
            match_score: 95,
            href: `/dashboard/pipeline?q=${encodeURIComponent(o.contact_phone || '')}`,
            status_label: o.prospect_status,
          });
        }
      }
    }
  }

  // 3. Match par nom approximatif (Levenshtein > 0.85), on limite si on a déjà des hits
  if (name.length >= 3 && matches.length < 3) {
    const enc = encodeURIComponent(`%${name.split(' ')[0]}%`);
    const [clR, oR] = await Promise.all([
      supaFetch(`clients?archived_at=is.null&or=(business_name.ilike.${enc},contact_name.ilike.${enc})&select=id,business_name,contact_name,email,phone,status&limit=20`, {}, true),
      supaFetch(`gh_opportunities?or=(name.ilike.${enc},contact_name.ilike.${enc})&select=id,name,contact_name,contact_email,contact_phone,prospect_status&limit=20`, {}, true),
    ]);
    if (clR.ok) {
      const arr = await clR.json();
      for (const c of arr) {
        if (excludeId && c.id === excludeId) continue;
        if (matches.some(m => m.source === 'client' && m.id === c.id)) continue;
        const candidate = (c.business_name || c.contact_name || '').toLowerCase();
        const sim = Math.max(levenshteinSim(name, candidate), levenshteinSim(name, (c.contact_name || '').toLowerCase()));
        if (sim >= 0.7) {
          matches.push({
            source: 'client',
            id: c.id,
            name: c.business_name || c.contact_name,
            email: c.email,
            phone: c.phone,
            match_reason: 'name',
            match_score: Math.round(sim * 100),
            href: `/dashboard/clients/${c.id}`,
            status_label: c.status,
          });
        }
      }
    }
    if (oR.ok) {
      const arr = await oR.json();
      for (const o of arr) {
        if (excludeId && o.id === excludeId) continue;
        if (matches.some(m => m.source === 'opportunity' && m.id === o.id)) continue;
        const candidate = (o.name || o.contact_name || '').toLowerCase();
        const sim = Math.max(levenshteinSim(name, candidate), levenshteinSim(name, (o.contact_name || '').toLowerCase()));
        if (sim >= 0.7) {
          matches.push({
            source: 'opportunity',
            id: o.id,
            name: o.name || o.contact_name,
            email: o.contact_email,
            phone: o.contact_phone,
            match_reason: 'name',
            match_score: Math.round(sim * 100),
            href: `/dashboard/pipeline?q=${encodeURIComponent(o.name || '')}`,
            status_label: o.prospect_status,
          });
        }
      }
    }
  }

  // Trier par score desc + max 5
  matches.sort((a, b) => b.match_score - a.match_score);
  return NextResponse.json({ matches: matches.slice(0, 5) });
}
