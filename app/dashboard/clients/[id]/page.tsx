'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const ScriptEditor = dynamic(() => import('@/components/ScriptEditor'), { ssr: false });

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  email?: string;
  phone?: string;
  city?: string;
  category?: string;
  status: string;
  portal_token?: string;
  notes?: string;
  filming_date?: string;
  publication_deadline?: string;
  created_at: string;
  scripts?: Script[];
}

interface Script {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  status: string;
  version: number;
  script_comments?: Comment[];
}

interface Comment {
  id: string;
  author_name: string;
  author_type: string;
  content: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture script',
  script_review: 'Relecture client',
  script_validated: 'Script validé',
  filming_scheduled: 'Tournage planifié',
  filming_done: 'Tournage terminé',
  editing: 'Montage',
  published: 'Publié',
};

const STATUS_COLORS: Record<string, string> = {
  onboarding: '#8A7060',
  script_writing: '#FACC15',
  script_review: '#F28C55',
  script_validated: '#22C55E',
  filming_scheduled: '#3B82F6',
  filming_done: '#8B5CF6',
  editing: '#EC4899',
  published: '#22C55E',
};

const SCRIPT_STATUS: Record<string, string> = {
  draft: 'Brouillon',
  proposition: 'Proposition',
  awaiting_changes: 'Attente de modifications',
  modified: 'Modifié',
  confirmed: 'Confirmé',
};

const STEPS = Object.keys(STATUS_LABELS);

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'info' | 'script' | 'comments'>('info');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const loadClient = useCallback(() => {
    fetch(`/api/clients?id=${id}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setClient(d);
        if (d?.scripts?.length) setScript(d.scripts[0]);
        else setScript(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadClient(); }, [loadClient]);

  async function handleSaveScript(content: Record<string, unknown>) {
    if (!script) return;
    setSaving(true);
    try {
      await fetch('/api/scripts', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: script.id, content, status: 'proposition' }),
      });
      loadClient();
    } finally { setSaving(false); }
  }

  async function handleCreateScript() {
    setSaving(true);
    try {
      await fetch('/api/scripts', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ client_id: id, title: `Script — ${client?.business_name}` }),
      });
      await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status: 'script_writing' }),
      });
      loadClient();
      setTab('script');
    } finally { setSaving(false); }
  }

  async function handleUpdateStatus(status: string) {
    await fetch('/api/clients', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ id, status }),
    });
    loadClient();
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, ...editForm }),
      });
      setEditing(false);
      loadClient();
    } finally { setSaving(false); }
  }

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim() || !script) return;
    setSendingComment(true);
    try {
      await fetch('/api/scripts/comments', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ script_id: script.id, content: comment, author_name: 'Admin' }),
      });
      setComment('');
      loadClient();
    } finally { setSendingComment(false); }
  }

  async function handleDelete() {
    if (!confirm('Supprimer ce client ? Cette action est irréversible.')) return;
    await fetch('/api/clients', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) });
    router.push('/dashboard/clients');
  }

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Chargement…</div>;
  if (!client) return <div style={{ padding: 32, color: 'var(--red)' }}>Client introuvable</div>;

  const currentStep = STEPS.indexOf(client.status);
  const portalUrl = client.portal_token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/portal?token=${client.portal_token}` : null;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <button onClick={() => router.push('/dashboard/clients')} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '0.8rem', padding: 0, marginBottom: 8,
          }}>← Retour</button>
          <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.4rem' }}>
            {client.business_name}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 2 }}>
            {client.contact_name}{client.city ? ` — ${client.city}` : ''}
          </p>
        </div>
        <span style={{
          fontSize: '0.75rem', padding: '5px 14px', borderRadius: 20,
          background: STATUS_COLORS[client.status] + '20',
          color: STATUS_COLORS[client.status], fontWeight: 600,
        }}>{STATUS_LABELS[client.status]}</span>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: 3, margin: '20px 0 24px' }}>
        {STEPS.map((step, i) => (
          <button key={step} onClick={() => handleUpdateStatus(step)} title={STATUS_LABELS[step]} style={{
            flex: 1, height: 6, borderRadius: 3, border: 'none', cursor: 'pointer',
            background: i <= currentStep ? STATUS_COLORS[step] : 'var(--border-md)',
          }} />
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
        {(['info', 'script', 'comments'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: tab === t ? 600 : 400,
            background: tab === t ? 'var(--night-card)' : 'transparent',
            color: tab === t ? 'var(--orange)' : 'var(--text-muted)',
            borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
          }}>
            {t === 'info' ? 'Informations' : t === 'script' ? 'Script' : 'Commentaires'}
            {t === 'comments' && script?.script_comments?.length ? ` (${script.script_comments.length})` : ''}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20 }}>
          {!editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginBottom: 20 }}>
                <InfoField label="Commerce" value={client.business_name} />
                <InfoField label="Contact" value={client.contact_name} />
                <InfoField label="Email" value={client.email} />
                <InfoField label="Téléphone" value={client.phone} />
                <InfoField label="Ville" value={client.city} />
                <InfoField label="Catégorie" value={client.category} />
                <InfoField label="Date tournage" value={client.filming_date ? new Date(client.filming_date).toLocaleDateString('fr-FR') : '—'} />
                <InfoField label="Deadline publication" value={client.publication_deadline ? new Date(client.publication_deadline).toLocaleDateString('fr-FR') : '—'} />
              </div>

              {portalUrl && (
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Lien portail client</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <code style={{
                      flex: 1, fontSize: '0.72rem', padding: '6px 10px', borderRadius: 6,
                      background: 'var(--night-mid)', color: 'var(--orange)', wordBreak: 'break-all',
                    }}>{portalUrl}</code>
                    <button onClick={() => navigator.clipboard.writeText(portalUrl)} style={{
                      padding: '6px 12px', borderRadius: 6, background: 'var(--night-mid)',
                      border: '1px solid var(--border-md)', color: 'var(--text-mid)',
                      cursor: 'pointer', fontSize: '0.75rem',
                    }}>Copier</button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditing(true); setEditForm(client); }} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--night-mid)',
                  border: '1px solid var(--border-md)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.8rem',
                }}>Modifier</button>
                <button onClick={handleDelete} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'rgba(239,68,68,.1)',
                  border: '1px solid rgba(239,68,68,.3)', color: 'var(--red)', cursor: 'pointer', fontSize: '0.8rem',
                }}>Supprimer</button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSaveInfo}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {([
                  ['business_name', 'Commerce'],
                  ['contact_name', 'Contact'],
                  ['email', 'Email'],
                  ['phone', 'Téléphone'],
                  ['city', 'Ville'],
                  ['category', 'Catégorie'],
                  ['filming_date', 'Date tournage'],
                  ['publication_deadline', 'Deadline publication'],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</span>
                    <input
                      type={key.includes('date') || key.includes('deadline') ? 'date' : 'text'}
                      value={(editForm as Record<string, string>)[key] || ''}
                      onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6,
                        background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                        color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                      }}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditing(false)} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--border-md)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
                }}>Annuler</button>
                <button type="submit" disabled={saving} style={{
                  padding: '8px 16px', borderRadius: 8, background: 'var(--orange)',
                  color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Script tab */}
      {tab === 'script' && (
        <div>
          {script ? (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
              }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {SCRIPT_STATUS[script.status]} · v{script.version}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {script.status === 'draft' && (
                    <button onClick={async () => {
                      await fetch('/api/scripts', {
                        method: 'PUT', headers: authHeaders(),
                        body: JSON.stringify({ id: script.id, status: 'proposition' }),
                      });
                      await handleUpdateStatus('script_review');
                    }} style={{
                      padding: '6px 12px', borderRadius: 6, background: 'var(--orange)',
                      color: '#fff', border: 'none', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
                    }}>Envoyer au client</button>
                  )}
                </div>
              </div>
              <ScriptEditor content={script.content} onSave={handleSaveScript} saving={saving} />
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: '0.9rem' }}>Aucun script créé pour ce client</p>
              <button onClick={handleCreateScript} disabled={saving} style={{
                padding: '10px 20px', borderRadius: 8, background: 'var(--orange)',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
              }}>{saving ? 'Création…' : 'Créer le script'}</button>
            </div>
          )}
        </div>
      )}

      {/* Comments tab */}
      {tab === 'comments' && (
        <div>
          {script ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {script.script_comments && script.script_comments.length > 0 ? (
                  script.script_comments.map(c => (
                    <div key={c.id} style={{
                      padding: '12px 16px', borderRadius: 10,
                      background: c.author_type === 'admin' ? 'var(--night-card)' : 'rgba(232,105,43,.08)',
                      border: `1px solid ${c.author_type === 'admin' ? 'var(--border)' : 'var(--border-orange)'}`,
                      marginLeft: c.author_type === 'admin' ? 0 : 24,
                      marginRight: c.author_type === 'client' ? 0 : 24,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 600,
                          color: c.author_type === 'admin' ? 'var(--text-mid)' : 'var(--orange)',
                        }}>{c.author_name}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>{c.content}</p>
                    </div>
                  ))
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>Aucun commentaire</p>
                )}
              </div>

              <form onSubmit={handleSendComment} style={{ display: 'flex', gap: 8 }}>
                <input
                  value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="Écrire un commentaire…"
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    background: 'var(--night-card)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem',
                  }}
                />
                <button type="submit" disabled={sendingComment || !comment.trim()} style={{
                  padding: '10px 18px', borderRadius: 8, background: 'var(--orange)',
                  color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.8rem',
                  cursor: 'pointer', opacity: sendingComment || !comment.trim() ? 0.5 : 1,
                }}>{sendingComment ? '…' : 'Envoyer'}</button>
              </form>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 40 }}>
              Créez d&#39;abord un script pour pouvoir commenter
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</span>
      <span style={{ fontSize: '0.85rem', color: value && value !== '—' ? 'var(--text)' : 'var(--text-muted)' }}>{value || '—'}</span>
    </div>
  );
}
