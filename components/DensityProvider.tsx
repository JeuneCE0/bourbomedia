'use client';

import { useEffect, useState, useCallback, createContext, useContext } from 'react';

export type Density = 'compact' | 'comfort' | 'spacious';

const STORAGE_KEY = 'bbm_density_v1';

interface Ctx {
  density: Density;
  setDensity: (d: Density) => void;
}

const DensityContext = createContext<Ctx>({ density: 'comfort', setDensity: () => {} });

export function useDensity() { return useContext(DensityContext); }

// Applique les CSS vars sur <html> selon le mode. Les composants existants
// peuvent les utiliser via var(--bm-density-pad-*) sans refactor massif.
function applyToDocument(d: Density) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  // Ratios : compact 0.75, comfort 1, spacious 1.25
  const r = d === 'compact' ? 0.75 : d === 'spacious' ? 1.25 : 1;
  html.style.setProperty('--bm-density', d);
  html.style.setProperty('--bm-density-ratio', String(r));
  html.style.setProperty('--bm-density-pad-sm', `${Math.round(8 * r)}px`);
  html.style.setProperty('--bm-density-pad-md', `${Math.round(14 * r)}px`);
  html.style.setProperty('--bm-density-pad-lg', `${Math.round(20 * r)}px`);
  html.style.setProperty('--bm-density-gap', `${Math.round(12 * r)}px`);
  html.style.setProperty('--bm-density-text-base', d === 'compact' ? '13.5px' : d === 'spacious' ? '15.5px' : '14.5px');
  html.dataset.density = d;
}

export default function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfort');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(STORAGE_KEY) as Density | null;
    if (saved && ['compact', 'comfort', 'spacious'].includes(saved)) {
      setDensityState(saved);
      applyToDocument(saved);
    } else {
      applyToDocument('comfort');
    }
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    applyToDocument(d);
    try { localStorage.setItem(STORAGE_KEY, d); } catch { /* */ }
  }, []);

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

// Composant prêt à mettre dans Settings
export function DensityToggle() {
  const { density, setDensity } = useDensity();
  const opts: { value: Density; label: string; emoji: string; hint: string }[] = [
    { value: 'compact', label: 'Compact', emoji: '🗜️', hint: 'Plus dense — voir plus de lignes' },
    { value: 'comfort', label: 'Confort', emoji: '☕', hint: 'Équilibré (défaut)' },
    { value: 'spacious', label: 'Spacieux', emoji: '🌿', hint: 'Plus aéré — moins fatigant' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {opts.map(o => {
          const active = density === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setDensity(o.value)}
              style={{
                flex: '1 1 120px', padding: '12px 14px', borderRadius: 10,
                background: active ? 'rgba(232,105,43,.12)' : 'var(--night-mid)',
                border: `1.5px solid ${active ? 'var(--orange)' : 'var(--border-md)'}`,
                color: active ? 'var(--text)' : 'var(--text-mid)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span aria-hidden style={{ fontSize: '1.1rem' }}>{o.emoji}</span>
                <strong style={{ fontSize: '0.88rem' }}>{o.label}</strong>
                {active && <span style={{ marginLeft: 'auto', color: 'var(--orange)', fontSize: '0.78rem' }}>✓</span>}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{o.hint}</div>
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
        💡 La densité s&apos;applique aux espacements et tailles de texte sur tout le dashboard.
        Préférence stockée par appareil.
      </p>
    </div>
  );
}
