// Saved views (filtres persistés) pour Pipeline / Clients / etc.
// Stocké en localStorage par scope (ex: 'pipeline-commerciale', 'clients-list').
//
// Chaque vue contient un objet de filtres opaque (la shape dépend de la page
// qui consomme). On laisse la page définir son schema → on stocke en blob.

export interface SavedView<F = Record<string, unknown>> {
  id: string;
  name: string;
  emoji: string;
  filters: F;
  createdAt: number;
}

function key(scope: string): string {
  return `bbm_views_${scope}_v1`;
}

export function loadViews<F = Record<string, unknown>>(scope: string): SavedView<F>[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(scope));
    return raw ? JSON.parse(raw) as SavedView<F>[] : [];
  } catch { return []; }
}

export function saveViews<F = Record<string, unknown>>(scope: string, views: SavedView<F>[]) {
  try { localStorage.setItem(key(scope), JSON.stringify(views)); } catch { /* */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bbm-views-changed', { detail: { scope } }));
  }
}

export function addView<F = Record<string, unknown>>(scope: string, view: Omit<SavedView<F>, 'id' | 'createdAt'>): SavedView<F> {
  const list = loadViews<F>(scope);
  const v: SavedView<F> = {
    ...view,
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    createdAt: Date.now(),
  };
  saveViews(scope, [v, ...list]);
  return v;
}

export function deleteView(scope: string, id: string) {
  const list = loadViews(scope);
  saveViews(scope, list.filter(v => v.id !== id));
}
