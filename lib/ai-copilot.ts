// AI Co-Pilot — assistant pour Siméon (closer) et Rudy (admin) :
//   - generateScript : draft V1 d'un script vidéo à partir d'un brief
//   - summarizeCall  : structure les notes brutes d'un appel
//   - suggestNextAction : recommande la prochaine action sur un prospect
//
// Server-only. Utilise Claude via @anthropic-ai/sdk avec prompt caching sur
// le system prompt (~10% du coût input sur les appels suivants).

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

export type CopilotAction = 'generate_script' | 'summarize_call' | 'suggest_next_action' | 'draft_message';

interface ScriptBrief {
  business_name: string;
  category?: string | null;
  city?: string | null;
  usp?: string | null;
  target_audience?: string | null;
  desired_tone?: string | null;
  duration_seconds?: number | null;
  custom_brief?: string | null;
}

interface CallContext {
  raw_notes: string;
  contact_name?: string | null;
  business_name?: string | null;
  appointment_kind?: string | null;
}

interface OpportunityContext {
  contact_name?: string | null;
  business_name?: string | null;
  prospect_status?: string | null;
  pipeline_stage?: string | null;
  days_in_stage?: number | null;
  last_note?: string | null;
  monetary_value_eur?: number | null;
  appointments_history?: { kind: string; status: string; days_ago: number; notes?: string | null }[];
}

interface MessageContext {
  contact_name?: string | null;
  business_name?: string | null;
  intent: 'follow_up' | 'send_script_link' | 'thank_after_payment' | 'reminder_filming' | 'reactivation' | 'custom';
  channel: 'whatsapp' | 'email' | 'sms';
  context_notes?: string | null;
  custom_brief?: string | null;
}

const SYSTEM_BASE = `Tu es l'assistant IA de Bourbomedia, une agence vidéo basée à La Réunion. Tu travailles avec Rudy (admin / dev) et Siméon (closer commercial).

Ton style :
- Français naturel, direct, jamais corporate
- Concret > général
- Adapté au contexte local (créole de La Réunion OK quand c'est naturel, sinon FR métropolitain neutre)
- Jamais de superlatifs vides ("incroyable", "unique", "fantastique")
- Évite les emojis sauf demande explicite

Tu ne réponds QUE avec ce qui est demandé : pas de préambule ("Voici…", "Bien sûr !"), pas d'explication, pas de méta-commentaire. Réponse drop-in directement utilisable.`;

const PROMPTS: Record<CopilotAction, (payload: unknown) => string> = {
  generate_script: (p) => {
    const b = p as ScriptBrief;
    const ctx: string[] = [`Commerce : ${b.business_name}`];
    if (b.category) ctx.push(`Catégorie : ${b.category}`);
    if (b.city) ctx.push(`Ville : ${b.city}`);
    if (b.usp) ctx.push(`USP / Différenciateur : ${b.usp}`);
    if (b.target_audience) ctx.push(`Cible : ${b.target_audience}`);
    if (b.desired_tone) ctx.push(`Ton souhaité : ${b.desired_tone}`);
    if (b.custom_brief) ctx.push(`Brief perso : ${b.custom_brief}`);
    const duration = b.duration_seconds || 30;
    return `Écris une V1 de script vidéo de ${duration}s pour ce commerce. Format attendu : 3 sections séparées par une ligne vide.

Section 1 — HOOK (3-5s) : une accroche qui capte l'attention immédiatement.
Section 2 — CORPS (la majorité du temps) : 2-3 bénéfices concrets pour le client, avec des images / sensations / preuves.
Section 3 — CTA (3-5s) : un appel à l'action chaleureux et clair.

Ne mets PAS d'étiquettes "HOOK :", "CORPS :", "CTA :" — juste le texte parlé tel qu'il sera dit à la caméra. Phrases courtes, voix orale.

${ctx.join('\n')}`;
  },

  summarize_call: (p) => {
    const c = p as CallContext;
    const head: string[] = [];
    if (c.contact_name) head.push(`Contact : ${c.contact_name}`);
    if (c.business_name) head.push(`Commerce : ${c.business_name}`);
    if (c.appointment_kind) head.push(`Type d'appel : ${c.appointment_kind}`);
    return `Résume cet appel commercial en 4 sections markdown courtes.

**📌 Synthèse** (1-2 phrases : ce qui s'est dit en gros)
**💡 Points clés** (3-5 bullets : ce qui compte)
**⚠️ Objections / freins** (bullets ou "Aucune")
**▶️ Prochaine action** (1 phrase actionnable + délai conseillé)

${head.join('\n')}

Notes brutes :
${c.raw_notes}`;
  },

  suggest_next_action: (p) => {
    const o = p as OpportunityContext;
    const ctx: string[] = [];
    if (o.business_name) ctx.push(`Commerce : ${o.business_name}`);
    if (o.contact_name) ctx.push(`Contact : ${o.contact_name}`);
    if (o.prospect_status) ctx.push(`Statut actuel : ${o.prospect_status}`);
    if (o.pipeline_stage) ctx.push(`Stage pipeline : ${o.pipeline_stage}`);
    if (o.days_in_stage !== null && o.days_in_stage !== undefined) ctx.push(`Jours dans ce stage : ${o.days_in_stage}`);
    if (o.monetary_value_eur) ctx.push(`Valeur estimée : ${o.monetary_value_eur} €`);
    if (o.last_note) ctx.push(`Dernière note : ${o.last_note}`);
    if (o.appointments_history && o.appointments_history.length > 0) {
      ctx.push(`\nHistorique des RDV :\n${o.appointments_history.map(a => `- ${a.kind} (${a.status}, il y a ${a.days_ago} j)${a.notes ? ` — ${a.notes.slice(0, 100)}` : ''}`).join('\n')}`);
    }
    return `Analyse ce prospect et propose la PROCHAINE meilleure action commerciale. Format :

**🎯 Action recommandée** (1 phrase claire et actionnable)
**🧠 Pourquoi** (1-2 phrases : raison)
**📅 Quand** (timing conseillé, ex : "aujourd'hui", "dans 2 jours")
**💬 Brouillon de message** (si l'action implique un contact direct, propose le texte exact à envoyer en WhatsApp ou email — ton chaleureux, direct, pas de "j'espère que vous allez bien")

${ctx.join('\n')}`;
  },

  draft_message: (p) => {
    const m = p as MessageContext;
    const intentLabels: Record<string, string> = {
      follow_up: "un follow-up commercial après un appel resté sans réponse",
      send_script_link: "informer que le script vidéo est prêt à valider sur le portail",
      thank_after_payment: "remercier le client après un paiement reçu et confirmer les prochaines étapes",
      reminder_filming: "rappel de tournage planifié",
      reactivation: "réactiver un prospect ghosting",
      custom: m.custom_brief || "message",
    };
    const intent = intentLabels[m.intent] || intentLabels.custom;
    return `Rédige un message ${m.channel === 'whatsapp' ? 'WhatsApp' : m.channel === 'email' ? 'email' : 'SMS'} pour ${intent}.

Contraintes :
- ${m.channel === 'whatsapp' ? 'Court (2-4 phrases max), ton WhatsApp naturel' : m.channel === 'sms' ? 'Très court (1-2 phrases, max 160 car)' : 'Mail clair (objet + corps 3-5 phrases)'}
- Tutoiement
- Pas de "Cher/Chère", pas de "Cordialement"
- Direct, chaleureux, jamais commercial agressif
${m.channel === 'email' ? '- Format : "Objet: ...\\n\\n[corps du mail]"' : ''}

${m.contact_name ? `Contact : ${m.contact_name}` : ''}
${m.business_name ? `Commerce : ${m.business_name}` : ''}
${m.context_notes ? `\nContexte additionnel :\n${m.context_notes}` : ''}`;
  },
};

export interface CopilotResult {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export async function runCopilot(action: CopilotAction, payload: unknown): Promise<CopilotResult> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
  const promptBuilder = PROMPTS[action];
  if (!promptBuilder) throw new Error(`Action inconnue : ${action}`);
  const userPrompt = promptBuilder(payload);

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: action === 'generate_script' ? 1500 : 800,
    system: [
      { type: 'text', text: SYSTEM_BASE, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

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
