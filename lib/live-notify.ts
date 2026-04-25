// Cross-side helpers for "live" notifications: browser Notification API +
// short audio ping. Both are graceful no-ops when unsupported or refused.
//
// All functions are safe to call from React components — they bail on SSR.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try { audioCtx = new Ctor(); } catch { return null; }
  }
  return audioCtx;
}

/**
 * Play a short, pleasant two-tone "ping" (no asset file needed).
 * Total duration ~250ms, very subtle.
 */
export function playPing(volume = 0.18): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const tones = [880, 1318]; // A5 → E6
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.08;
      const end = start + 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    });
  } catch { /* ignore */ }
}

/**
 * Request browser notification permission idempotently. Resolves to the
 * current permission state.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/**
 * Show a desktop notification only when the document is hidden — no point
 * popping the OS toast when the user is already looking at the tab.
 */
export function notifyDesktop(title: string, body?: string, opts?: { icon?: string; tag?: string; url?: string }): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, {
      body, icon: opts?.icon || '/favicon.jpg', tag: opts?.tag,
    });
    if (opts?.url) {
      n.onclick = () => { window.focus(); window.open(opts.url, '_self'); };
    }
  } catch { /* ignore */ }
}

/**
 * Combined helper: toast hook + ping + desktop notif if backgrounded.
 */
export function fireLiveAlert(
  toastFn: ((emoji: string, message: string) => void) | undefined,
  emoji: string,
  message: string,
  opts?: { url?: string; tag?: string; sound?: boolean },
): void {
  if (toastFn) toastFn(emoji, message);
  if (opts?.sound !== false) playPing();
  notifyDesktop(message, undefined, { url: opts?.url, tag: opts?.tag });
}
