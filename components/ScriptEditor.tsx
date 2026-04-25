'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useCallback, useState, useEffect, useRef } from 'react';

interface ScriptEditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => void;
  saving?: boolean;
  readOnly?: boolean;
  /** Auto-save with this debounce delay (ms). Disabled if undefined or 0. */
  autoSaveMs?: number;
  /** Optional client context passed to the AI assist endpoint */
  aiContext?: { business_name?: string; category?: string; city?: string };
}

type AiAction = 'rewrite' | 'shorten' | 'expand' | 'hook' | 'cta' | 'fix';

const AI_ACTIONS: { key: AiAction; label: string; emoji: string; description: string; needsSelection: boolean }[] = [
  { key: 'rewrite',  label: 'Reformuler',     emoji: '✨', description: 'Reformule la sélection pour qu\'elle sonne mieux à l\'oral', needsSelection: true },
  { key: 'shorten',  label: 'Raccourcir',     emoji: '✂️', description: 'Réduit la sélection de 30 à 50%', needsSelection: true },
  { key: 'expand',   label: 'Étoffer',        emoji: '📝', description: 'Ajoute un détail ou une émotion', needsSelection: true },
  { key: 'fix',      label: 'Corriger fautes', emoji: '🔠', description: 'Corrige uniquement les erreurs (sans réécrire)', needsSelection: true },
  { key: 'hook',     label: 'Suggérer accroche', emoji: '🎯', description: 'Génère une accroche d\'ouverture', needsSelection: false },
  { key: 'cta',      label: 'Suggérer CTA',   emoji: '🚀', description: 'Génère un appel à l\'action de fin', needsSelection: false },
];

/* ── word count helper ── */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/* ── separator between button groups ── */
function Sep() {
  return (
    <div
      aria-hidden
      style={{
        width: 1,
        alignSelf: 'stretch',
        margin: '4px 6px',
        background: 'var(--border-md)',
        borderRadius: 1,
      }}
    />
  );
}

/* ── toolbar button ── */
function ToolBtn({
  label,
  tooltip,
  active,
  onClick,
  style,
}: {
  label: string;
  tooltip: string;
  active?: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={tooltip}
      aria-label={tooltip}
      style={{
        position: 'relative',
        padding: '5px 9px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        fontSize: '0.82rem',
        lineHeight: 1.2,
        minWidth: 30,
        textAlign: 'center',
        fontFamily: 'inherit',
        transition: 'background .15s, color .15s, box-shadow .15s',
        background: active
          ? 'rgba(232,105,43,.22)'
          : hovered
            ? 'rgba(255,255,255,.07)'
            : 'transparent',
        color: active ? 'var(--orange)' : 'var(--text-mid)',
        boxShadow: active ? 'inset 0 0 0 1.5px var(--border-orange)' : 'none',
        fontWeight: active ? 700 : 500,
        ...style,
      }}
    >
      {label}
    </button>
  );
}

/* ── save‑feedback toast ── */
function SaveToast({ visible }: { visible: boolean }) {
  return (
    <span
      style={{
        position: 'absolute',
        right: 12,
        top: '50%',
        transform: `translateY(-50%) translateX(${visible ? '0' : '8px'})`,
        opacity: visible ? 1 : 0,
        transition: 'opacity .3s, transform .3s',
        pointerEvents: 'none',
        fontSize: '0.72rem',
        fontWeight: 600,
        color: 'var(--green)',
        whiteSpace: 'nowrap',
      }}
    >
      ✓ Sauvegardé !
    </span>
  );
}

/* ── main editor ── */
export default function ScriptEditor({ content, onSave, saving, readOnly, autoSaveMs, aiContext }: ScriptEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Commencez à écrire le script…' }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Color,
      TextStyle,
    ],
    content: content || undefined,
    editable: !readOnly,
  });

  // Sync editor when the parent passes a new `content` prop
  // (e.g. after a save round-trip or version load). useEditor only reads
  // `content` on mount, so we manually setContent on prop changes.
  useEffect(() => {
    if (!editor) return;
    if (!content) return;
    const current = editor.getJSON();
    // Avoid resetting if nothing actually changed (would lose cursor)
    if (JSON.stringify(current) === JSON.stringify(content)) return;
    editor.commands.setContent(content as Parameters<typeof editor.commands.setContent>[0], { emitUpdate: false });
  }, [content, editor]);

  const [wordCount, setWordCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [autoStatus, setAutoStatus] = useState<'idle' | 'pending' | 'saved'>('idle');
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ action: AiAction; original: string; suggested: string; from: number; to: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  /* keep word count + auto-save in sync */
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setWordCount(countWords(editor.getText()));
      // Auto-save logic
      if (!autoSaveMs || readOnly) return;
      const json = JSON.stringify(editor.getJSON());
      if (json === lastSavedRef.current) return;
      setAutoStatus('pending');
      if (autoTimer.current) clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(() => {
        const payload = editor.getJSON() as Record<string, unknown>;
        lastSavedRef.current = JSON.stringify(payload);
        onSave(payload);
        setAutoStatus('saved');
        setTimeout(() => setAutoStatus(prev => prev === 'saved' ? 'idle' : prev), 2200);
      }, autoSaveMs);
    };
    update();
    editor.on('update', update);
    return () => {
      editor.off('update', update);
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [editor, autoSaveMs, readOnly, onSave]);

  // Initialise lastSavedRef when content prop changes (e.g. after parent re-fetch)
  useEffect(() => {
    if (content) lastSavedRef.current = JSON.stringify(content);
  }, [content]);

  const handleSave = useCallback(() => {
    if (!editor) return;
    const payload = editor.getJSON() as Record<string, unknown>;
    lastSavedRef.current = JSON.stringify(payload);
    onSave(payload);
    /* show toast */
    setShowToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShowToast(false), 2000);
  }, [editor, onSave]);

  const runAi = useCallback(async (action: AiAction) => {
    if (!editor) return;
    setAiMenuOpen(false);

    const sel = editor.state.selection;
    const meta = AI_ACTIONS.find(a => a.key === action);
    if (!meta) return;

    let from = sel.from;
    let to = sel.to;
    let selected = editor.state.doc.textBetween(from, to, ' ', ' ').trim();

    if (meta.needsSelection && !selected) {
      alert('Sélectionnez d\'abord un passage du script à modifier.');
      return;
    }
    // For hook/cta without selection, pass nearby context (~first/last 200 chars)
    if (!meta.needsSelection && !selected) {
      const all = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ');
      selected = action === 'hook' ? all.slice(0, 400) : all.slice(-400);
      from = action === 'hook' ? 1 : Math.max(1, editor.state.doc.content.size - 1);
      to = from;
    }

    setAiBusy(true);
    try {
      const r = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('bbp_token') || '' : ''}` },
        body: JSON.stringify({ action, text: selected, ...(aiContext || {}) }),
      });
      const data = await r.json();
      if (!r.ok) {
        alert(data.error || 'Erreur IA');
        return;
      }
      setAiPreview({ action, original: selected, suggested: data.text, from, to });
    } catch (e) {
      alert((e as Error).message || 'Erreur IA');
    } finally {
      setAiBusy(false);
    }
  }, [editor, aiContext]);

  const acceptAiSuggestion = useCallback(() => {
    if (!editor || !aiPreview) return;
    const meta = AI_ACTIONS.find(a => a.key === aiPreview.action);
    if (!meta) return;

    if (meta.needsSelection) {
      // Replace the selection with the suggestion
      editor.chain().focus().setTextSelection({ from: aiPreview.from, to: aiPreview.to }).insertContent(aiPreview.suggested).run();
    } else if (aiPreview.action === 'hook') {
      // Insert at the very top
      editor.chain().focus().setTextSelection(1).insertContent(aiPreview.suggested + '\n\n').run();
    } else {
      // CTA: insert at the very end
      editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).insertContent('\n\n' + aiPreview.suggested).run();
    }
    setAiPreview(null);
  }, [editor, aiPreview]);

  if (!editor) return null;

  /* ── wrapper ── */
  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    borderRadius: 12,
    border: '1px solid var(--border)',
    boxShadow: '0 2px 12px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.03)',
    overflow: 'hidden',
  };

  /* ── toolbar ── */
  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 3,
    padding: '7px 10px',
    background: 'var(--night-mid)',
    borderBottom: '1px solid var(--border)',
  };

  /* ── editor area ── */
  const editorAreaStyle: React.CSSProperties = {
    background: 'var(--night-card)',
    minHeight: 300,
  };

  /* ── status bar ── */
  const statusBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 14px',
    background: 'var(--night-mid)',
    borderTop: '1px solid var(--border)',
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    userSelect: 'none',
  };

  /* heading button shared style */
  const hStyle: React.CSSProperties = { fontWeight: 700, letterSpacing: '-0.03em' };

  return (
    <div style={wrapperStyle}>
      {/* read-only indicator */}
      {readOnly && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            background: 'var(--night-mid)',
            borderBottom: '1px solid var(--border)',
            fontSize: '0.72rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ opacity: 0.7 }}>🔒</span>
          Lecture seule
        </div>
      )}

      {/* toolbar */}
      {!readOnly && (
        <div style={toolbarStyle}>
          {/* ── text formatting ── */}
          <ToolBtn
            label="𝐁"
            tooltip="Gras"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolBtn
            label="𝐼"
            tooltip="Italique"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolBtn
            label="U̲"
            tooltip="Souligné"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolBtn
            label="S̶"
            tooltip="Barré"
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />

          <Sep />

          {/* ── headings ── */}
          <ToolBtn
            label="H1"
            tooltip="Titre 1"
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            style={{ ...hStyle, fontSize: '0.88rem' }}
          />
          <ToolBtn
            label="H2"
            tooltip="Titre 2"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            style={{ ...hStyle, fontSize: '0.82rem' }}
          />
          <ToolBtn
            label="H3"
            tooltip="Titre 3"
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            style={{ ...hStyle, fontSize: '0.76rem' }}
          />

          <Sep />

          {/* ── lists & quote ── */}
          <ToolBtn
            label="•"
            tooltip="Liste à puces"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            style={{ fontSize: '1rem' }}
          />
          <ToolBtn
            label="1."
            tooltip="Liste numérotée"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolBtn
            label="❝"
            tooltip="Citation"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            style={{ fontSize: '0.95rem' }}
          />

          <Sep />

          {/* ── alignment ── */}
          <ToolBtn
            label="◧"
            tooltip="Aligner à gauche"
            active={editor.isActive({ textAlign: 'left' })}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
          />
          <ToolBtn
            label="◫"
            tooltip="Centrer"
            active={editor.isActive({ textAlign: 'center' })}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
          />
          <ToolBtn
            label="◨"
            tooltip="Aligner à droite"
            active={editor.isActive({ textAlign: 'right' })}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
          />

          <Sep />

          {/* ── highlight ── */}
          <ToolBtn
            label="✦"
            tooltip="Surligner"
            active={editor.isActive('highlight')}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          />

          {/* spacer */}
          <div style={{ flex: 1 }} />

          {/* ── AI assist menu ── */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setAiMenuOpen(o => !o)}
              disabled={aiBusy}
              title="Assistance IA"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 8,
                background: aiBusy ? 'var(--night-mid)' : 'rgba(168,85,247,.18)',
                color: aiBusy ? 'var(--text-muted)' : '#D8B4FE',
                border: '1px solid rgba(168,85,247,.45)',
                fontWeight: 700, fontSize: '0.75rem', cursor: aiBusy ? 'wait' : 'pointer',
                marginRight: 6,
              }}
            >
              {aiBusy ? '⏳ IA…' : '✨ IA'}
            </button>
            {aiMenuOpen && !aiBusy && (
              <>
                <div onClick={() => setAiMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 101,
                  background: 'var(--night-raised)', border: '1px solid var(--border-md)',
                  borderRadius: 10, padding: 6, minWidth: 250,
                  boxShadow: '0 12px 32px rgba(0,0,0,.5)',
                }}>
                  {AI_ACTIONS.map(a => (
                    <button
                      key={a.key}
                      onClick={() => runAi(a.key)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '8px 10px', borderRadius: 8, border: 'none',
                        background: 'transparent', color: 'var(--text)',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--night-mid)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1.2, flexShrink: 0 }}>{a.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>{a.label}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{a.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── save button ── */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <SaveToast visible={showToast && !saving} />
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 16px',
                borderRadius: 8,
                background: saving ? 'var(--orange-dark)' : 'var(--orange)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.75rem',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
                transition: 'background .2s, opacity .2s, transform .1s',
                letterSpacing: '0.01em',
              }}
            >
              {saving ? (
                <>
                  <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '0.85rem' }}>⟳</span>
                  Sauvegarde…
                </>
              ) : (
                <>
                  <span style={{ fontSize: '0.85rem' }}>✓</span>
                  Sauvegarder
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* editor content */}
      <div style={editorAreaStyle}>
        <EditorContent editor={editor} />
      </div>

      {/* status bar with word count + auto-save indicator */}
      <div style={statusBarStyle}>
        <span>{wordCount} mot{wordCount !== 1 ? 's' : ''}</span>
        {!readOnly && autoSaveMs ? (
          <span style={{
            color: autoStatus === 'saved' ? 'var(--green)' : autoStatus === 'pending' ? 'var(--yellow)' : 'var(--text-muted)',
            fontStyle: autoStatus === 'idle' ? 'italic' : 'normal',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }} aria-live="polite">
            {autoStatus === 'pending' && <>⏳ Auto-save…</>}
            {autoStatus === 'saved' && <>✅ Sauvegardé automatiquement</>}
            {autoStatus === 'idle' && <>💾 Auto-save activé</>}
          </span>
        ) : readOnly ? (
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Lecture seule</span>
        ) : null}
      </div>

      {/* AI suggestion preview modal */}
      {aiPreview && (
        <div onClick={() => setAiPreview(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--night-raised)', border: '1px solid rgba(168,85,247,.45)',
            borderRadius: 14, padding: 22, maxWidth: 720, width: '100%',
            maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>✨</span>
                Suggestion IA — {AI_ACTIONS.find(a => a.key === aiPreview.action)?.label}
              </h3>
              <button onClick={() => setAiPreview(null)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: '1.2rem', cursor: 'pointer', padding: 4, lineHeight: 1,
              }} aria-label="Fermer">✕</button>
            </div>

            {AI_ACTIONS.find(a => a.key === aiPreview.action)?.needsSelection && (
              <>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Original
                </div>
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid var(--border)',
                  fontSize: '0.85rem', color: 'var(--text-mid)', lineHeight: 1.6,
                  marginBottom: 14, whiteSpace: 'pre-wrap',
                  maxHeight: 160, overflowY: 'auto',
                }}>
                  {aiPreview.original}
                </div>
              </>
            )}

            <div style={{ fontSize: '0.7rem', color: '#D8B4FE', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Suggestion
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.35)',
              fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.6,
              marginBottom: 16, whiteSpace: 'pre-wrap',
              maxHeight: 240, overflowY: 'auto',
            }}>
              {aiPreview.suggested}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setAiPreview(null)} style={{
                padding: '9px 16px', borderRadius: 8, background: 'transparent',
                border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
              }}>Annuler</button>
              <button onClick={() => runAi(aiPreview.action)} style={{
                padding: '9px 16px', borderRadius: 8, background: 'var(--night-card)',
                border: '1px solid var(--border-md)', color: 'var(--text)',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
              }}>🔄 Régénérer</button>
              <button onClick={acceptAiSuggestion} style={{
                padding: '9px 18px', borderRadius: 8, background: '#A855F7',
                border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700,
                boxShadow: '0 4px 14px rgba(168,85,247,.4)',
              }}>
                ✅ {AI_ACTIONS.find(a => a.key === aiPreview.action)?.needsSelection ? 'Remplacer' : 'Insérer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* inline keyframes for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
