import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// POST /api/ai/transcribe
//   FormData : { audio: File, language?: 'fr'|'en' }
//   Réponse  : { text: string, duration?: number }
//
// Utilise OpenAI Whisper (whisper-1) ou Groq (whisper-large-v3, plus rapide + cheaper)
// selon les env vars dispo : OPENAI_API_KEY ou GROQ_API_KEY.
//
// Coût approx : OpenAI = $0.006/min, Groq = ~10× moins cher.

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export async function POST(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const useGroq = !!GROQ_API_KEY;
  const apiKey = useGroq ? GROQ_API_KEY : OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'Aucune clé Whisper configurée',
      hint: 'Ajoute OPENAI_API_KEY ou GROQ_API_KEY dans les env vars (Groq recommandé : 10× moins cher et plus rapide)',
    }, { status: 503 });
  }

  // Re-package the FormData : on ne peut pas forwarder directement le formData
  // à un endpoint externe → on extrait le fichier et reconstruit.
  const incoming = await req.formData();
  const audio = incoming.get('audio');
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'audio (File) requis dans le formData' }, { status: 400 });
  }
  const language = (incoming.get('language') as string) || 'fr';

  const fwd = new FormData();
  fwd.append('file', audio);
  fwd.append('model', useGroq ? 'whisper-large-v3' : 'whisper-1');
  fwd.append('language', language);
  fwd.append('response_format', 'json');
  // temperature=0 : déterministe, réduit les hallucinations sur silence
  fwd.append('temperature', '0');
  // prompt = biais contextuel : oriente Whisper vers le vocabulaire métier au
  // lieu de tomber sur ses hallucinations classiques (sous-titres YT)
  fwd.append('prompt', 'Conversation commerciale Bourbomedia, agence vidéo à La Réunion. Vocabulaire : prospect, closing, contrat, vidéo, tournage, commerce, restaurateur, coiffeur, boulangerie, devis, paiement.');

  const url = useGroq
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fwd,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return NextResponse.json({
        error: `Whisper ${r.status}: ${txt.slice(0, 200)}`,
        provider: useGroq ? 'groq' : 'openai',
      }, { status: 500 });
    }
    const data = await r.json();
    let text = (data.text || '').trim();

    // Filtre les hallucinations Whisper connues sur silence — quand il sort
    // ces phrases c'est que l'audio était vide/trop faible.
    const HALLUCINATIONS = [
      /sous-?titrage.*?radio-?canada/i,
      /sous-?titres? r[eé]alis[eé]s?/i,
      /sous-?titres? par la communaut[eé]/i,
      /merci d'avoir regard[eé]/i,
      /❤️ par sous-titres/i,
      /^musique\.?$/i,
      /^silence\.?$/i,
      /amara\.org/i,
      /❤️ by/i,
    ];
    const wasHallucination = HALLUCINATIONS.some(rx => rx.test(text));
    if (wasHallucination || text.length < 3) {
      return NextResponse.json({
        text: '',
        empty: true,
        hint: 'Audio trop faible ou silencieux — vérifie ton micro (autorisation navigateur, volume entrée). Whisper a halluciné sur du silence.',
        provider: useGroq ? 'groq' : 'openai',
      });
    }

    return NextResponse.json({
      text,
      provider: useGroq ? 'groq' : 'openai',
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Permet les enregistrements audio plus longs (Whisper accepte jusqu'à 25 MB).
export const runtime = 'nodejs';
export const maxDuration = 60;
