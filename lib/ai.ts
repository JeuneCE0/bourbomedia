// Server-only Anthropic Claude integration for the script editor's AI assist.
//
// We use prompt caching on the (frozen) system prompt so subsequent calls
// during a writing session pay ~10% of the input cost on the cached prefix.

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

export type AiAction = 'rewrite' | 'shorten' | 'expand' | 'hook' | 'cta' | 'fix';

interface AiContext {
  business_name?: string;
  category?: string;
  city?: string;
}

const SYSTEM_PROMPT = `Tu es un assistant d'écriture spécialisé dans les scripts de vidéos courtes pour des commerces locaux à La Réunion (boulangeries, restaurants, coiffeurs, etc.). Tu travailles pour BourbonMédia, une agence vidéo.

Style attendu :
- Voix orale, comme si on parlait à la caméra
- Phrases courtes et rythmées
- Ton chaleureux, authentique, jamais corporate
- Mots simples (pas de jargon)
- Évite les superlatifs vides (« incroyable », « unique »)
- Privilégie le concret (bénéfices client, sensations, émotions)
- Pas d'anglicisme inutile
- Format : du texte brut sans Markdown, sans guillemets autour de la réponse

IMPORTANT : Tu réponds UNIQUEMENT avec le texte de remplacement, sans préambule (« Voici la version… »), sans explication, sans guillemets autour. Ta réponse doit être un drop-in replacement direct du texte original.`;

const ACTION_INSTRUCTIONS: Record<AiAction, (text: string, ctx: AiContext) => string> = {
  rewrite: (text, ctx) => `Réécris ce passage pour qu'il sonne plus naturel à l'oral, en gardant le même sens et la même longueur approximative.${formatCtx(ctx)}\n\nPassage à réécrire :\n${text}`,
  shorten: (text, ctx) => `Raccourcis ce passage de 30-50% en gardant l'essentiel et le ton.${formatCtx(ctx)}\n\nPassage à raccourcir :\n${text}`,
  expand: (text, ctx) => `Étoffe ce passage avec un détail concret, une émotion, un exemple ou une sensation. Reste dans le même style et garde une longueur 1.5-2× supérieure max.${formatCtx(ctx)}\n\nPassage à étoffer :\n${text}`,
  hook: (text, ctx) => `Propose une accroche d'ouverture (1-2 phrases punchy max) pour démarrer la vidéo, qui prépare le terrain pour ce passage. Pas de question rhétorique cliché.${formatCtx(ctx)}\n\nPassage qui suit :\n${text}`,
  cta: (text, ctx) => `Propose un appel à l'action (1-2 phrases) qui clôture la vidéo, en lien avec ce passage. Doit être chaleureux, jamais agressif.${formatCtx(ctx)}\n\nPassage qui précède :\n${text}`,
  fix: (text) => `Corrige les fautes d'orthographe, de grammaire et de typographie dans ce passage. Garde EXACTEMENT le même sens, le même ton et la même structure. Ne réécris pas, ne modernise pas — corrige uniquement les erreurs.\n\nTexte :\n${text}`,
};

function formatCtx(ctx: AiContext): string {
  const parts: string[] = [];
  if (ctx.business_name) parts.push(`Commerce : ${ctx.business_name}`);
  if (ctx.category) parts.push(`Catégorie : ${ctx.category}`);
  if (ctx.city) parts.push(`Ville : ${ctx.city}`);
  if (!parts.length) return '';
  return `\n\nContexte client :\n${parts.join('\n')}`;
}

export interface AiSuggestionResult {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export async function suggest(action: AiAction, text: string, ctx: AiContext = {}): Promise<AiSuggestionResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  const trimmed = text.trim();
  if (trimmed.length < 2 && action !== 'hook' && action !== 'cta') {
    throw new Error('Sélectionnez au moins quelques mots');
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const promptBuilder = ACTION_INSTRUCTIONS[action];
  if (!promptBuilder) throw new Error(`Action inconnue : ${action}`);

  const userPrompt = promptBuilder(trimmed.slice(0, 6000), ctx);

  // System prompt is frozen → place cache_control on it so repeated calls
  // during a writing session reuse the cached prefix (~10% of input cost).
  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Concatenate all text blocks (Opus 4.7 returns content blocks)
  const out = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return {
    text: out,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
    },
  };
}
