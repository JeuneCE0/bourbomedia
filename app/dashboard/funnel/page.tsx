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

interface CohortRow {
  month: string;
  total_signups: number;
  reached: Record<string, number>;
  rates: Record<string, number>;
}
interface CohortStats {
  months: number;
  since: string;
  stages: string[];
  cohorts: CohortRow[];
}

const EVENT_LABELS: Record<string, { label: string; emoji: string }> = {
  onboarding_landed:        { label: 'Visite onboarding',     emoji: '👋' },
  signup_completed:         { label: 'Inscription',           emoji: '📝' },
  contract_signed:          { label: 'Contrat signé',         emoji: '✍️' },
  payment_completed:        { label: 'Paiement reçu',         emoji: '💳' },
  call_booked:              { label: 'Appel onboarding',      emoji: '📞' },
  script_proposed:          { label: 'Script envoyé',         emoji: '📜' },
  script_changes_requested: { label: 'Modifs script demandées', emoji: '🖍️' },
  script_validated:         { label: 'Script validé',         emoji: '✅' },
  filming_booked:           { label: 'Tournage réservé',      emoji: '🎬' },
  video_delivered:          { label: 'Vidéo livrée',          emoji: '📹' },
  video_validated:          { label: 'Vidéo validée',         emoji: '👍' },
  video_changes_requested:  { label: 'Modifs vidéo demandées', emoji: '✏️' },
  publication_booked:       { label: 'Date publi choisie',    emoji: '🗓️' },
  project_published:        { label: 'Vidéo publiée',         emoji: '🎉' },
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

type ViewMode = 'global' | 'cohorts';

export default function FunnelPage() {
  const [data, setData] = useState<FunnelStats | null>(null);
  const [cohorts, setCohorts] = useState<CohortStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [view, setView] = useState<ViewMode>('global');
  const [cohortMonths, setCohortMonths] = useState<3 | 6 | 12>(6);

  useEffect(() => { document.title = 'Funnel onboarding — BourbonMédia Admin'; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'global') {
        const since = new Date(Date.now() - Number(period) * 86_400_000).toISOString().slice(0, 10);
        const r = await fetch(`/api/funnel-stats?since=${since}`, { headers: authHeaders() });
        if (r.ok) setData(await r.json());
      } else {
        const r = await fetch(`/api/funnel-cohorts?months=${cohortMonths}`, { headers: authHeaders() });
        if (r.ok) setCohorts(await r.json());
      }
    } finally { setLoading(false); }
  }, [period, view, cohortMonths]);

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
            {view === 'global'
              ? `Conversion stage-par-stage des prospects sur les ${period} derniers jours.`
              : `Comparaison mois par mois — chaque ligne suit une cohorte (signups groupés par mois).`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {view === 'global' && (['7', '30', '90'] as const).map(p => (
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
          {view === 'cohorts' && ([3, 6, 12] as const).map(m => (
            <button
              key={m}
              onClick={() => setCohortMonths(m)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                background: cohortMonths === m ? 'var(--orange)' : 'var(--night-mid)',
                color: cohortMonths === m ? '#fff' : 'var(--text-mid)',
                border: `1px solid ${cohortMonths === m ? 'var(--orange)' : 'var(--border-md)'}`,
                cursor: 'pointer',
              }}
            >
              {m} mois
            </button>
          ))}
        </div>
      </div>

      {/* View toggle */}
      <div style={{
        display: 'inline-flex', gap: 4, marginBottom: 16,
        background: 'var(--night-mid)', border: '1px solid var(--border-md)',
        borderRadius: 10, padding: 4,
      }}>
        {(['global', 'cohorts'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
              background: view === v ? 'var(--night-card)' : 'transparent',
              color: view === v ? 'var(--text)' : 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {v === 'global' ? '📊 Funnel global' : '📅 Cohortes mensuelles'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
      ) : view === 'cohorts' ? (
        <CohortsView data={cohorts} />
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
        💡 <strong>Lecture :</strong> {view === 'global'
          ? 'chaque ligne montre le nombre de prospects uniques ayant atteint cette étape. Le pourcentage entre deux lignes est le taux de conversion. Une chute brutale signale un point de friction.'
          : 'chaque ligne est la cohorte des clients ayant signup ce mois-là, suivie de leur taux d\'atteinte de chaque étape. Comparer mois par mois permet de spotter une dégradation (ex: avril 80% paiement, mai 50%).'}
      </div>
    </div>
  );
}

const STAGE_META: Record<string, { label: string; emoji: string }> = {
  signup_completed:   { label: 'Inscription',     emoji: '📝' },
  contract_signed:    { label: 'Contrat',         emoji: '✍️' },
  payment_completed:  { label: 'Paiement',        emoji: '💳' },
  call_booked:        { label: 'Onboarding call', emoji: '📞' },
  script_validated:   { label: 'Script validé',   emoji: '✅' },
  filming_booked:     { label: 'Tournage',        emoji: '🎬' },
  video_delivered:    { label: 'Vidéo livrée',    emoji: '📹' },
  video_validated:    { label: 'Vidéo validée',   emoji: '👍' },
  project_published:  { label: 'Publié',          emoji: '🎉' },
};

function rateColor(rate: number): string {
  if (rate >= 75) return 'var(--green)';
  if (rate >= 50) return '#FACC15';
  if (rate >= 25) return '#F97316';
  return 'var(--red)';
}

function fmtMonth(m: string): string {
  const [year, month] = m.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

function CohortsView({ data }: { data: CohortStats | null }) {
  if (!data || data.cohorts.length === 0) {
    return (
      <div style={{
        padding: '40px 20px', textAlign: 'center', borderRadius: 12,
        background: 'var(--night-card)', border: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}>
        📭 Aucune cohorte sur la période.
        <div style={{ marginTop: 8, fontSize: '0.78rem' }}>
          Chaque cohorte démarre avec un signup_completed. Sans signup tracké
          dans la fenêtre, pas de cohorte à comparer.
        </div>
      </div>
    );
  }

  // Stages affichés (skip signup_completed dans les colonnes — c'est la base
  // de référence à 100%, déjà donnée par "n signups")
  const displayStages = data.stages.filter(s => s !== 'signup_completed');

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 14,
      border: '1px solid var(--border)', overflow: 'auto',
    }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', minWidth: 720,
        fontSize: '0.78rem',
      }}>
        <thead>
          <tr style={{ background: 'var(--night-mid)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '12px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Cohorte
            </th>
            <th style={{ padding: '12px 10px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Signups
            </th>
            {displayStages.map(s => {
              const meta = STAGE_META[s] || { label: s, emoji: '🔹' };
              return (
                <th key={s} style={{
                  padding: '12px 10px', textAlign: 'center',
                  color: 'var(--text-muted)', fontWeight: 600,
                  fontSize: '0.72rem', minWidth: 78,
                }}>
                  <div aria-hidden style={{ fontSize: '1rem', marginBottom: 2 }}>{meta.emoji}</div>
                  <div>{meta.label}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.cohorts.map(c => (
            <tr key={c.month} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '14px', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {fmtMonth(c.month)}
              </td>
              <td style={{ padding: '14px 10px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                {c.total_signups}
              </td>
              {displayStages.map(s => {
                const rate = c.rates[s] || 0;
                const reached = c.reached[s] || 0;
                return (
                  <td key={s} style={{ padding: '10px', textAlign: 'center' }}>
                    <div style={{
                      display: 'inline-block', minWidth: 56,
                      padding: '4px 8px', borderRadius: 6,
                      background: rate > 0 ? `color-mix(in srgb, ${rateColor(rate)} 12%, transparent)` : 'transparent',
                      border: `1px solid ${rate > 0 ? `color-mix(in srgb, ${rateColor(rate)} 30%, transparent)` : 'var(--border)'}`,
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.84rem', color: rate > 0 ? rateColor(rate) : 'var(--text-muted)' }}>
                        {rate}%
                      </div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                        {reached}/{c.total_signups}
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
