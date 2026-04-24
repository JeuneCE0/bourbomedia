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
  video_url?: string;
  video_thumbnail_url?: string;
  delivery_notes?: string;
  delivered_at?: string;
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

interface ScriptVersion {
  id: string;
  version: number;
  content: Record<string, unknown> | null;
  status: string;
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
  const [tab, setTab] = useState<'info' | 'script' | 'comments' | 'delivery'>('info');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [deliveryForm, setDeliveryForm] = useState<{ video_url: string; video_thumbnail_url: string; delivery_notes: string }>({ video_url: '', video_thumbnail_url: '', delivery_notes: '' });

  function notify(type: 'error' | 'success', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function parseErr(r: Response): Promise<string> {
    try {
      const d = await r.json();
      return d.error || r.statusText || 'Erreur inconnue';
    } catch {
      return r.statusText || 'Erreur inconnue';
    }
  }

  const loadClient = useCallback(() => {
    fetch(`/api/clients?id=${id}`, { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error(await parseErr(r));
        return r.json();
      })
      .then(d => {
        setClient(d);
        if (d?.scripts?.length) setScript(d.scripts[0]);
        else setScript(null);
        setDeliveryForm({
          video_url: d?.video_url || '',
          video_thumbnail_url: d?.video_thumbnail_url || '',
          delivery_notes: d?.delivery_notes || '',
        });
      })
      .catch(e => notify('error', e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadClient(); }, [loadClient]);

  async function loadVersions() {
    if (!script) return;
    try {
      const r = await fetch(`/api/scripts/versions?script_id=${script.id}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await parseErr(r));
      setVersions(await r.json());
      setShowVersions(true);
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    }
  }

  async function handleSaveScript(content: Record<string, unknown>) {
    if (!script) return;
    setSaving(true);
    try {
      const r = await fetch('/api/scripts', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: script.id, content }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', 'Script enregistré');
      loadClient();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleCreateScript() {
    setSaving(true);
    try {
      const r = await fetch('/api/scripts', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ client_id: id, title: `Script — ${client?.business_name}` }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      const r2 = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status: 'script_writing' }),
      });
      if (!r2.ok) throw new Error(await parseErr(r2));
      notify('success', 'Script créé');
      loadClient();
      setTab('script');
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleSendToClient() {
    if (!script) return;
    setSaving(true);
    try {
      const r = await fetch('/api/scripts', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: script.id, status: 'proposition' }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status: 'script_review' }),
      });
      notify('success', 'Script envoyé au client');
      loadClient();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    } finally { setSaving(false); }
  }

  async function handleUpdateStatus(status: string) {
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      loadClient();
    } catch (e: unknown) {
      notify('error', (e as Error).message);
    }
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, ...editForm }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', 'Informations enregistrées');
      setEditing(false);
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setSaving(false); }
  }

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim() || !script) return;
    setSendingComment(true);
    try {
      const r = await fetch('/api/scripts/comments', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ script_id: script.id, content: comment, author_name: 'Admin' }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      setComment('');
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setSendingComment(false); }
  }

  async function handleSaveDelivery(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id, ...deliveryForm }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', 'Livraison enregistrée');
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setSaving(false); }
  }

  async function handleMarkDelivered() {
    if (!deliveryForm.video_url) {
      notify('error', 'Ajoutez d\'abord une URL de vidéo');
      return;
    }
    if (!confirm('Marquer cette vidéo comme livrée au client ?')) return;
    setSaving(true);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({
          id,
          ...deliveryForm,
          status: 'published',
          delivered_at: new Date().toISOString(),
        }),
      });
      if (!r.ok) throw new Error(await parseErr(r));
      notify('success', 'Livraison marquée comme effectuée');
      loadClient();
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm('Supprimer ce client ? Cette action est irréversible.')) return;
    try {
      const r = await fetch('/api/clients', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error(await parseErr(r));
      router.push('/dashboard/clients');
    } catch (err: unknown) {
      notify('error', (err as Error).message);
    }
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

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '12px 18px', borderRadius: 10, maxWidth: 420,
          background: toast.type === 'error' ? 'rgba(239,68,68,.95)' : 'rgba(34,197,94,.95)',
          color: '#fff', fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          animation: 'slideIn .2s ease-out',
        }}>
          {toast.msg}
          <style>{`@keyframes slideIn { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 2, flexWrap: 'wrap' }}>
        {(['info', 'script', 'comments', 'delivery'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: tab === t ? 600 : 400,
            background: tab === t ? 'var(--night-card)' : 'transparent',
            color: tab === t ? 'var(--orange)' : 'var(--text-muted)',
            borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
          }}>
            {t === 'info' ? 'Informations' : t === 'script' ? 'Script' : t === 'comments' ? 'Commentaires' : 'Livraison'}
            {t === 'comments' && script?.script_comments?.length ? ` (${script.script_comments.length})` : ''}
            {t === 'delivery' && client.delivered_at ? ' ✓' : ''}
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
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: '0.72rem', padding: '4px 10px', borderRadius: 12, fontWeight: 600,
                    background: script.status === 'confirmed' ? 'rgba(34,197,94,.12)'
                      : script.status === 'awaiting_changes' ? 'rgba(250,204,21,.12)'
                      : script.status === 'proposition' || script.status === 'modified' ? 'rgba(232,105,43,.12)'
                      : 'var(--night-mid)',
                    color: script.status === 'confirmed' ? 'var(--green)'
                      : script.status === 'awaiting_changes' ? 'var(--yellow)'
                      : script.status === 'proposition' || script.status === 'modified' ? 'var(--orange)'
                      : 'var(--text-mid)',
                  }}>{SCRIPT_STATUS[script.status]}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>v{script.version}</span>
                  <button onClick={loadVersions} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline', padding: 0,
                  }}>Historique</button>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(script.status === 'draft' || script.status === 'modified' || script.status === 'awaiting_changes') && (
                    <button onClick={handleSendToClient} disabled={saving} style={{
                      padding: '7px 14px', borderRadius: 8, background: 'var(--orange)',
                      color: '#fff', border: 'none', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600,
                    }}>
                      {saving ? 'Envoi…' : script.status === 'draft' ? 'Envoyer au client' : 'Renvoyer au client'}
                    </button>
                  )}
                </div>
              </div>
              {script.status === 'awaiting_changes' && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                  background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.2)',
                  color: 'var(--yellow)', fontSize: '0.82rem',
                }}>
                  ⚠ Le client a demandé des modifications. Modifiez le script puis cliquez sur <strong>Renvoyer au client</strong>.
                </div>
              )}
              {script.status === 'confirmed' && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                  background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)',
                  color: 'var(--green)', fontSize: '0.82rem',
                }}>
                  ✓ Script validé par le client
                </div>
              )}
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

      {/* Delivery tab */}
      {tab === 'delivery' && (
        <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20 }}>
          <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Livraison vidéo</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {client.delivered_at
                  ? `Livrée le ${new Date(client.delivered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
                  : 'Ajoutez l\'URL de la vidéo finale et marquez comme livrée'}
              </p>
            </div>
            {client.delivered_at && (
              <span style={{
                fontSize: '0.72rem', padding: '5px 12px', borderRadius: 20,
                background: 'rgba(34,197,94,.12)', color: 'var(--green)', fontWeight: 600,
              }}>✓ Livrée</span>
            )}
          </div>

          <form onSubmit={handleSaveDelivery}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              <label>
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  URL vidéo (YouTube, Vimeo, Drive, lien direct…)
                </span>
                <input
                  type="url"
                  value={deliveryForm.video_url}
                  onChange={e => setDeliveryForm({ ...deliveryForm, video_url: e.target.value })}
                  placeholder="https://…"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  URL miniature (optionnel)
                </span>
                <input
                  type="url"
                  value={deliveryForm.video_thumbnail_url}
                  onChange={e => setDeliveryForm({ ...deliveryForm, video_thumbnail_url: e.target.value })}
                  placeholder="https://…"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Message pour le client (optionnel)
                </span>
                <textarea
                  value={deliveryForm.delivery_notes}
                  onChange={e => setDeliveryForm({ ...deliveryForm, delivery_notes: e.target.value })}
                  rows={3}
                  placeholder="Votre vidéo est prête ! Voici quelques mots sur le rendu final…"
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 6,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                    fontFamily: 'inherit', resize: 'vertical',
                  }}
                />
              </label>
            </div>

            {deliveryForm.video_url && (
              <div style={{
                marginBottom: 16, padding: 12, borderRadius: 8,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>Prévisualisation</div>
                <a href={deliveryForm.video_url} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--orange)', fontSize: '0.82rem', wordBreak: 'break-all' }}>
                  {deliveryForm.video_url} ↗
                </a>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="submit" disabled={saving} style={{
                padding: '9px 18px', borderRadius: 8, background: 'var(--night-mid)',
                border: '1px solid var(--border-md)', color: 'var(--text)', cursor: 'pointer', fontSize: '0.8rem',
              }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              {!client.delivered_at && (
                <button type="button" onClick={handleMarkDelivered} disabled={saving || !deliveryForm.video_url} style={{
                  padding: '9px 18px', borderRadius: 8, background: 'var(--green)',
                  color: '#fff', border: 'none', fontWeight: 600, cursor: deliveryForm.video_url ? 'pointer' : 'not-allowed',
                  fontSize: '0.8rem', opacity: deliveryForm.video_url ? 1 : 0.5,
                }}>✓ Marquer comme livrée</button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Version history modal */}
      {showVersions && (
        <div onClick={() => setShowVersions(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)',
            maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text)' }}>Historique des versions</h3>
              <button onClick={() => setShowVersions(false)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1,
              }}>✕</button>
            </div>
            {versions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
                Aucune version antérieure
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {versions.map(v => (
                  <div key={v.id} style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'var(--night-mid)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--orange)' }}>
                        Version {v.version}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {new Date(v.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Statut : {SCRIPT_STATUS[v.status] || v.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
