// Helpers de calcul de dates utilisés pour les ETAs du funnel onboarding
// (estimation de quand la prochaine étape sera atteinte). Pures fonctions,
// testables sans DOM.

// Ajoute N jours OUVRÉS (skip samedi + dimanche) à une date donnée.
// addBusinessDays(lundi, 1) = mardi
// addBusinessDays(vendredi, 1) = lundi suivant
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// Renvoie le prochain mardi ou jeudi STRICTEMENT après `from` (max 2
// semaines en avance pour ne pas boucler indéfiniment si la logique
// change). Utilisé pour estimer la prochaine date de publication possible.
export function nextPublicationSlot(from: Date): Date {
  const d = new Date(from);
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 2 || dow === 4) return new Date(d);
  }
  return d;
}

// Format date long avec weekday — "lundi 5 mai" / "mardi 12 mai".
// Localisé fr-FR systématiquement (le portail est mono-langue).
export function fmtDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
