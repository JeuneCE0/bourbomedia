'use client';

import { useEffect, useState, use } from 'react';

interface NpsData {
  client: { business_name: string; contact_name: string };
  latest: { score: number; comment?: string; created_at: string } | null;
}

const SCORE_LABELS: { from: number; to: number; emoji: string; label: string; color: string }[] = [
  { from: 0, to: 6, emoji: '😕', label: 'On a du chemin à faire', color: '#EF4444' },
  { from: 7, to: 8, emoji: '🙂', label: 'Plutôt content', color: '#FACC15' },
  { from: 9, to: 10, emoji: '🤩', label: 'Vraiment fan', color: '#22C55E' },
];

function describeScore(score: number) {
  return SCORE_LABELS.find(s => score >= s.from && score <= s.to)!;
}

export default function NpsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<NpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/nps?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: NpsData | null) => {
        if (!d) { setError('Lien invalide ou expiré'); return; }
        setData(d);
        if (d.latest) {
          setScore(d.latest.score);
          setComment(d.latest.comment || '');
          setSubmitted(true);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function submit() {
    if (score === null) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`/api/nps?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(json.error || 'Une erreur est survenue.');
      } else {
        setSubmitted(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Centered>Chargement…</Centered>;
  if (error && !data) return <Centered>{error}</Centered>;
  if (!data) return <Centered>Lien invalide.</Centered>;

  const desc = score !== null ? describeScore(score) : null;

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--night)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--night-card)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 'clamp(24px, 5vw, 40px)',
        maxWidth: 580, width: '100%',
        boxShadow: '0 12px 36px rgba(0,0,0,.4)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '1.05rem', color: 'var(--orange)', letterSpacing: '-.2px',
          }}>BourbonMédia</span>
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 14 }}>🙏</div>
            <h2 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
              color: 'var(--text)', fontSize: '1.4rem', margin: '0 0 8px',
            }}>
              Merci pour votre retour !
            </h2>
            <p style={{ color: 'var(--text-mid)', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 18px' }}>
              {score !== null && score >= 9
                ? 'Vous nous donnez la force de continuer ✨ Si vous connaissez quelqu\'un qui pourrait avoir besoin de vidéo, n\'hésitez pas à nous le présenter.'
                : score !== null && score >= 7
                  ? 'Merci ! Si vous avez 30 secondes, n\'hésitez pas à nous dire ce qu\'on pourrait améliorer.'
                  : 'On prend votre retour très au sérieux. On va revenir vers vous personnellement pour comprendre comment mieux faire.'}
            </p>
            <button
              onClick={() => { setSubmitted(false); }}
              style={{
                background: 'transparent', border: '1px solid var(--border-md)',
                color: 'var(--text-muted)', borderRadius: 10, padding: '8px 16px',
                fontSize: '0.82rem', cursor: 'pointer',
              }}
            >Modifier ma réponse</button>
          </div>
        ) : (
          <>
            <h1 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
              color: 'var(--text)', fontSize: 'clamp(1.4rem, 3.5vw, 1.7rem)',
              margin: '0 0 8px', lineHeight: 1.2, textAlign: 'center',
            }}>
              Sur 10, vous nous donnez combien ?
            </h1>
            <p style={{ color: 'var(--text-mid)', fontSize: '0.92rem', lineHeight: 1.6, textAlign: 'center', margin: '0 0 24px' }}>
              {data.client.contact_name} ({data.client.business_name}), votre avis nous aide à nous améliorer chaque jour.
            </p>

            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              {Array.from({ length: 11 }, (_, i) => i).map(n => {
                const isSelected = score === n;
                const d = describeScore(n);
                return (
                  <button
                    key={n}
                    onClick={() => setScore(n)}
                    style={{
                      width: 44, height: 44, borderRadius: 10,
                      background: isSelected ? d.color : 'var(--night-mid)',
                      color: isSelected ? '#fff' : 'var(--text)',
                      border: isSelected ? `1px solid ${d.color}` : '1px solid var(--border-md)',
                      fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                      transition: 'all .15s', transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                      boxShadow: isSelected ? `0 4px 12px ${d.color}55` : 'none',
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 22, padding: '0 4px' }}>
              <span>👎 Pas du tout</span>
              <span>👍 Absolument</span>
            </div>

            {desc && (
              <div style={{
                padding: '12px 14px', borderRadius: 10,
                background: `${desc.color}18`, border: `1px solid ${desc.color}40`,
                marginBottom: 16, fontSize: '0.9rem', color: desc.color,
                display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600,
              }}>
                <span style={{ fontSize: '1.4rem' }} aria-hidden>{desc.emoji}</span>
                {desc.label}
              </div>
            )}

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Une chose qui vous a plu ou qui pourrait être améliorée ? (optionnel)"
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px',
                borderRadius: 10, background: 'var(--night-mid)',
                border: '1px solid var(--border-md)', color: 'var(--text)',
                fontSize: '0.9rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                marginBottom: 14,
              }}
            />

            {error && (
              <div style={{
                padding: '10px 12px', borderRadius: 8, marginBottom: 12,
                background: 'rgba(239,68,68,.08)', color: '#FCA5A5', fontSize: '0.84rem',
              }}>❌ {error}</div>
            )}

            <button
              onClick={submit}
              disabled={score === null || submitting}
              style={{
                width: '100%', padding: '13px 22px', borderRadius: 12,
                background: 'var(--orange)', border: 'none',
                color: '#fff', fontSize: '0.95rem', fontWeight: 700,
                cursor: score === null || submitting ? 'not-allowed' : 'pointer',
                opacity: score === null || submitting ? 0.5 : 1,
                boxShadow: '0 6px 18px rgba(232,105,43,.4)',
              }}
            >
              {submitting ? '⏳ Envoi…' : '📤 Envoyer mon avis'}
            </button>
          </>
        )}

        <p style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 20 }}>
          🔒 Votre réponse est privée — nous ne la partagerons pas sans votre accord.
        </p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--night)', color: 'var(--text-muted)', padding: 16,
    }}>
      {children}
    </div>
  );
}
