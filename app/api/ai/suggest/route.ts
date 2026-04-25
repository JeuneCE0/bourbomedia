import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { suggest, type AiAction } from '@/lib/ai';

const VALID_ACTIONS: AiAction[] = ['rewrite', 'shorten', 'expand', 'hook', 'cta', 'fix'];

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  try {
    const body = await req.json();
    const action = body.action as AiAction;
    const text = String(body.text || '');

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
    if (!text.trim() && action !== 'hook' && action !== 'cta') {
      return NextResponse.json({ error: 'Texte requis' }, { status: 400 });
    }

    const result = await suggest(action, text, {
      business_name: body.business_name,
      category: body.category,
      city: body.city,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = (e as Error).message || '';
    const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    const friendly = msg.includes('ANTHROPIC_API_KEY')
      ? "L'assistance IA n'est pas activée. Définis ANTHROPIC_API_KEY dans Vercel."
      : msg || 'Erreur IA';
    return NextResponse.json({ error: friendly, no_key: msg.includes('ANTHROPIC_API_KEY') }, { status });
  }
}
