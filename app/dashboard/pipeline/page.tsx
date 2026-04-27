'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PipelineCommerciale from '@/components/PipelineCommerciale';
import PipelineOnboarding from '@/components/PipelineOnboarding';

type Tab = 'commerciale' | 'onboarding';

const TABS: { key: Tab; emoji: string; label: string; subtitle: string }[] = [
  { key: 'commerciale', emoji: '🎯', label: 'Pipeline commerciale', subtitle: 'Pipeline GHL : Leads → Contracté' },
  { key: 'onboarding',  emoji: '🚀', label: 'Pipeline onboarding',  subtitle: 'Production Bourbomedia : Onboarding → Publié' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

interface KpiData {
  leads_active: number;
  clients_active: number;
  conversion_rate: number | null;
  ca_to_sign_cents: number;
}

function fmtEUR(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

function PipelinePageInner() {
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams.get('tab') === 'onboarding' ? 'onboarding' : 'commerciale';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [kpi, setKpi] = useState<KpiData | null>(null);

  const loadKpi = useCallback(async () => {
    try {
      const [oR, cR] = await Promise.all([
        fetch('/api/gh-opportunities', { headers: authHeaders() }),
        fetch('/api/clients', { headers: authHeaders() }),
      ]);
      const oData = oR.ok ? await oR.json() : { opportunities: [] };
      const cData = cR.ok ? await cR.json() : [];
      const opps = oData.opportunities || [];
      const clients = Array.isArray(cData) ? cData : [];

      const leads_active = opps.filter((o: { client_id: string | null }) => !o.client_id).length;
      const clients_active = clients.filter((c: { status: string }) => c.status !== 'published').length;
      const won = opps.filter((o: { prospect_status: string | null }) =>
        o.prospect_status === 'contracted' || o.prospect_status === 'regular'
      ).length;
      const conversion_rate = leads_active + won > 0
        ? Math.round((won / (leads_active + won)) * 100)
        : null;
      const ca_to_sign_cents = opps
        .filter((o: { client_id: string | null; prospect_status: string | null }) =>
          !o.client_id && o.prospect_status && ['reflection', 'follow_up', 'awaiting_signature'].includes(o.prospect_status)
        )
        .reduce((s: number, o: { monetary_value_cents: number | null }) =>
          s + (o.monetary_value_cents || 50000), 0);

      setKpi({ leads_active, clients_active, conversion_rate, ca_to_sign_cents });
    } catch { /* tolerate */ }
  }, []);

  useEffect(() => { loadKpi(); }, [loadKpi]);

  function switchTab(t: Tab) {
    setTab(t);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (t === 'commerciale') url.searchParams.delete('tab');
      else url.searchParams.set('tab', t);
      window.history.replaceState({}, '', url.toString());
    }
  }

  return (
    <div>
      {/* Sticky header — toujours visible quand on switche de tab */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--night)', borderBottom: '1px solid var(--border)',
        padding: 'clamp(14px, 2vw, 20px) clamp(16px, 2.5vw, 28px)',
      }}>
        {/* Title + global KPIs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
          <div>
            <h1 style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
              fontSize: '1.6rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
            }}>
              🌊 Pipeline
            </h1>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
              Tout le parcours, du lead GHL au client publié
            </p>
          </div>
          {kpi && (
            <div style={{
              display: 'flex', gap: 0, padding: 0, borderRadius: 10,
              background: 'var(--night-card)', border: '1px solid var(--border)', overflow: 'hidden',
            }}>
              <KpiCell label="Leads actifs" value={kpi.leads_active.toString()} color="var(--orange)" />
              <KpiCell label="Clients actifs" value={kpi.clients_active.toString()} color="#3B82F6" />
              <KpiCell label="Conversion" value={kpi.conversion_rate !== null ? `${kpi.conversion_rate}%` : '—'} color="var(--green)" />
              <KpiCell label="CA à signer" value={fmtEUR(kpi.ca_to_sign_cents)} color="var(--green)" last />
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 4, padding: 4, borderRadius: 10,
          background: 'var(--night-card)', border: '1px solid var(--border)',
          width: 'fit-content', maxWidth: '100%', overflowX: 'auto',
        }}>
          {TABS.map(t => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                style={{
                  padding: '11px 20px', borderRadius: 9,
                  background: active
                    ? 'linear-gradient(180deg, rgba(232,105,43,.18), rgba(232,105,43,.08))'
                    : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  border: active ? '1px solid rgba(232,105,43,.35)' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: '0.86rem', fontWeight: active ? 700 : 500,
                  display: 'flex', alignItems: 'center', gap: 9,
                  whiteSpace: 'nowrap',
                  transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                  textAlign: 'left',
                  boxShadow: active ? '0 4px 14px rgba(232,105,43,.15)' : 'none',
                }}
              >
                <span aria-hidden>{t.emoji}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
                  <span>{t.label}</span>
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
                    {t.subtitle}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="bm-fade-in" key={tab}>
        {tab === 'commerciale' ? <PipelineCommerciale /> : <PipelineOnboarding />}
      </div>
    </div>
  );
}

function KpiCell({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      padding: '10px 16px', textAlign: 'center', minWidth: 90,
      borderRight: last ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600,
        marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.05rem', fontWeight: 800, color,
        fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-muted)' }}>Chargement…</div>}>
      <PipelinePageInner />
    </Suspense>
  );
}
