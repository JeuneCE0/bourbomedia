'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface Message {
  id: string;
  scope_type: string;
  scope_id: string;
  author_id: string | null;
  author_name: string;
  body: string;
  mentions: string[] | null;
  created_at: string;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

function getCurrentAuthorName(): string {
  if (typeof window === 'undefined') return 'Admin';
  return localStorage.getItem('bbp_author_name') || 'Admin';
}

function setCurrentAuthorName(name: string) {
  try { localStorage.setItem('bbp_author_name', name); } catch { /* */ }
}

export default function ThreadPanel({
  scopeType, scopeId, title = '💬 Notes internes',
}: { scopeType: 'client' | 'opportunity'; scopeId: string; title?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [authorName, setAuthorName] = useState(getCurrentAuthorName());
  const [editingName, setEditingName] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!scopeId) return;
    try {
      const r = await fetch(`/api/threads?scope_type=${scopeType}&scope_id=${encodeURIComponent(scopeId)}`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setMessages(Array.isArray(d.messages) ? d.messages : []);
      }
    } finally { setLoading(false); }
  }, [scopeType, scopeId]);

  useEffect(() => { load(); }, [load]);
  // Auto-refresh 10s
  useEffect(() => {
    const t = setInterval(() => load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-scroll en bas quand nouveaux messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    try {
      const r = await fetch('/api/threads', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ scope_type: scopeType, scope_id: scopeId, body: text, author_name: authorName }),
      });
      if (r.ok) {
        setDraft('');
        await load();
      }
    } finally { setPosting(false); }
  }

  async function deleteMessage(id: string) {
    if (!confirm('Supprimer ce message ?')) return;
    await fetch(`/api/threads?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    await load();
  }

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      maxHeight: 480,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        paddingBottom: 8, borderBottom: '1px solid var(--border)',
      }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </h3>
        {!editingName ? (
          <button onClick={() => setEditingName(true)} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '0.7rem', cursor: 'pointer', padding: 0,
          }} title="Changer le nom affiché">
            ✏️ Vous : <strong style={{ color: 'var(--orange)' }}>{authorName}</strong>
          </button>
        ) : (
          <input
            autoFocus
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            onBlur={() => { setCurrentAuthorName(authorName); setEditingName(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { setCurrentAuthorName(authorName); setEditingName(false); } }}
            style={{
              fontSize: '0.74rem', padding: '3px 8px', borderRadius: 5,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', outline: 'none', width: 100,
            }}
          />
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
        minHeight: 100, maxHeight: 320,
      }}>
        {loading ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.78rem' }}>Chargement…</div>
        ) : messages.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', fontStyle: 'italic' }}>
            Aucune note interne — démarre la conversation 👇
          </div>
        ) : messages.map(m => {
          const isMe = m.author_name === authorName;
          return (
            <div key={m.id} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: isMe ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '85%', padding: '8px 11px', borderRadius: 10,
                background: isMe ? 'rgba(232,105,43,.12)' : 'var(--night-mid)',
                border: `1px solid ${isMe ? 'rgba(232,105,43,.25)' : 'var(--border)'}`,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2,
                  fontSize: '0.66rem', color: 'var(--text-muted)',
                }}>
                  <strong style={{ color: isMe ? 'var(--orange)' : 'var(--text)', fontSize: '0.72rem' }}>{m.author_name}</strong>
                  <span>{relTime(m.created_at)}</span>
                  {isMe && (
                    <button onClick={() => deleteMessage(m.id)} title="Supprimer" style={{
                      background: 'transparent', border: 'none', color: 'var(--text-muted)',
                      cursor: 'pointer', fontSize: '0.7rem', padding: 0, marginLeft: 4,
                    }}>×</button>
                  )}
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {renderBodyWithMentions(m.body)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <form onSubmit={e => { e.preventDefault(); send(); }} style={{
        display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)',
      }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          placeholder="Note interne… (⌘+Entrée pour envoyer · @Rudy pour mentionner)"
          rows={2}
          style={{
            flex: 1, padding: '8px 11px', borderRadius: 8,
            background: 'var(--night-mid)', border: '1px solid var(--border-md)',
            color: 'var(--text)', fontSize: '0.84rem', resize: 'none',
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button type="submit" disabled={posting || !draft.trim()} style={{
          padding: '0 14px', borderRadius: 8, background: 'var(--orange)',
          border: 'none', color: '#fff', cursor: posting ? 'wait' : 'pointer',
          fontSize: '0.82rem', fontWeight: 700, opacity: posting || !draft.trim() ? 0.5 : 1,
        }}>{posting ? '⏳' : 'Envoyer'}</button>
      </form>
    </div>
  );
}

function renderBodyWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\w+)/g);
  return parts.map((p, i) => {
    if (p.match(/^@\w+$/)) {
      return <span key={i} style={{ color: 'var(--orange)', fontWeight: 600 }}>{p}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}
