'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useVisibilityAwarePolling } from '@/lib/use-visibility-polling';

interface HealthData {
  checkedAt: string;
  supabase: { reachable: boolean };
  last24h: {
    errors: { count: number | null; by_source: Record<string, number> };
    funnelEvents: { count: number | null; by_event: Record<string, number> };
  };
  last7d: { signups: number | null };
  clients: { total: number | null; active: number | null; published: number | null };
  crons: { path: string; schedule: string; desc: string }[];
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Health — BourbonMédia Admin'; }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/health/', { headers: authHeaders() });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibilityAwarePolling(load, 60_000);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: '1.6rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          }}>
            🩺 Health
          </h1>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Snapshot ops — vérifie d&apos;un coup d&apos;œil que tout tourne. Refresh auto 60s.
          </p>
        </div>
        {data?.checkedAt && (
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Checké {new Date(data.checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
      ) : !data ? (
        <div style={{
          padding: '24px', borderRadius: 12,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.30)',
          color: 'var(--red)', fontSize: '0.88rem',
        }}>
          ❌ Erreur de chargement — l&apos;endpoint /api/health ne répond pas.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>

          {/* Supabase status */}
          <Section title="Supabase">
            <Row label="Connectivity" value={data.supabase.reachable ? '✅ Reachable' : '❌ Down'} good={data.supabase.reachable} />
          </Section>

          {/* Errors 24h */}
          <Section title="Erreurs (24h)">
            <Row
              label="Total"
              value={data.last24h.errors.count ?? '—'}
              good={(data.last24h.errors.count || 0) === 0}
              warn={(data.last24h.errors.count || 0) > 0 && (data.last24h.errors.count || 0) <= 5}
              bad={(data.last24h.errors.count || 0) > 5}
            />
            {Object.entries(data.last24h.errors.by_source).map(([source, count]) => (
              <Row key={source} label={`├ ${source}`} value={count} subtle />
            ))}
            <Link href="/dashboard/errors" style={linkStyle}>Voir le détail →</Link>
          </Section>

          {/* Funnel 24h */}
          <Section title="Activité funnel (24h)">
            <Row
              label="Events totaux"
              value={data.last24h.funnelEvents.count ?? '—'}
            />
            {Object.entries(data.last24h.funnelEvents.by_event)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([event, count]) => (
                <Row key={event} label={`├ ${event}`} value={count} subtle />
              ))}
            <Link href="/dashboard/funnel" style={linkStyle}>Voir le funnel →</Link>
          </Section>

          {/* Clients */}
          <Section title="Clients">
            <Row label="Total non-archivés" value={data.clients.total ?? '—'} />
            <Row label="En production" value={data.clients.active ?? '—'} />
            <Row label="Publiés" value={data.clients.published ?? '—'} />
            <Row label="Signups (7j)" value={data.last7d.signups ?? '—'} />
            <Link href="/dashboard/clients" style={linkStyle}>Voir la liste →</Link>
          </Section>

          {/* Crons */}
          <Section title="Crons Vercel" wide>
            {data.crons.map(c => (
              <div key={c.path} style={{
                padding: '8px 10px', borderRadius: 8, marginBottom: 4,
                background: 'var(--night-mid)', border: '1px solid var(--border)',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.74rem',
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
              }}>
                <div>
                  <div style={{ color: 'var(--text)' }}>{c.path}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.66rem' }}>{c.desc}</div>
                </div>
                <span style={{
                  fontSize: '0.7rem', color: 'var(--orange)',
                  background: 'rgba(232,105,43,.12)',
                  padding: '2px 6px', borderRadius: 4,
                }}>{c.schedule}</span>
              </div>
            ))}
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Vercel Dashboard → Crons → vérifier les logs des dernières exécutions.
            </div>
          </Section>

        </div>
      )}
    </div>
  );
}

function Section({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{
      gridColumn: wide ? '1 / -1' : 'auto',
      background: 'var(--night-card)', borderRadius: 12,
      border: '1px solid var(--border)', padding: '14px 16px',
    }}>
      <h3 style={{
        fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
        fontSize: '0.92rem', color: 'var(--text)', margin: '0 0 12px',
      }}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value, good, warn, bad, subtle }: {
  label: string;
  value: number | string;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
  subtle?: boolean;
}) {
  const valueColor = bad ? 'var(--red)' : warn ? '#FACC15' : good ? 'var(--green)' : 'var(--text)';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: subtle ? '3px 0 3px 8px' : '6px 0',
      fontSize: subtle ? '0.74rem' : '0.84rem',
      color: subtle ? 'var(--text-muted)' : 'var(--text-mid)',
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: subtle ? 500 : 700, color: valueColor }}>
        {value}
      </span>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  display: 'block', marginTop: 8, fontSize: '0.74rem',
  color: 'var(--orange)', textDecoration: 'none', fontWeight: 600,
};
