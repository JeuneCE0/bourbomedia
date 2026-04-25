// Centralized emoji mapping for accessibility and consistency.
// Use <EmojiIcon emoji="..." label="..." /> instead of raw emojis in JSX
// when the emoji conveys meaning (not purely decorative).

export const EMOJI = {
  // Navigation
  dashboard: '🏠',
  pipeline: '📊',
  tasks: '✅',
  calendar: '📅',
  clients: '👥',
  team: '👤',
  scripts: '📝',
  onboarding: '🚀',

  // Statuses
  pending: '⏳',
  inProgress: '🟡',
  done: '🟢',
  blocked: '🚫',
  urgent: '🔴',
  warning: '🟠',
  success: '✅',
  error: '❌',
  info: 'ℹ️',

  // Actions
  add: '➕',
  edit: '✏️',
  delete: '🗑️',
  save: '💾',
  send: '📤',
  download: '⬇️',
  upload: '⬆️',
  open: '↗️',
  back: '↩️',
  refresh: '🔄',
  search: '🔍',
  filter: '⚙️',
  copy: '📋',
  print: '🖨️',
  link: '🔗',

  // Project / video
  video: '🎬',
  script: '📄',
  comments: '💬',
  documents: '📂',
  feedback: '⭐',
  filming: '🎥',
  edit_video: '🎞️',
  publish: '📺',
  contract: '✍️',
  payment: '💸',
  invoice: '🧾',
  notification: '🔔',
  email: '✉️',
  phone: '📞',

  // Steps
  step1: '1️⃣',
  step2: '2️⃣',
  step3: '3️⃣',
  step4: '4️⃣',
  step5: '5️⃣',
  step6: '6️⃣',
  step7: '7️⃣',
  step8: '8️⃣',

  // Feelings / celebration
  celebration: '🎉',
  rocket: '🚀',
  sparkle: '✨',
  heart: '❤️',
  thumbsUp: '👍',
  wave: '👋',
  hourglass: '⌛',
  clock: '🕐',
  pin: '📍',
  flag: '🚩',
  star: '⭐',
} as const;

export type EmojiKey = keyof typeof EMOJI;

/**
 * Pick the right emoji for a project stage / status string.
 */
export function emojiForStatus(status?: string | null): string {
  if (!status) return EMOJI.pending;
  const s = status.toLowerCase();
  if (s.includes('publi')) return EMOJI.publish;
  if (s.includes('livr') || s.includes('deliver') || s.includes('done') || s.includes('termin')) return EMOJI.done;
  if (s.includes('mont')) return EMOJI.edit_video;
  if (s.includes('tourn') || s.includes('film') || s.includes('shoot')) return EMOJI.filming;
  if (s.includes('valid') || s.includes('confirm')) return EMOJI.success;
  if (s.includes('modif')) return EMOJI.edit;
  if (s.includes('proposition') || s.includes('relec')) return EMOJI.script;
  if (s.includes('script')) return EMOJI.script;
  if (s.includes('paie') || s.includes('pay')) return EMOJI.payment;
  if (s.includes('contrat') || s.includes('contract')) return EMOJI.contract;
  if (s.includes('appel') || s.includes('call')) return EMOJI.phone;
  if (s.includes('inscri') || s.includes('compte') || s.includes('signup')) return EMOJI.wave;
  if (s.includes('block') || s.includes('bloqu')) return EMOJI.blocked;
  if (s.includes('urgent')) return EMOJI.urgent;
  if (s.includes('attente') || s.includes('pending')) return EMOJI.pending;
  return EMOJI.inProgress;
}
