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
}

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
export default function ScriptEditor({ content, onSave, saving, readOnly }: ScriptEditorProps) {
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* keep word count in sync */
  useEffect(() => {
    if (!editor) return;
    const update = () => setWordCount(countWords(editor.getText()));
    update();
    editor.on('update', update);
    return () => { editor.off('update', update); };
  }, [editor]);

  const handleSave = useCallback(() => {
    if (!editor) return;
    onSave(editor.getJSON() as Record<string, unknown>);
    /* show toast */
    setShowToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShowToast(false), 2000);
  }, [editor, onSave]);

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

      {/* status bar with word count */}
      <div style={statusBarStyle}>
        <span>{wordCount} mot{wordCount !== 1 ? 's' : ''}</span>
        {readOnly && <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Lecture seule</span>}
      </div>

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
