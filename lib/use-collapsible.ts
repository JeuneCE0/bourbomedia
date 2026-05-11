'use client';

import { useCallback, useEffect, useState } from 'react';

// Hook de pliage / dépliage avec persistance localStorage. Utilisé sur
// tous les widgets du dashboard pour que l'admin puisse compacter ceux
// qu'il ne consulte pas régulièrement, sans perdre la préférence au
// refresh.
//
// Usage :
//   const { collapsed, toggle, ToggleChevron } = useCollapsiblePref('bbm_widget_today', false);
//   <button onClick={toggle}>Header {ToggleChevron}</button>
//   {!collapsed && <body />}
export function useCollapsiblePref(storageKey: string, defaultCollapsed = false): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
} {
  const [collapsed, setCollapsedState] = useState(defaultCollapsed);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === '1') setCollapsedState(true);
      else if (saved === '0') setCollapsedState(false);
    } catch { /* */ }
  }, [storageKey]);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { window.localStorage.setItem(storageKey, v ? '1' : '0'); } catch { /* */ }
  }, [storageKey]);

  const toggle = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* */ }
      return next;
    });
  }, [storageKey]);

  return { collapsed, toggle, setCollapsed };
}
