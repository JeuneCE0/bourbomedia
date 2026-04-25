'use client';

import { useEffect, useState } from 'react';

interface WorkflowExpected {
  event: string;
  tag: string;
  label: string;
  channels: ('email' | 'whatsapp' | 'sms')[];
  trigger: string;
  copyHint: string;
  workflowConfigured: boolean;
  matchedGhl: { id: string; name: string } | null;
}

interface AutomationsData {
  ghlConfigured: boolean;
  notificationsEnabled: boolean;
  automationsPaused?: boolean;
  workflows: WorkflowExpected[];
  liveWorkflowCount: number;
}

const CHANNEL_EMOJI: Record<string, string> = { email: '✉️', whatsapp: '💬', sms: '📱' };

export default function AutomationsPage() {
  const [data, setData] = useState<AutomationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('bbp_token');
    fetch('/api/automations', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px)', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 800, fontSize: '1.7rem', color: 'var(--text)',
          margin: 0, lineHeight: 1.2,
        }}>
          🤖 Automatisations GHL
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          Bourbomedia ajoute automatiquement des tags à vos contacts GHL aux moments clés du projet.
          Vous configurez vos workflows une seule fois dans GHL, et tout part automatiquement (Email, WhatsApp, SMS).
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Chargement…</div>
      ) : !data ? (
        <div style={{ color: 'var(--red)', padding: 20 }}>Erreur de chargement</div>
      ) : (
        <>
          {/* PAUSED banner — supersedes everything else when active */}
          {data.automationsPaused && (
            <div style={{
              padding: '16px 18px', borderRadius: 12, marginBottom: 14,
              background: 'rgba(239,68,68,.10)', border: '2px solid rgba(239,68,68,.45)',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '1.8rem' }} aria-hidden>⏸️</span>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#FCA5A5' }}>
                  Toutes les automatisations sont EN PAUSE
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.5 }}>
                  Aucun WhatsApp / SMS / Email automatique n&apos;est envoyé, et aucun tag GHL n&apos;est ajouté aux contacts.
                  Les notifications Slack internes et les notifs in-app restent actives.
                  Pour réactiver : passe la variable Vercel <code style={codeStyle}>AUTOMATIONS_PAUSED</code> à <code style={codeStyle}>false</code>.
                </div>
              </div>
            </div>
          )}

          {/* Status banner */}
          <div style={{
            padding: '14px 18px', borderRadius: 12, marginBottom: 18,
            background: data.ghlConfigured ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
            border: `1px solid ${data.ghlConfigured ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            opacity: data.automationsPaused ? 0.55 : 1,
          }}>
            <span style={{ fontSize: '1.6rem' }} aria-hidden>{data.ghlConfigured ? '✅' : '⚠️'}</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                {data.ghlConfigured ? 'GHL est connecté à Bourbomedia' : 'GHL n\'est pas encore connecté'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginTop: 2 }}>
                {data.ghlConfigured
                  ? `${data.liveWorkflowCount} workflow${data.liveWorkflowCount !== 1 ? 's' : ''} détecté${data.liveWorkflowCount !== 1 ? 's' : ''} dans votre compte GHL`
                  : 'Renseignez GHL_API_KEY et GHL_LOCATION_ID dans les variables d\'environnement Vercel.'}
              </div>
            </div>
          </div>

          {/* How it works */}
          <details style={detailsStyle} open>
            <summary style={summaryStyle}>📚 Comment ça marche en 3 étapes</summary>
            <ol style={{ marginTop: 12, paddingLeft: 22, lineHeight: 1.7, fontSize: '0.86rem', color: 'var(--text-mid)' }}>
              <li><strong>Bourbomedia déclenche les évènements.</strong> Quand un client signe son contrat, valide son script, etc., Bourbomedia ajoute automatiquement le bon tag (ex : <code style={codeStyle}>bbm_script_validated</code>) au contact GHL correspondant.</li>
              <li><strong>Vous créez les workflows dans GHL.</strong> Pour chaque évènement ci-dessous, créez un workflow GHL avec « Contact Tag Added » comme déclencheur, en sélectionnant le tag indiqué.</li>
              <li><strong>Le contenu reste 100% éditable côté GHL.</strong> Vous pouvez ajouter des délais, des conditions, plusieurs étapes (Email puis WhatsApp 24h après, etc.), modifier les textes — sans toucher à Bourbomedia.</li>
            </ol>
          </details>

          {/* Workflow list */}
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.workflows.map(w => (
              <div key={w.event} style={{
                background: 'var(--night-card)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                      {w.label}
                    </span>
                    {w.channels.map(c => (
                      <span key={c} title={c} style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 600,
                        background: 'var(--night-mid)', color: 'var(--text-muted)',
                      }}>
                        {CHANNEL_EMOJI[c]} {c}
                      </span>
                    ))}
                  </div>
                  {w.matchedGhl ? (
                    <span style={{
                      padding: '3px 10px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
                      background: 'rgba(34,197,94,.12)', color: 'var(--green)', border: '1px solid rgba(34,197,94,.3)',
                    }}>✅ Workflow GHL trouvé</span>
                  ) : (
                    <span style={{
                      padding: '3px 10px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                      background: 'var(--night-mid)', color: 'var(--text-muted)', border: '1px solid var(--border-md)',
                    }}>⚙️ À configurer dans GHL</span>
                  )}
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--text-mid)', marginBottom: 8, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text)' }}>Quand :</strong> {w.trigger}
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  padding: '8px 10px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid var(--border)',
                  marginBottom: 8,
                }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>TAG GHL :</span>
                  <code style={{
                    flex: 1, fontFamily: 'monospace', fontSize: '0.78rem',
                    color: 'var(--orange)', background: 'transparent',
                  }}>{w.tag}</code>
                  <button onClick={() => copy(w.tag)} style={{
                    background: 'var(--night-card)', border: '1px solid var(--border-md)',
                    color: copied === w.tag ? 'var(--green)' : 'var(--text-mid)',
                    borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600,
                    cursor: 'pointer',
                  }}>
                    {copied === w.tag ? '✅ Copié' : '📋 Copier'}
                  </button>
                </div>

                <div style={{
                  fontSize: '0.78rem', color: 'var(--text-mid)',
                  padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(232,105,43,.06)', border: '1px solid rgba(232,105,43,.2)',
                  display: 'flex', gap: 8,
                }}>
                  <span aria-hidden>💡</span>
                  <span><strong>Idée de message :</strong> {w.copyHint}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 22, padding: 14, borderRadius: 10,
            background: 'var(--night-mid)', border: '1px solid var(--border)',
            fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--text)' }}>💡 Astuce avancée :</strong> Si vous voulez ajouter le contact directement à un workflow par son ID
            (au lieu de passer par un tag), définissez la variable d&apos;environnement <code style={codeStyle}>GHL_WORKFLOW_ID_&lt;EVENT&gt;</code>
            (par ex. <code style={codeStyle}>GHL_WORKFLOW_ID_SCRIPT_READY=abc123</code>).
            Bourbomedia ajoutera automatiquement le contact à ce workflow en plus du tag.
          </div>
        </>
      )}
    </div>
  );
}

const detailsStyle: React.CSSProperties = {
  background: 'var(--night-card)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 14,
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)',
  outline: 'none',
};

const codeStyle: React.CSSProperties = {
  background: 'var(--night-mid)', padding: '1px 6px', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--orange)',
};
