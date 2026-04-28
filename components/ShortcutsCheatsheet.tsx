'use client';

import { useEffect, useState } from 'react';

interface Shortcut {
  keys: string[];
  description: string;
  scope?: string;
}

const SHORTCUTS: { group: string; emoji: string; items: Shortcut[] }[] = [
  {
    group: 'Navigation',
    emoji: '🧭',
    items: [
      { keys: ['⌘', 'K'], description: 'Recherche globale + actions rapides' },
      { keys: ['⌘', 'J'], description: 'Ouvrir/fermer AI Co-Pilot' },
      { keys: ['?'], description: 'Afficher cette cheatsheet' },
      { keys: ['Esc'], description: 'Fermer modal / drawer / mode sélection' },
    ],
  },
  {
    group: 'Pipeline',
    emoji: '🌊',
    items: [
      { keys: ['⇧', 'Clic'], description: 'Sélectionner une plage de cards', scope: 'mode sélection' },
      { keys: ['⌘', 'A'], description: 'Sélectionner toutes les cards visibles', scope: 'mode sélection' },
    ],
  },
  {
    group: 'Closing Room',
    emoji: '🎯',
    items: [
      { keys: ['🎙️'], description: 'Bouton record vocal — transcription auto via Whisper' },
      { keys: ['✨'], description: 'Structurer notes brutes en synthèse via IA' },
    ],
  },
  {
    group: 'Inbox / cloche',
    emoji: '🔔',
    items: [
      { keys: ['✓'], description: 'Marquer comme lu' },
      { keys: ['😴'], description: 'Snoozer (1h / 3h / demain / lundi)' },
    ],
  },
];

export default function ShortcutsCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ? sans modifier ouvre la cheatsheet (sauf si user est en train de taper dans un input)
      const target = e.target as HTMLElement;
      const inEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '?' && !inEditable && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div onClick={() => setOpen(false)} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
        backdropFilter: 'blur(3px)', zIndex: 1500,
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 1501, width: 'min(560px, calc(100vw - 32px))',
        maxHeight: '85vh', overflowY: 'auto',
        background: 'var(--night-card)', borderRadius: 14,
        border: '1px solid var(--border-md)',
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        animation: 'bm-modal-pop 200ms cubic-bezier(.4,1.3,.6,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <h2 style={{
              fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', margin: 0,
              fontFamily: "'Bricolage Grotesque', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              ⌨️ Raccourcis clavier
            </h2>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Tape <kbd style={kbdInline}>?</kbd> pour ré-ouvrir, <kbd style={kbdInline}>Esc</kbd> pour fermer
            </p>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Fermer" style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {SHORTCUTS.map(group => (
            <div key={group.group}>
              <h3 style={{
                fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)',
                margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span aria-hidden>{group.emoji}</span> {group.group}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.items.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {s.keys.map((k, j) => (
                        <kbd key={j} style={kbdStyle}>{k}</kbd>
                      ))}
                    </div>
                    <span style={{ fontSize: '0.84rem', color: 'var(--text)', flex: 1 }}>
                      {s.description}
                      {s.scope && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginLeft: 6 }}>
                          ({s.scope})
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 26, height: 26, padding: '0 7px',
  fontSize: '0.78rem', fontWeight: 700, fontFamily: 'monospace',
  background: 'var(--night-raised)', border: '1px solid var(--border-md)',
  borderRadius: 6, color: 'var(--text)',
  boxShadow: 'inset 0 -1px 0 var(--border-md)',
};

const kbdInline: React.CSSProperties = {
  ...kbdStyle, minWidth: 20, height: 18, fontSize: '0.7rem', padding: '0 5px',
};
