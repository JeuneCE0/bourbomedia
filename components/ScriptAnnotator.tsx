'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
}

interface Props {
  content: Record<string, unknown> | null;
  annotations: Annotation[];
  onCreate?: (a: { quote: string; note: string; pos_from: number; pos_to: number }) => Promise<void> | void;
  onUpdate?: (id: string, fields: { note?: string; resolved?: boolean }) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
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

  // Sort annotations: unresolved first, then by created_at
  const sortedAnnotations = useMemo(() => {
    const arr = [...annotations];
    arr.sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return a.created_at.localeCompare(b.created_at);
    });
    return arr;
  }, [annotations]);

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

          {/* Floating "Annotate" button on selection */}
          {canAnnotate && floating && (
            <button
              onClick={openDraft}
              style={{
                position: 'absolute',
                left: Math.max(10, floating.x - 60),
                top: Math.max(40, floating.y),
                transform: 'translateY(-100%)',
                background: 'var(--orange)',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                padding: '7px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 6px 16px rgba(0,0,0,.4)',
                zIndex: 50,
                whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span aria-hidden>💬</span> Annoter
            </button>
          )}

          {/* Draft popover */}
          {canAnnotate && draftFor && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,.55)', zIndex: 60,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              padding: 24,
            }} onClick={() => setDraftFor(null)}>
              <div onClick={e => e.stopPropagation()} style={{
                background: 'var(--night-raised)', border: '1px solid var(--border-orange)',
                borderRadius: 12, padding: 18, maxWidth: 460, width: '100%',
                boxShadow: '0 12px 40px rgba(0,0,0,.5)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
                    💬 Nouveau commentaire
                  </span>
                  <button onClick={() => setDraftFor(null)} style={{
                    background: 'transparent', border: 'none', color: 'var(--text-muted)',
                    fontSize: '1.1rem', cursor: 'pointer', padding: 4, lineHeight: 1,
                  }} aria-label="Fermer">✕</button>
                </div>
                <blockquote style={{
                  borderLeft: '3px solid var(--yellow)', padding: '6px 12px', margin: '0 0 12px',
                  background: 'rgba(250,204,21,.08)', borderRadius: '0 8px 8px 0',
                  fontSize: '0.82rem', color: 'var(--text-mid)', fontStyle: 'italic',
                  maxHeight: 80, overflowY: 'auto',
                }}>
                  « {draftFor.quote} »
                </blockquote>
                <textarea
                  value={draftNote}
                  onChange={e => setDraftNote(e.target.value)}
                  placeholder="Que faut-il modifier ? (ex: trop long, j'aimerais qu'on parle plutôt de…)"
                  rows={4}
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                    borderRadius: 8, background: 'var(--night-mid)',
                    border: '1px solid var(--border-md)', color: 'var(--text)',
                    fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button onClick={() => setDraftFor(null)} style={{
                    padding: '8px 16px', borderRadius: 8, background: 'transparent',
                    border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '0.82rem',
                  }}>Annuler</button>
                  <button
                    onClick={submitDraft}
                    disabled={!draftNote.trim() || submitting}
                    style={{
                      padding: '8px 18px', borderRadius: 8, background: 'var(--orange)',
                      color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.82rem',
                      fontWeight: 700, opacity: !draftNote.trim() || submitting ? 0.5 : 1,
                    }}
                  >
                    {submitting ? '⏳ Envoi…' : '💾 Enregistrer'}
                  </button>
                </div>
              </div>
            </div>
          )}
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
              {sortedAnnotations.filter(a => !a.resolved).length} ouvertes
            </span>
          </div>

          {sortedAnnotations.length === 0 ? (
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
            sortedAnnotations.map(a => (
              <AnnotationCard
                key={a.id}
                annotation={a}
                onUpdate={onUpdate}
                onDelete={canAnnotate && a.author_type === 'client' ? onDelete : undefined}
                hideResolveButton={hideResolveButton}
                canEdit={canAnnotate && a.author_type === 'client'}
              />
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function AnnotationCard({
  annotation: a, onUpdate, onDelete, hideResolveButton, canEdit,
}: {
  annotation: Annotation;
  onUpdate?: Props['onUpdate'];
  onDelete?: Props['onDelete'];
  hideResolveButton?: boolean;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.note);
  const [busy, setBusy] = useState(false);

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
