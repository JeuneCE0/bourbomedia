'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface AnnotationReply {
  id: string;
  author_type: 'client' | 'admin';
  author_name: string;
  text: string;
  created_at: string;
}

export interface Annotation {
  id: string;
  quote: string;
  note: string;
  pos_from?: number | null;
  pos_to?: number | null;
  resolved: boolean;
  author_name?: string | null;
  author_type: 'client' | 'admin';
  created_at: string;
  script_version?: number | null;
  replies?: AnnotationReply[];
}

interface Props {
  content: Record<string, unknown> | null;
  annotations: Annotation[];
  onCreate?: (a: { quote: string; note: string; pos_from: number; pos_to: number }) => Promise<void> | void;
  onUpdate?: (id: string, fields: { note?: string; resolved?: boolean; add_reply?: string }) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  /** Show the "Reply" form on each annotation card */
  canReply?: boolean;
  // When true, the user can highlight text and add new annotations.
  // When false (admin view), annotations are read-only with a "Mark as resolved" action.
  canAnnotate?: boolean;
  // When true, hides the "Mark resolved" button (e.g. on the client side).
  hideResolveButton?: boolean;
  emptyHint?: string;
}

/**
 * Read-only TipTap editor with Google-Docs-style highlight + comment support.
 * Selecting text shows a floating "Annoter" button. Clicking opens a popover
 * to add a note. All annotations show on the right (or below on mobile) as a
 * sidebar. Highlighted ranges in the editor are clickable and scroll their
 * sidebar card into view.
 */
export default function ScriptAnnotator({
  content,
  annotations,
  onCreate,
  onUpdate,
  onDelete,
  canAnnotate = false,
  canReply = false,
  hideResolveButton = false,
  emptyHint,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Color,
      TextStyle,
    ],
    content: content || undefined,
    editable: false,
  });

  // Re-set content when prop changes
  useEffect(() => {
    if (!editor || !content) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(content)) return;
    editor.commands.setContent(content as Parameters<typeof editor.commands.setContent>[0], { emitUpdate: false });
  }, [content, editor]);

  // Apply highlights for active (non-resolved) annotations whenever the set changes
  useEffect(() => {
    if (!editor) return;
    // Strip every existing highlight first
    editor.chain().focus().selectAll().unsetHighlight().setTextSelection(0).run();
    // Re-apply for each annotation with a known range
    annotations.forEach(a => {
      if (a.resolved) return;
      if (typeof a.pos_from !== 'number' || typeof a.pos_to !== 'number') return;
      try {
        editor.chain()
          .setTextSelection({ from: a.pos_from, to: a.pos_to })
          .setHighlight({ color: '#FACC15' })
          .run();
      } catch { /* position out of range — ignore */ }
    });
    // Reset cursor
    editor.chain().setTextSelection(0).blur().run();
  }, [editor, annotations]);

  // Track text selection to show the floating annotate button
  const containerRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<{ x: number; y: number; from: number; to: number; quote: string } | null>(null);
  const [draftFor, setDraftFor] = useState<{ from: number; to: number; quote: string } | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!editor || !canAnnotate) return;
    const handler = () => {
      const sel = editor.state.selection;
      if (sel.empty) {
        setFloating(null);
        return;
      }
      const text = editor.state.doc.textBetween(sel.from, sel.to, ' ', ' ').trim();
      if (!text || text.length < 2) {
        setFloating(null);
        return;
      }
      // Compute a viewport position for the floating button
      try {
        const range = window.getSelection()?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!rect || !containerRect) return;
        setFloating({
          x: rect.left + rect.width / 2 - containerRect.left,
          y: rect.top - containerRect.top - 8,
          from: sel.from,
          to: sel.to,
          quote: text,
        });
      } catch { /* */ }
    };
    editor.on('selectionUpdate', handler);
    return () => { editor.off('selectionUpdate', handler); };
  }, [editor, canAnnotate]);

  const openDraft = useCallback(() => {
    if (!floating) return;
    setDraftFor({ from: floating.from, to: floating.to, quote: floating.quote });
    setDraftNote('');
    setFloating(null);
  }, [floating]);

  const submitDraft = useCallback(async () => {
    if (!draftFor || !draftNote.trim() || !onCreate) return;
    setSubmitting(true);
    try {
      await onCreate({
        quote: draftFor.quote,
        note: draftNote.trim(),
        pos_from: draftFor.from,
        pos_to: draftFor.to,
      });
      setDraftFor(null);
      setDraftNote('');
    } finally {
      setSubmitting(false);
    }
  }, [draftFor, draftNote, onCreate]);

  // Split annotations: open vs resolved
  const { openAnnotations, resolvedAnnotations } = useMemo(() => {
    const open = annotations.filter(a => !a.resolved).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const resolved = annotations.filter(a => a.resolved).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { openAnnotations: open, resolvedAnnotations: resolved };
  }, [annotations]);

  const [showResolved, setShowResolved] = useState(false);

  if (!editor) return null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: 16,
    }}>
      <style>{`
        .bm-annotator-mobile-hide { display: block; }
        @media (min-width: 980px) {
          .bm-annotator-grid { grid-template-columns: 1fr 320px !important; }
        }
      `}</style>

      <div className="bm-annotator-grid" style={{
        display: 'grid', gap: 16, gridTemplateColumns: '1fr',
      }}>
        {/* Editor (read-only) */}
        <div ref={containerRef} style={{
          position: 'relative',
          background: 'var(--night-card)',
          border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,0,0,.25)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', background: 'var(--night-mid)',
            borderBottom: '1px solid var(--border)',
            fontSize: '0.74rem', color: 'var(--text-muted)',
          }}>
            <span aria-hidden>{canAnnotate ? '🖍️' : '🔒'}</span>
            {canAnnotate
              ? 'Sélectionnez un passage du script pour le commenter'
              : 'Lecture seule'}
          </div>
          <div style={{ background: 'var(--night-card)' }}>
            <EditorContent editor={editor} />
          </div>

          {/* Floating "Annotate" button on selection — Google Docs style */}
          {canAnnotate && floating && !draftFor && (
            <button
              // preventDefault on mouseDown so the editor selection isn't blurred
              onMouseDown={e => e.preventDefault()}
              onClick={openDraft}
              style={{
                position: 'absolute',
                left: Math.max(10, Math.min(floating.x - 75, (containerRef.current?.clientWidth || 600) - 160)),
                top: Math.max(48, floating.y),
                transform: 'translateY(-100%)',
                background: 'linear-gradient(135deg, var(--orange), #C9541E)',
                color: '#fff',
                border: '2px solid rgba(255,255,255,.15)',
                borderRadius: 999,
                padding: '9px 18px',
                fontSize: '0.85rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(232,105,43,.55), 0 2px 6px rgba(0,0,0,.3)',
                zIndex: 50,
                whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
                animation: 'bm-annot-pop .18s ease-out',
                letterSpacing: 0.2,
              }}
            >
              <span aria-hidden style={{ fontSize: '1.05rem' }}>💬</span> Annoter ce passage
              <style>{`
                @keyframes bm-annot-pop {
                  from { transform: translateY(-100%) scale(.85); opacity: 0; }
                  to   { transform: translateY(-100%) scale(1);    opacity: 1; }
                }
              `}</style>
            </button>
          )}

          {/* Draft popover — anchored near the selection (not full-screen) */}
          {canAnnotate && draftFor && (() => {
            const containerW = containerRef.current?.clientWidth || 600;
            const popW = Math.min(440, containerW - 32);
            const anchorX = floating?.x ?? containerW / 2;
            const anchorY = floating?.y ?? 80;
            const left = Math.max(16, Math.min(anchorX - popW / 2, containerW - popW - 16));
            return (
              <>
                {/* Soft scrim */}
                <div onClick={() => setDraftFor(null)} style={{
                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 55,
                  backdropFilter: 'blur(2px)',
                }} />
                <div onClick={e => e.stopPropagation()} style={{
                  position: 'absolute', left, top: Math.max(60, anchorY + 18),
                  width: popW, zIndex: 60,
                  background: 'var(--night-raised)', border: '1px solid var(--border-orange)',
                  borderRadius: 14, padding: 16,
                  boxShadow: '0 16px 48px rgba(0,0,0,.6)',
                  animation: 'bm-pop-slide .2s ease-out',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden style={{ fontSize: '1rem' }}>💬</span> Votre commentaire
                    </span>
                    <button onClick={() => setDraftFor(null)} style={{
                      background: 'transparent', border: 'none', color: 'var(--text-muted)',
                      fontSize: '1.1rem', cursor: 'pointer', padding: 4, lineHeight: 1,
                    }} aria-label="Fermer">✕</button>
                  </div>
                  <blockquote style={{
                    borderLeft: '3px solid var(--yellow)', padding: '8px 12px', margin: '0 0 12px',
                    background: 'rgba(250,204,21,.08)', borderRadius: '0 8px 8px 0',
                    fontSize: '0.8rem', color: 'var(--text-mid)', fontStyle: 'italic',
                    maxHeight: 80, overflowY: 'auto',
                  }}>
                    « {draftFor.quote.length > 200 ? draftFor.quote.slice(0, 200) + '…' : draftFor.quote} »
                  </blockquote>
                  <textarea
                    value={draftNote}
                    onChange={e => setDraftNote(e.target.value)}
                    onKeyDown={e => {
                      // Ctrl/Cmd+Enter to submit
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitDraft();
                      if (e.key === 'Escape') setDraftFor(null);
                    }}
                    placeholder="Que voulez-vous changer ?"
                    rows={3}
                    autoFocus
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                      borderRadius: 8, background: 'var(--night-mid)',
                      border: '1px solid var(--border-md)', color: 'var(--text)',
                      fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flex: 1 }}>
                      ⌘/Ctrl + ↵ pour valider
                    </span>
                    <button onClick={() => setDraftFor(null)} style={{
                      padding: '7px 14px', borderRadius: 8, background: 'transparent',
                      border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                      cursor: 'pointer', fontSize: '0.78rem',
                    }}>Annuler</button>
                    <button
                      onClick={submitDraft}
                      disabled={!draftNote.trim() || submitting}
                      style={{
                        padding: '7px 16px', borderRadius: 8, background: 'var(--orange)',
                        color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.78rem',
                        fontWeight: 700, opacity: !draftNote.trim() || submitting ? 0.5 : 1,
                      }}
                    >
                      {submitting ? '⏳ Envoi…' : '💾 Enregistrer'}
                    </button>
                  </div>
                  <style>{`
                    @keyframes bm-pop-slide {
                      from { transform: translateY(-6px); opacity: 0; }
                      to   { transform: translateY(0);     opacity: 1; }
                    }
                  `}</style>
                </div>
              </>
            );
          })()}
        </div>

        {/* Sidebar */}
        <aside style={{
          background: 'var(--night-card)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
          maxHeight: 600, overflowY: 'auto',
        }}>
          <div style={{
            fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden>💬</span> Annotations
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {openAnnotations.length} ouverte{openAnnotations.length !== 1 ? 's' : ''}
            </span>
          </div>

          {openAnnotations.length === 0 && resolvedAnnotations.length === 0 ? (
            <div style={{
              padding: '22px 14px', textAlign: 'center',
              fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5,
              background: 'var(--night-mid)', borderRadius: 10,
              border: '1px dashed var(--border-md)',
            }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 6 }} aria-hidden>✨</div>
              {emptyHint || (canAnnotate
                ? 'Sélectionnez n\'importe quel passage du script pour y attacher un commentaire.'
                : 'Aucune annotation pour le moment.')}
            </div>
          ) : (
            <>
              {openAnnotations.map(a => (
                <AnnotationCard
                  key={a.id}
                  annotation={a}
                  onUpdate={onUpdate}
                  onDelete={canAnnotate && a.author_type === 'client' ? onDelete : undefined}
                  hideResolveButton={hideResolveButton}
                  canEdit={canAnnotate && a.author_type === 'client'}
                  canReply={canReply || canAnnotate}
                />
              ))}

              {resolvedAnnotations.length > 0 && (
                <>
                  <button
                    onClick={() => setShowResolved(s => !s)}
                    style={{
                      marginTop: 4, padding: '8px 12px', borderRadius: 8,
                      background: 'transparent', border: '1px dashed var(--border-md)',
                      color: 'var(--text-muted)', cursor: 'pointer',
                      fontSize: '0.74rem', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden>{showResolved ? '▼' : '▶'}</span>
                      Résolues
                    </span>
                    <span style={{
                      background: 'var(--night-mid)', color: 'var(--text-muted)',
                      borderRadius: 999, padding: '1px 7px', fontSize: '0.66rem',
                    }}>{resolvedAnnotations.length}</span>
                  </button>
                  {showResolved && resolvedAnnotations.map(a => (
                    <AnnotationCard
                      key={a.id}
                      annotation={a}
                      onUpdate={onUpdate}
                      onDelete={canAnnotate && a.author_type === 'client' ? onDelete : undefined}
                      hideResolveButton={hideResolveButton}
                      canEdit={canAnnotate && a.author_type === 'client'}
                      canReply={canReply || canAnnotate}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function AnnotationCard({
  annotation: a, onUpdate, onDelete, hideResolveButton, canEdit, canReply,
}: {
  annotation: Annotation;
  onUpdate?: Props['onUpdate'];
  onDelete?: Props['onDelete'];
  hideResolveButton?: boolean;
  canEdit?: boolean;
  canReply?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.note);
  const [busy, setBusy] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);

  const save = async () => {
    if (!onUpdate || !draft.trim()) return;
    setBusy(true);
    try {
      await onUpdate(a.id, { note: draft.trim() });
      setEditing(false);
    } finally { setBusy(false); }
  };

  const toggleResolve = async () => {
    if (!onUpdate) return;
    setBusy(true);
    try { await onUpdate(a.id, { resolved: !a.resolved }); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!onDelete) return;
    if (!confirm('Supprimer ce commentaire ?')) return;
    setBusy(true);
    try { await onDelete(a.id); }
    finally { setBusy(false); }
  };

  const submitReply = async () => {
    if (!onUpdate || !replyDraft.trim()) return;
    setBusy(true);
    try {
      await onUpdate(a.id, { add_reply: replyDraft.trim() });
      setReplyDraft('');
      setReplying(false);
    } finally { setBusy(false); }
  };

  const replies = a.replies || [];

  return (
    <div style={{
      padding: 12, borderRadius: 10,
      background: a.resolved ? 'var(--night-mid)' : 'rgba(250,204,21,.06)',
      border: `1px solid ${a.resolved ? 'var(--border)' : 'rgba(250,204,21,.30)'}`,
      opacity: a.resolved ? 0.7 : 1,
    }}>
      <blockquote style={{
        borderLeft: `3px solid ${a.resolved ? 'var(--border-md)' : 'var(--yellow)'}`,
        padding: '4px 10px', margin: '0 0 8px',
        fontSize: '0.74rem', color: 'var(--text-mid)', fontStyle: 'italic',
        background: 'rgba(0,0,0,.15)', borderRadius: '0 6px 6px 0',
        maxHeight: 60, overflowY: 'auto',
      }}>
        « {a.quote} »
      </blockquote>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              borderRadius: 6, background: 'var(--night)',
              border: '1px solid var(--border-md)', color: 'var(--text)',
              fontSize: '0.82rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => { setEditing(false); setDraft(a.note); }} style={smallBtn('ghost')}>Annuler</button>
            <button onClick={save} disabled={busy || !draft.trim()} style={smallBtn('primary')}>
              {busy ? '⏳' : '💾'} Enregistrer
            </button>
          </div>
        </>
      ) : (
        <p style={{ fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.5, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>
          {a.note}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.66rem', color: 'var(--text-muted)' }}>
        <span>
          {a.author_type === 'client' ? '👤 ' : '🛠️ '}
          {a.author_name || (a.author_type === 'client' ? 'Client' : 'Admin')}
          {' · '}
          {new Date(a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} title="Modifier" style={iconBtn}>✏️</button>
          )}
          {canEdit && onDelete && !editing && (
            <button onClick={remove} title="Supprimer" disabled={busy} style={iconBtn}>🗑️</button>
          )}
          {!hideResolveButton && (
            <button onClick={toggleResolve} title={a.resolved ? 'Réouvrir' : 'Marquer comme résolu'} disabled={busy} style={iconBtn}>
              {a.resolved ? '🔄' : '✅'}
            </button>
          )}
        </div>
      </div>

      {/* Replies thread */}
      {(replies.length > 0 || (canReply && !a.resolved)) && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-md)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {replies.map(rep => (
            <div key={rep.id} style={{
              padding: '7px 10px', borderRadius: 8,
              background: rep.author_type === 'admin' ? 'rgba(232,105,43,.08)' : 'var(--night-mid)',
              borderLeft: `3px solid ${rep.author_type === 'admin' ? 'var(--orange)' : 'var(--text-muted)'}`,
            }}>
              <div style={{ fontSize: '0.7rem', color: rep.author_type === 'admin' ? 'var(--orange)' : 'var(--text-mid)', fontWeight: 700, marginBottom: 2 }}>
                {rep.author_type === 'admin' ? '🛠️ ' : '👤 '}{rep.author_name}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
                  · {new Date(rep.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.45, margin: 0, whiteSpace: 'pre-wrap' }}>
                {rep.text}
              </p>
            </div>
          ))}
          {canReply && !a.resolved && (
            replying ? (
              <div style={{ marginTop: 4 }}>
                <textarea
                  autoFocus
                  rows={2}
                  value={replyDraft}
                  onChange={e => setReplyDraft(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitReply();
                    if (e.key === 'Escape') { setReplying(false); setReplyDraft(''); }
                  }}
                  placeholder="Écrire une réponse… (⌘/Ctrl + ↵ pour envoyer)"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6,
                    background: 'var(--night)', border: '1px solid var(--border-md)', color: 'var(--text)',
                    fontSize: '0.78rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 5, marginTop: 4, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setReplying(false); setReplyDraft(''); }} style={smallBtn('ghost')}>Annuler</button>
                  <button onClick={submitReply} disabled={busy || !replyDraft.trim()} style={smallBtn('primary')}>
                    {busy ? '⏳' : '📤'} Répondre
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setReplying(true)} style={{
                background: 'transparent', border: 'none', color: 'var(--orange)',
                cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                padding: '4px 0', textAlign: 'left', alignSelf: 'flex-start',
              }}>
                💬 Répondre
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: '0.85rem', padding: 4, lineHeight: 1,
  borderRadius: 4,
};

function smallBtn(variant: 'primary' | 'ghost'): React.CSSProperties {
  if (variant === 'primary') {
    return {
      padding: '6px 12px', borderRadius: 6, background: 'var(--orange)',
      color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700,
    };
  }
  return {
    padding: '6px 12px', borderRadius: 6, background: 'transparent',
    border: '1px solid var(--border-md)', color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: '0.76rem',
  };
}
