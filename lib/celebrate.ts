// Triggers de célébration : confetti, "burst" de couleurs, easy-to-call
// depuis n'importe quel composant. SSR-safe.

import confetti from 'canvas-confetti';

// LocalStorage flag : empêche de retirer le confetti à chaque refresh sur le
// même statut. Clé scope par token client + étape.
const FIRED_KEY = 'bbm_celebrate_fired_v1';

function loadFired(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveFired(map: Record<string, number>) {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(map)); } catch { /* */ }
}

const PALETTE = ['#E8692B', '#FACC15', '#22C55E', '#3B82F6', '#A855F7', '#EC4899'];

export function fireBigCelebration() {
  if (typeof window === 'undefined') return;
  // 3 bursts successives + fontaine continue 2s
  const duration = 2500;
  const end = Date.now() + duration;

  // 2 cones depuis le bas-gauche et bas-droit
  (function frame() {
    confetti({
      particleCount: 4, angle: 60, spread: 65, startVelocity: 55,
      origin: { x: 0, y: 0.85 }, colors: PALETTE,
    });
    confetti({
      particleCount: 4, angle: 120, spread: 65, startVelocity: 55,
      origin: { x: 1, y: 0.85 }, colors: PALETTE,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();

  // Burst central immédiat (effet "POP")
  confetti({
    particleCount: 120, spread: 90, startVelocity: 45,
    origin: { x: 0.5, y: 0.5 }, colors: PALETTE,
    scalar: 1.2,
  });
}

export function fireSmallCelebration() {
  if (typeof window === 'undefined') return;
  confetti({
    particleCount: 60, spread: 70, startVelocity: 35,
    origin: { x: 0.5, y: 0.6 }, colors: PALETTE,
    scalar: 0.9,
  });
}

// Fire seulement si jamais firé pour ce (scope, key) tuple — utile pour ne pas
// rejouer la célébration à chaque refresh quand le client ouvre son portail.
// Returns true si la célébration a effectivement été tirée.
export function fireOnce(scope: string, key: string, big: boolean = true): boolean {
  if (typeof window === 'undefined') return false;
  const fullKey = `${scope}::${key}`;
  const map = loadFired();
  if (map[fullKey]) return false;
  map[fullKey] = Date.now();
  saveFired(map);
  if (big) fireBigCelebration(); else fireSmallCelebration();
  return true;
}

// Reset un flag (utile en debug ou si tu veux re-déclencher sur une nouvelle
// vidéo / publication).
export function resetCelebration(scope: string, key: string) {
  if (typeof window === 'undefined') return;
  const map = loadFired();
  delete map[`${scope}::${key}`];
  saveFired(map);
}
