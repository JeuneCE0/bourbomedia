'use client';

import { useEffect, useState, useRef } from 'react';

interface PresenceUser { user_id: string; user_name: string; updated_at: string }

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return 'unknown';
  let id = localStorage.getItem('bbp_user_id');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('bbp_user_id', id); } catch { /* */ }
  }
  return id;
}

function getAuthorName(): string {
  if (typeof window === 'undefined') return 'Admin';
  return localStorage.getItem('bbp_author_name') || 'Admin';
}

// Hook : envoie un heartbeat toutes les 15s + cleanup au unmount.
export function usePresence(scope: string | null) {
  const userIdRef = useRef<string>('');
  const userNameRef = useRef<string>('');

  useEffect(() => {
    if (!scope) return;
    userIdRef.current = getOrCreateUserId();
    userNameRef.current = getAuthorName();

    let active = true;
    const beat = async () => {
      if (!active) return;
      try {
        await fetch('/api/presence', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ user_id: userIdRef.current, user_name: userNameRef.current, scope }),
        });
      } catch { /* */ }
    };
    beat(); // immédiat
    const t = setInterval(beat, 15_000);

    // Cleanup : retire l'entrée
    const remove = async () => {
      try {
        await fetch('/api/presence', {
          method: 'DELETE', headers: authHeaders(),
          body: JSON.stringify({ user_id: userIdRef.current, scope }),
          keepalive: true, // important pour que la requête survive au unload
        });
      } catch { /* */ }
    };
    window.addEventListener('beforeunload', remove);
    return () => {
      active = false;
      clearInterval(t);
      window.removeEventListener('beforeunload', remove);
      remove();
    };
  }, [scope]);
}

// Component : affiche les autres admins actuellement sur le scope.
export default function PresenceIndicator({ scope }: { scope: string | null }) {
  const [users, setUsers] = useState<PresenceUser[]>([]);

  // Heartbeat propre côté courant
  usePresence(scope);

  // Poll des autres présents toutes les 8s
  useEffect(() => {
    if (!scope) { setUsers([]); return; }
    const myId = getOrCreateUserId();
    let active = true;
    const fetchOthers = async () => {
      if (!active) return;
      try {
        const r = await fetch(`/api/presence?scope=${encodeURIComponent(scope)}&exclude_user_id=${encodeURIComponent(myId)}`, { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          setUsers(Array.isArray(d.users) ? d.users : []);
        }
      } catch { /* */ }
    };
    fetchOthers();
    const t = setInterval(fetchOthers, 8_000);
    return () => { active = false; clearInterval(t); };
  }, [scope]);

  if (users.length === 0) return null;

  // Affichage : pastille verte + initiales empilées + tooltip
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px 4px 6px', borderRadius: 999,
      background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.35)',
      fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600,
    }} title={users.map(u => u.user_name).join(', ') + ' regarde(nt) cette fiche'}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: 'var(--green)',
        animation: 'bm-pulse-soft 2s infinite',
      }} />
      <div style={{ display: 'flex' }}>
        {users.slice(0, 3).map((u, i) => (
          <span key={u.user_id} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            background: 'var(--night-mid)', color: 'var(--green)',
            fontSize: '0.62rem', fontWeight: 800,
            border: '1.5px solid var(--night-card)',
            marginLeft: i === 0 ? 0 : -6,
          }}>
            {u.user_name.charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <span>{users.length === 1 ? `${users[0].user_name} ici` : `${users.length} ici`}</span>
    </div>
  );
}
