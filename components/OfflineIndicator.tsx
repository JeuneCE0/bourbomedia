'use client';

import { useEffect, useState, useCallback } from 'react';
import { flushQueue, getQueue } from '@/lib/offline-queue';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const [lastFlush, setLastFlush] = useState<{ flushed: number; remaining: number; errors: string[] } | null>(null);

  const refreshQueue = useCallback(() => {
    setQueueSize(getQueue().length);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOnline(navigator.onLine);
    refreshQueue();
    const onOnline = () => { setOnline(true); doFlush(); };
    const onOffline = () => setOnline(false);
    const onQueueChange = () => refreshQueue();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('bbm-outbox-changed', onQueueChange);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('bbm-outbox-changed', onQueueChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doFlush() {
    if (flushing) return;
    setFlushing(true);
    try {
      const r = await flushQueue();
      setLastFlush(r);
      refreshQueue();
      if (r.flushed > 0) {
        // Timeout pour cacher le message après 4s
        setTimeout(() => setLastFlush(null), 4000);
      }
    } finally { setFlushing(false); }
  }

  // Pas d'indicator quand tout va bien et queue vide
  if (online && queueSize === 0 && !lastFlush) return null;

  // 3 états visuels :
  // 1. Offline : banner rouge
  // 2. Online + queue > 0 : banner orange "syncing N changements"
  // 3. Online + flush récent : toast vert "✓ N modifs synchronisées"

  if (!online) {
    return (
      <Banner emoji="📡" color="#EF4444" bg="rgba(239,68,68,.12)" border="rgba(239,68,68,.4)">
        <strong>Mode hors-ligne</strong>
        {queueSize > 0
          ? ` — ${queueSize} modification${queueSize > 1 ? 's' : ''} en attente de sync`
          : ' — tes modifs seront sauvegardées localement'}
      </Banner>
    );
  }

  if (queueSize > 0) {
    return (
      <Banner emoji="⏳" color="#FACC15" bg="rgba(250,204,21,.12)" border="rgba(250,204,21,.35)">
        <strong>{queueSize} modification{queueSize > 1 ? 's' : ''} en attente</strong>
        {' — '}
        <button onClick={doFlush} disabled={flushing} style={{
          background: 'transparent', border: 'none', color: 'var(--orange)',
          cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 'inherit', fontWeight: 600,
        }}>{flushing ? 'sync en cours…' : 'Synchroniser maintenant'}</button>
      </Banner>
    );
  }

  if (lastFlush && lastFlush.flushed > 0) {
    return (
      <Banner emoji="✅" color="var(--green)" bg="rgba(34,197,94,.12)" border="rgba(34,197,94,.35)">
        {lastFlush.flushed} modification{lastFlush.flushed > 1 ? 's' : ''} synchronisée{lastFlush.flushed > 1 ? 's' : ''}
        {lastFlush.errors.length > 0 && ` · ${lastFlush.errors.length} en erreur`}
      </Banner>
    );
  }

  return null;
}

function Banner({ children, emoji, color, bg, border }: {
  children: React.ReactNode; emoji: string; color: string; bg: string; border: string;
}) {
  return (
    <div style={{
      position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
      zIndex: 600, padding: '8px 16px', borderRadius: 999,
      background: bg, border: `1px solid ${border}`, color,
      fontSize: '0.78rem', fontWeight: 500, lineHeight: 1.4,
      maxWidth: 'calc(100vw - 32px)',
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 4px 12px rgba(0,0,0,.25)',
    }}>
      <span aria-hidden style={{ fontSize: '1rem' }}>{emoji}</span>
      <span>{children}</span>
    </div>
  );
}
