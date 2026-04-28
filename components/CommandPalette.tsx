'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  type: 'client' | 'script' | 'comment' | 'script_content' | 'opportunity' | 'payment';
  id: string;
  client_id: string;
  title: string;
  subtitle: string;
  status?: string;
  href?: string;
}

interface PaletteAction {
  id: string;
  emoji: string;
  label: string;
  hint?: string;
  keywords: string[];
  shortcut?: string[];
  run: () => void;
}

const TYPE_META: Record<SearchResult['type'], { emoji: string; bg: string; color: string; label: string }> = {
  client:         { emoji: '👤', bg: 'rgba(232,105,43,.12)',  color: 'var(--orange)', label: 'Client' },
  script:         { emoji: '📝', bg: 'rgba(250,204,21,.12)',  color: 'var(--yellow)', label: 'Script' },
  script_content: { emoji: '🔍', bg: 'rgba(250,204,21,.12)',  color: 'var(--yellow)', label: 'Contenu' },
  comment:        { emoji: '💬', bg: 'rgba(139,92,246,.12)',  color: '#8B5CF6',       label: 'Commentaire' },
  opportunity:    { emoji: '🎯', bg: 'rgba(20,184,166,.12)',  color: '#14B8A6',       label: 'Prospect' },
  payment:        { emoji: '💸', bg: 'rgba(34,197,94,.12)',   color: 'var(--green)',  label: 'Paiement' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function resultHref(r: SearchResult): string {
  if (r.href) return r.href;
  if (r.type === 'opportunity') return r.client_id ? `/dashboard/clients/${r.client_id}?tab=ghl` : '/dashboard/pipeline';
  if (r.type === 'payment') return r.client_id ? `/dashboard/clients/${r.client_id}?tab=payments` : '/dashboard/finance';
  if (!r.client_id) return '/dashboard';
  if (r.type === 'script' || r.type === 'script_content' || r.type === 'comment') return `/dashboard/clients/${r.client_id}?tab=script`;
  return `/dashboard/clients/${r.client_id}`;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Actions globales (toujours visibles + filtrées par query)
  const ACTIONS: PaletteAction[] = [
    { id: 'go-dashboard', emoji: '🏠', label: 'Aller au Dashboard', keywords: ['accueil', 'home', 'dashboard'], run: () => router.push('/dashboard') },
    { id: 'go-pipeline', emoji: '🌊', label: 'Pipeline & clients', keywords: ['prospects', 'pipeline', 'clients', 'kanban'], run: () => router.push('/dashboard/pipeline') },
    { id: 'go-tasks', emoji: '✅', label: 'Mes tâches', keywords: ['tasks', 'tâches', 'todo'], run: () => router.push('/dashboard/tasks') },
    { id: 'go-scripts', emoji: '📝', label: 'Scripts', keywords: ['scripts'], run: () => router.push('/dashboard/scripts') },
    { id: 'go-calendar', emoji: '📅', label: 'Calendrier', keywords: ['calendar', 'agenda', 'rdv'], run: () => router.push('/dashboard/calendar') },
    { id: 'go-finance', emoji: '💰', label: 'Finances', keywords: ['ca', 'finances', 'argent', 'paiements'], run: () => router.push('/dashboard/finance') },
    { id: 'go-stats', emoji: '📈', label: 'Statistiques', keywords: ['stats', 'analytics', 'kpi'], run: () => router.push('/dashboard/stats') },
    { id: 'go-settings', emoji: '⚙️', label: 'Paramètres', keywords: ['settings', 'paramètres', 'config'], run: () => router.push('/dashboard/settings') },
    { id: 'open-copilot', emoji: '✨', label: 'Ouvrir AI Co-Pilot', shortcut: ['⌘', 'J'], keywords: ['ai', 'ia', 'copilot', 'claude'], run: () => {
      // Trigger event utilisé par AiCopilot.tsx (qui écoute ⌘J en interne)
      // → simulate la touche
      const evt = new KeyboardEvent('keydown', { key: 'j', metaKey: true, ctrlKey: true });
      document.dispatchEvent(evt);
    }},
    { id: 'sync-stripe', emoji: '💳', label: 'Sync Stripe', hint: 'Importe les paiements 90j', keywords: ['stripe', 'sync', 'import', 'paiements'], run: () => router.push('/dashboard/settings?tab=data') },
    { id: 'sync-ghl', emoji: '📄', label: 'Sync factures GHL', hint: 'Importe les factures 180j', keywords: ['ghl', 'sync', 'factures', 'invoices'], run: () => router.push('/dashboard/settings?tab=data') },
    { id: 'open-cheatsheet', emoji: '⌨️', label: 'Raccourcis clavier', shortcut: ['?'], keywords: ['shortcuts', 'help', 'aide', 'raccourcis'], run: () => {
      // Simulate ?
      setTimeout(() => {
        const evt = new KeyboardEvent('keydown', { key: '?' });
        document.dispatchEvent(evt);
      }, 50);
    }},
    { id: 'today', emoji: '📞', label: "Voir les RDV d'aujourd'hui", keywords: ['today', "aujourd'hui", 'appels', 'rdv'], run: () => router.push('/dashboard') },
  ];

  // Toggle ⌘K + Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset query + focus quand on ouvre
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Recherche serveur (debounce 200ms)
  useEffect(() => {
    if (!open || query.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          setResults(Array.isArray(d) ? d : []);
        }
      } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  // Filtre les actions par query (matching simple sur label + keywords)
  const filteredActions = (() => {
    const q = query.toLowerCase().trim();
    if (!q) return ACTIONS;
    return ACTIONS.filter(a =>
      a.label.toLowerCase().includes(q)
      || a.keywords.some(k => k.toLowerCase().includes(q))
    );
  })();

  // Liste totale ordonnée : actions d'abord puis search results
  const allItems = [
    ...filteredActions.map(a => ({ kind: 'action' as const, action: a })),
    ...results.map(r => ({ kind: 'result' as const, result: r })),
  ];

  // Reset l'index actif quand la liste change
  useEffect(() => { setActiveIdx(0); }, [query, results.length, filteredActions.length]);

  function pickItem(idx: number) {
    const item = allItems[idx];
    if (!item) return;
    setOpen(false);
    if (item.kind === 'action') item.action.run();
    else router.push(resultHref(item.result));
  }

  // Keyboard nav (↑↓ Enter)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, allItems.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); pickItem(activeIdx); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allItems.length, activeIdx]);

  if (!open) return null;

  // Group items for display (actions + results)
  const showActions = filteredActions.length > 0;
  const showResults = results.length > 0;

  return (
    <>
      <div onClick={() => setOpen(false)} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(4px)', zIndex: 1300,
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: '15%', transform: 'translateX(-50%)',
        zIndex: 1301, width: 'min(640px, calc(100vw - 32px))',
        background: 'var(--night-card)', borderRadius: 14,
        border: '1px solid var(--border-md)',
        boxShadow: '0 24px 60px rgba(0,0,0,.55)',
        animation: 'bm-modal-pop 200ms cubic-bezier(.4,1.3,.6,1)',
        overflow: 'hidden',
      }}>
        {/* Search input */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span aria-hidden style={{ fontSize: '1.1rem' }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher ou exécuter une action…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: '1rem', padding: 0,
            }}
          />
          <kbd style={{
            padding: '2px 7px', borderRadius: 5,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace',
          }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: 6 }}>
          {showActions && (
            <>
              <SectionHeader>
                {query.length < 2 ? 'Actions rapides' : 'Actions'}
              </SectionHeader>
              {filteredActions.map((a, i) => (
                <PaletteRow
                  key={a.id}
                  active={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => pickItem(i)}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.95rem',
                    fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                  }}>{a.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 600 }}>
                      {a.label}
                    </div>
                    {a.hint && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.hint}</div>
                    )}
                  </div>
                  {a.shortcut && (
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                      {a.shortcut.map((k, j) => (
                        <kbd key={j} style={{
                          padding: '1px 5px', borderRadius: 4,
                          background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                          fontSize: '0.66rem', color: 'var(--text-muted)', fontFamily: 'monospace',
                        }}>{k}</kbd>
                      ))}
                    </div>
                  )}
                </PaletteRow>
              ))}
            </>
          )}

          {showResults && (
            <>
              <SectionHeader>Résultats ({results.length})</SectionHeader>
              {results.map((r, i) => {
                const idx = filteredActions.length + i;
                const meta = TYPE_META[r.type];
                return (
                  <PaletteRow
                    key={`${r.type}-${r.id}`}
                    active={idx === activeIdx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => pickItem(idx)}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                      background: meta.bg, color: meta.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.9rem',
                      fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
                    }}>{meta.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.86rem', color: 'var(--text)', fontWeight: 600,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.title}</div>
                      <div style={{
                        fontSize: '0.72rem', color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.subtitle}</div>
                    </div>
                    <span style={{
                      fontSize: '0.66rem', color: meta.color,
                      padding: '2px 8px', borderRadius: 999,
                      background: meta.bg, fontWeight: 700, flexShrink: 0,
                    }}>{meta.label}</span>
                  </PaletteRow>
                );
              })}
            </>
          )}

          {!showActions && !showResults && (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {loading ? '🔍 Recherche…' : query.length < 2 ? 'Tape au moins 2 caractères ou utilise les actions rapides' : 'Aucun résultat'}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 14px', borderTop: '1px solid var(--border)',
          background: 'var(--night-mid)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.7rem', color: 'var(--text-muted)',
        }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span><kbd style={kbdMini}>↑↓</kbd> naviguer</span>
            <span><kbd style={kbdMini}>↵</kbd> ouvrir</span>
          </div>
          <span><kbd style={kbdMini}>⌘K</kbd> pour rouvrir</span>
        </div>
      </div>
    </>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '8px 12px 4px', fontSize: '0.66rem', color: 'var(--text-muted)',
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>{children}</div>
  );
}

function PaletteRow({
  active, onClick, onMouseEnter, children,
}: { active: boolean; onClick: () => void; onMouseEnter: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        width: '100%', padding: '9px 12px', borderRadius: 8,
        background: active ? 'var(--night-mid)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        color: 'inherit',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      {children}
    </button>
  );
}

const kbdMini: React.CSSProperties = {
  padding: '1px 5px', borderRadius: 4,
  background: 'var(--night-card)', border: '1px solid var(--border-md)',
  fontSize: '0.66rem', color: 'var(--text-muted)', fontFamily: 'monospace',
};
