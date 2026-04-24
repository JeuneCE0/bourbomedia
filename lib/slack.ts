const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: { type: string; text: string }[];
  fields?: { type: string; text: string }[];
}

export async function sendSlackNotification(message: SlackMessage): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) return false;
  try {
    const r = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function notifyScriptValidated(clientName: string, contactName: string) {
  return sendSlackNotification({
    text: `Script validé — ${clientName}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Script validé', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Commerce:*\n${clientName}` },
        { type: 'mrkdwn', text: `*Contact:*\n${contactName}` },
      ]},
      { type: 'context', elements: [
        { type: 'mrkdwn', text: 'Le client a validé son script. Tournage à planifier.' },
      ]},
    ],
  });
}

export function notifyFilmingScheduled(clientName: string, date: string) {
  const formatted = new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return sendSlackNotification({
    text: `Tournage planifié — ${clientName} le ${formatted}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Tournage planifié', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Commerce:*\n${clientName}` },
        { type: 'mrkdwn', text: `*Date:*\n${formatted}` },
      ]},
    ],
  });
}

export function notifyNewComment(clientName: string, authorName: string, authorType: string, commentPreview: string) {
  return sendSlackNotification({
    text: `Nouveau commentaire sur ${clientName} par ${authorName}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Nouveau commentaire', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Commerce:*\n${clientName}` },
        { type: 'mrkdwn', text: `*Par:*\n${authorName} (${authorType})` },
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: `> ${commentPreview.slice(0, 200)}` } },
    ],
  });
}

export function notifyClientStatusChange(clientName: string, oldStatus: string, newStatus: string) {
  return sendSlackNotification({
    text: `${clientName}: ${oldStatus} → ${newStatus}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Changement de statut', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Commerce:*\n${clientName}` },
        { type: 'mrkdwn', text: `*Statut:*\n${oldStatus} → ${newStatus}` },
      ]},
    ],
  });
}

export function notifyTaskDeadline(clientName: string, taskText: string, dueDate: string) {
  const formatted = new Date(dueDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return sendSlackNotification({
    text: `⏰ Tâche en retard — ${clientName}: ${taskText}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '⏰ Rappel tâche', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Commerce:*\n${clientName}` },
        { type: 'mrkdwn', text: `*Deadline:*\n${formatted}` },
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: `> ${taskText.slice(0, 300)}` } },
    ],
  });
}

export function notifyPublished(clientName: string) {
  return sendSlackNotification({
    text: `Vidéo publiée — ${clientName}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Vidéo publiée', emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `La vidéo de *${clientName}* est en ligne !` } },
    ],
  });
}
