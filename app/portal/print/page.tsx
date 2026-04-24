'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';

interface Script {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  status: string;
  version: number;
  updated_at: string;
}

interface Client {
  business_name?: string;
  contact_name?: string;
}

function PrintContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [script, setScript] = useState<Script | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState('');

  const editor = useEditor({
    extensions: [StarterKit, Underline, TextAlign.configure({ types: ['heading', 'paragraph'] }), Highlight.configure({ multicolor: true }), Color, TextStyle],
    content: script?.content || undefined,
    editable: false,
  }, [script?.content]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/scripts?token=${token}`)
      .then(r => { if (!r.ok) throw new Error('Lien invalide'); return r.json(); })
      .then(d => {
        if (d && typeof d === 'object' && 'script' in d) {
          setScript(d.script);
          setClient(d.client || null);
        } else {
          setScript(d);
        }
      })
      .catch(e => setError(e.message));
  }, [token]);

  // Auto-trigger print once script is loaded
  useEffect(() => {
    if (script?.content) {
      const timer = setTimeout(() => window.print(), 600);
      return () => clearTimeout(timer);
    }
  }, [script]);

  if (!token) return <div style={{ padding: 40 }}>Token manquant</div>;
  if (error) return <div style={{ padding: 40, color: 'red' }}>{error}</div>;
  if (!script) return <div style={{ padding: 40 }}>Chargement…</div>;

  return (
    <div className="print-wrap">
      <style>{`
        body { background: #fff !important; color: #111 !important; margin: 0; }
        .print-wrap { max-width: 780px; margin: 0 auto; padding: 48px 56px; color: #111; font-family: 'Instrument Sans', Georgia, serif; font-size: 11pt; line-height: 1.6; }
        .print-header { border-bottom: 2px solid #E8692B; padding-bottom: 16px; margin-bottom: 28px; }
        .print-brand { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 18pt; color: #E8692B; margin: 0; }
        .print-meta { margin-top: 8px; font-size: 10pt; color: #666; display: flex; gap: 18px; flex-wrap: wrap; }
        .print-title { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 20pt; color: #111; margin: 0 0 6px; }
        .print-subtitle { font-size: 10pt; color: #666; margin: 0 0 28px; }
        .ProseMirror { outline: none; }
        .ProseMirror p { margin: 0 0 10px; }
        .ProseMirror h1 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 18pt; color: #111; margin: 20px 0 10px; font-weight: 700; }
        .ProseMirror h2 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 14pt; color: #111; margin: 18px 0 8px; font-weight: 700; }
        .ProseMirror h3 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 12pt; color: #111; margin: 14px 0 6px; font-weight: 700; }
        .ProseMirror ul, .ProseMirror ol { padding-left: 22px; margin: 8px 0; }
        .ProseMirror blockquote { border-left: 3px solid #E8692B; padding-left: 12px; margin: 12px 0; color: #555; font-style: italic; }
        .ProseMirror mark { background: #fff59d; padding: 0 2px; }
        .print-footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #ddd; font-size: 9pt; color: #888; text-align: center; }
        .print-btn { position: fixed; top: 20px; right: 20px; padding: 10px 18px; background: #E8692B; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 13px; font-family: inherit; }
        @media print {
          .print-btn { display: none; }
          .print-wrap { padding: 20px; }
          .ProseMirror h1, .ProseMirror h2 { page-break-after: avoid; }
          .ProseMirror p, .ProseMirror li { orphans: 3; widows: 3; }
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; }
        }
        @page { margin: 18mm 20mm; }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>Imprimer / PDF</button>

      <div className="print-header">
        <h1 className="print-brand">BourbonMédia</h1>
        <div className="print-meta">
          {client?.business_name && <span><strong>Commerce :</strong> {client.business_name}</span>}
          {client?.contact_name && <span><strong>Contact :</strong> {client.contact_name}</span>}
          <span><strong>Version :</strong> v{script.version}</span>
          <span><strong>Date :</strong> {new Date(script.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      <h2 className="print-title">{script.title}</h2>
      <p className="print-subtitle">
        Statut : {script.status === 'confirmed' ? '✓ Validé par le client' : script.status}
      </p>

      <EditorContent editor={editor} />

      <div className="print-footer">
        BourbonMédia — Votre partenaire vidéo à La Réunion · bourbonmedia.fr
      </div>
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Chargement…</div>}>
      <PrintContent />
    </Suspense>
  );
}
