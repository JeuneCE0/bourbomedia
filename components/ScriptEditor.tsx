'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useCallback } from 'react';

interface ScriptEditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => void;
  saving?: boolean;
  readOnly?: boolean;
}

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

  const handleSave = useCallback(() => {
    if (editor) onSave(editor.getJSON() as Record<string, unknown>);
  }, [editor, onSave]);

  if (!editor) return null;

  return (
    <div>
      {!readOnly && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 12px',
          background: 'var(--night-mid)', borderRadius: '10px 10px 0 0',
          borderBottom: '1px solid var(--border)',
        }}>
          <ToolBtn label="B" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} style={{ fontWeight: 700 }} />
          <ToolBtn label="I" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} style={{ fontStyle: 'italic' }} />
          <ToolBtn label="U" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} style={{ textDecoration: 'underline' }} />
          <ToolBtn label="S" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} style={{ textDecoration: 'line-through' }} />
          <div style={{ width: 1, background: 'var(--border-md)', margin: '0 4px' }} />
          <ToolBtn label="H1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
          <ToolBtn label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <ToolBtn label="H3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <div style={{ width: 1, background: 'var(--border-md)', margin: '0 4px' }} />
          <ToolBtn label="•" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolBtn label="1." active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <ToolBtn label="❝" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <div style={{ width: 1, background: 'var(--border-md)', margin: '0 4px' }} />
          <ToolBtn label="◧" onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} />
          <ToolBtn label="◫" onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} />
          <ToolBtn label="◨" onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} />
          <div style={{ width: 1, background: 'var(--border-md)', margin: '0 4px' }} />
          <ToolBtn label="✦" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} />

          <div style={{ flex: 1 }} />
          <button onClick={handleSave} disabled={saving} style={{
            padding: '5px 14px', borderRadius: 6, background: 'var(--orange)',
            color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.75rem',
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Sauvegarde…' : 'Sauvegarder'}</button>
        </div>
      )}

      <div style={{
        background: 'var(--night-card)',
        border: '1px solid var(--border)',
        borderRadius: readOnly ? 10 : '0 0 10px 10px',
        minHeight: 300,
      }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolBtn({ label, active, onClick, style }: { label: string; active?: boolean; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
      fontSize: '0.8rem', minWidth: 28,
      background: active ? 'rgba(232,105,43,.2)' : 'transparent',
      color: active ? 'var(--orange)' : 'var(--text-mid)',
      ...style,
    }}>{label}</button>
  );
}
