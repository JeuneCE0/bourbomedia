import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { runCopilot, type CopilotAction } from '@/lib/ai-copilot';

const ALLOWED: CopilotAction[] = ['generate_script', 'summarize_call', 'suggest_next_action', 'draft_message'];

// POST /api/ai/copilot
//   body : { action: CopilotAction, payload: object }
//   Réponse : { text: string, usage: { input_tokens, output_tokens, ... } }
export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let body: { action?: string; payload?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const action = body.action as CopilotAction;
  if (!action || !ALLOWED.includes(action)) {
    return NextResponse.json({ error: `action invalide (attendu : ${ALLOWED.join(' | ')})` }, { status: 400 });
  }

  if (!body.payload || typeof body.payload !== 'object') {
    return NextResponse.json({ error: 'payload requis (objet)' }, { status: 400 });
  }

  try {
    const result = await runCopilot(action, body.payload);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
