'use client';

import { useEffect, useState, useCallback } from 'react';

interface Stage { event: string; uniqueClients: number }
interface Conversion { from: string; to: string; rate: number; dropoff: number }
interface FunnelStats {
  since: string;
  totalEvents: number;
  stages: Stage[];
  conversions: (Conversion | null)[];
}

const EVENT_LABELS: Record<string, { label: string; emoji: string }> = {
  onboarding_landed:        { label: 'Visite onboarding',     emoji: '👋' },
  signup_completed:         { label: 'Inscription',           emoji: '📝' },
  contract_signed:          { label: 'Contrat signé',         emoji: '✍️' },
  payment_completed:        { label: 'Paiement reçu',         emoji: '💳' },
  call_booked:              { label: 'Appel onboarding',      emoji: '📞' },
  script_proposed:          { label: 'Script envoyé',         emoji: '📜' },
  script_validated:         { label: 'Script validé',         emoji: '✅' },
  filming_booked:           { label: 'Tournage réservé',      emoji: '🎬' },
  video_delivered:          { label: 'Vidéo livrée',          emoji: '📹' },
  video_validated:          { label: 'Vidéo validée',         emoji: '👍' },
  video_changes_requested:  { label: 'Modifications demandées', emoji: '✏️' },
  publication_booked:       { label: 'Date publi choisie',    emoji: '🗓️' },
  project_published:        { label: 'Vidéo publiée',         emoji: '🎉' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function FunnelPage() {
  const [data, setData] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');

  useEffect(() => { document.title = 'Funnel onboarding — BourbonMédia Admin'; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - Number(period) * 86_400_000).toISOString().slice(0, 10);
      const r = await fetch(`/api/funnel-stats?since=${since}`, { headers: authHeaders() });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: '1.6rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          }}>
            📊 Funnel onboarding
          </h1>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Conversion stage-par-stage des prospects sur les {period} derniers jours.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['7', '30', '90'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                background: period === p ? 'var(--orange)' : 'var(--night-mid)',
                color: period === p ? '#fff' : 'var(--text-mid)',
                border: `1px solid ${period === p ? 'var(--orange)' : 'var(--border-md)'}`,
                cursor: 'pointer',
              }}
            >
              {p}j
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
      ) : !data || data.stages.every(s => s.uniqueClients === 0) ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', borderRadius: 12,
          background: 'var(--night-card)', border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}>
          📭 Aucun event tracké sur la période.
          <div style={{ marginTop: 8, fontSize: '0.78rem' }}>
            Le tracking démarre dès qu&apos;un prospect s&apos;inscrit (signup_completed) ou
            navigue sur /onboarding (onboarding_landed). Plus le funnel se remplit, plus
            les taux deviennent significatifs.
          </div>
        </div>
      ) : (
        <div style={{
          background: 'var(--night-card)', borderRadius: 14,
          border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {data.totalEvents.toLocaleString('fr-FR')} events tracés depuis le {data.since}
            </div>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {data.stages.map((stage, i) => {
              const meta = EVENT_LABELS[stage.event] || { label: stage.event, emoji: '🔹' };
              const conv = data.conversions[i] as Conversion | null | undefined;
              const widthPct = data.stages[0].uniqueClients > 0
                ? (stage.uniqueClients / data.stages[0].uniqueClients) * 100
                : 0;
              return (
                <div key={stage.event}>
                  <div style={{
                    padding: '12px 8px', display: 'grid',
                    gridTemplateColumns: '32px 1fr auto auto', gap: 14, alignItems: 'center',
                  }}>
                    <span aria-hidden style={{ fontSize: '1.3rem' }}>{meta.emoji}</span>
                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)' }}>
                        {meta.label}
                      </div>
                      <div style={{
                        height: 6, marginTop: 6, borderRadius: 99,
                        background: 'var(--night-mid)', overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${widthPct}%`,
                          background: 'linear-gradient(90deg, var(--orange) 0%, #C45520 100%)',
                          transition: 'width .8s ease',
                        }} />
                      </div>
                    </div>
                    <span style={{
                      fontFamily: "'Bricolage Grotesque', sans-serif",
                      fontWeight: 800, fontSize: '1.1rem', color: 'var(--text)',
                    }}>
                      {stage.uniqueClients.toLocaleString('fr-FR')}
                    </span>
                    <span style={{
                      fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: 36, textAlign: 'right',
                    }}>
                      clients
                    </span>
                  </div>
                  {conv && i < data.stages.length - 1 && (
                    <div style={{
                      padding: '4px 8px', marginLeft: 46,
                      fontSize: '0.74rem', color: conv.rate >= 70 ? 'var(--green)' : conv.rate >= 40 ? '#FACC15' : 'var(--red)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{
                        width: 2, height: 14, background: 'var(--border-md)', display: 'inline-block',
                      }} />
                      <span>↓ {conv.rate}% conversion</span>
                      {conv.dropoff > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          ({conv.dropoff} client{conv.dropoff > 1 ? 's' : ''} décroch{conv.dropoff > 1 ? 'és' : 'é'})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 18, padding: '12px 16px', borderRadius: 10,
        background: 'var(--night-card)', border: '1px dashed var(--border-md)',
        fontSize: '0.78rem', color: 'var(--text-mid)', lineHeight: 1.6,
      }}>
        💡 <strong>Lecture :</strong> chaque ligne montre le nombre de prospects
        uniques ayant atteint cette étape. Le pourcentage entre deux lignes est le
        taux de conversion. Une chute brutale signale un point de friction
        (ex: prospects qui signent le contrat mais ne paient pas).
      </div>
    </div>
  );
}
