// GHL Workflow integration.
//
// Strategy: tag-based triggers.
// Bourbomedia adds canonical tags to the GHL contact whenever a meaningful
// event happens. The user configures GHL workflows once that listen for
// these tags and decide what to send (SMS, WhatsApp, Email) and when.
// This keeps message templates editable in GHL (no redeploy needed) and lets
// the user customize delays / conditions on their side.
//
// As a bonus, when a workflow ID is known (via GHL_WORKFLOW_ID_<EVENT>
// env var), we also add the contact directly to the workflow.

import { ghlRequest } from './ghl';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';

export type WorkflowEvent =
  | 'onboarding_started'
  | 'contract_signed'
  | 'payment_received'
  | 'call_booked'
  | 'prospect_awaiting_signature'  // closing terminé → envoyer le lien d'onboarding
  | 'script_ready'         // script sent to client for review
  | 'script_changes_requested'
  | 'script_validated'
  | 'filming_scheduled'
  | 'filming_reminder'     // J-1 before filming
  | 'video_delivered'
  | 'feedback_requested'   // a few days after delivery
  | 'project_published';

interface WorkflowDef {
  /** Stable canonical tag — also serves as the GHL trigger key */
  tag: string;
  /** Short human label for the admin doc page */
  label: string;
  /** What channel(s) the user typically wires up in GHL */
  channels: ('email' | 'whatsapp' | 'sms')[];
  /** When this fires */
  trigger: string;
  /** Recommended copy hint for the user when configuring the workflow */
  copyHint: string;
}

export const WORKFLOWS: Record<WorkflowEvent, WorkflowDef> = {
  onboarding_started: {
    tag: 'bbm_onboarding_started', label: 'Onboarding démarré',
    channels: ['email'], trigger: 'Le client crée son compte sur le portail',
    copyHint: 'Bienvenue, voici comment se passe l\'onboarding…',
  },
  contract_signed: {
    tag: 'bbm_contract_signed', label: 'Contrat signé',
    channels: ['email', 'whatsapp'], trigger: 'Le client a signé le contrat',
    copyHint: 'Merci ! Prochaine étape : le paiement.',
  },
  payment_received: {
    tag: 'bbm_payment_received', label: 'Paiement reçu',
    channels: ['email'], trigger: 'Stripe webhook confirme le paiement',
    copyHint: 'Votre paiement a bien été reçu. Voici votre facture.',
  },
  call_booked: {
    tag: 'bbm_call_booked', label: 'Appel onboarding réservé',
    channels: ['whatsapp', 'email'], trigger: 'Le client choisit un créneau d\'appel',
    copyHint: 'Votre appel est prévu le {date}. À bientôt !',
  },
  prospect_awaiting_signature: {
    tag: 'bbm_prospect_awaiting_signature', label: 'Closing OK — envoi onboarding',
    channels: ['email', 'whatsapp'], trigger: 'Le call closing est terminé, le prospect doit signer + payer',
    copyHint: 'Merci pour cet échange ! Voici le lien pour finaliser : {onboarding_url}',
  },
  script_ready: {
    tag: 'bbm_script_ready', label: 'Script à relire',
    channels: ['whatsapp', 'email'], trigger: 'L\'équipe envoie le script au client',
    copyHint: 'Votre script est prêt — voici votre lien : {portal_url}',
  },
  script_changes_requested: {
    tag: 'bbm_script_changes_requested', label: 'Modifications script demandées',
    channels: ['whatsapp'], trigger: 'Le client envoie des annotations',
    copyHint: 'Bien reçu, on retravaille le script et on revient vite vers vous.',
  },
  script_validated: {
    tag: 'bbm_script_validated', label: 'Script validé',
    channels: ['whatsapp', 'email'], trigger: 'Le client valide son script',
    copyHint: 'Bravo ! On planifie le tournage et on vous tient informé·e.',
  },
  filming_scheduled: {
    tag: 'bbm_filming_scheduled', label: 'Tournage planifié',
    channels: ['whatsapp', 'email'], trigger: 'Une date de tournage est confirmée',
    copyHint: 'Tournage confirmé pour le {filming_date}. À très vite !',
  },
  filming_reminder: {
    tag: 'bbm_filming_reminder', label: 'Rappel J-1 tournage',
    channels: ['whatsapp', 'sms'], trigger: 'Le cron Bourbomedia détecte un tournage demain',
    copyHint: 'Petit rappel : on tourne demain à {time} ! Pensez à {checklist}.',
  },
  video_delivered: {
    tag: 'bbm_video_delivered', label: 'Vidéo livrée',
    channels: ['whatsapp', 'email'], trigger: 'L\'équipe livre la vidéo finale',
    copyHint: '🎬 Votre vidéo est prête ! Découvrez-la : {portal_url}',
  },
  feedback_requested: {
    tag: 'bbm_feedback_requested', label: 'Demande d\'avis',
    channels: ['whatsapp', 'email'], trigger: '3 jours après livraison vidéo',
    copyHint: 'Comment se passe la suite ? Votre retour compte beaucoup.',
  },
  project_published: {
    tag: 'bbm_project_published', label: 'Projet publié',
    channels: ['email'], trigger: 'Le client confirme la publication',
    copyHint: 'Félicitations pour la sortie ! Voilà comment maximiser sa portée.',
  },
};

/** Add a tag to the contact — fires any GHL workflow listening on it. */
async function addContactTag(contactId: string, tag: string): Promise<boolean> {
  if (!GHL_API_KEY || !contactId) return false;
  try {
    await ghlRequest('POST', `/contacts/${contactId}/tags`, { tags: [tag] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Optionally add the contact directly to a workflow by ID.
 * The workflow ID is read from the env var GHL_WORKFLOW_ID_<EVENT_UPPER>.
 * Falls back silently if not configured.
 */
async function addContactToConfiguredWorkflow(contactId: string, event: WorkflowEvent): Promise<boolean> {
  if (!GHL_API_KEY || !contactId) return false;
  const envKey = `GHL_WORKFLOW_ID_${event.toUpperCase()}`;
  const workflowId = process.env[envKey];
  if (!workflowId) return false;
  try {
    await ghlRequest('POST', `/contacts/${contactId}/workflow/${workflowId}`, {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger a workflow event for a GHL contact.
 * Combines the tag-add (universal) with optional direct workflow-add.
 * Non-blocking: returns false if anything failed but never throws.
 *
 * Honors the global AUTOMATIONS_PAUSED kill switch — when "true", no GHL
 * tags or workflow additions are made. Use this to silence all client-facing
 * SMS/WhatsApp/Email automations while keeping internal Slack alerts and
 * in-app notifications working.
 */
export async function triggerWorkflow(contactId: string | null | undefined, event: WorkflowEvent): Promise<{ tagged: boolean; workflowAdded: boolean; paused?: boolean }> {
  if (process.env.AUTOMATIONS_PAUSED === 'true') {
    return { tagged: false, workflowAdded: false, paused: true };
  }
  if (!contactId || !GHL_API_KEY) return { tagged: false, workflowAdded: false };
  const def = WORKFLOWS[event];
  if (!def) return { tagged: false, workflowAdded: false };
  const [tagged, workflowAdded] = await Promise.all([
    addContactTag(contactId, def.tag),
    addContactToConfiguredWorkflow(contactId, event),
  ]);
  return { tagged, workflowAdded };
}

/** List the workflows on the connected GHL location (admin diagnostic page). */
export async function listGhlWorkflows(): Promise<Array<{ id: string; name: string; status?: string }>> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) return [];
  try {
    const data = await ghlRequest('GET', `/workflows/?locationId=${GHL_LOCATION_ID}`);
    return (data?.workflows || []).map((w: { id: string; name: string; status?: string }) => ({
      id: w.id, name: w.name, status: w.status,
    }));
  } catch {
    return [];
  }
}
