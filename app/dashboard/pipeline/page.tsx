'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PipelineCommerciale from '@/components/PipelineCommerciale';
import PipelineOnboarding from '@/components/PipelineOnboarding';
import { ClientsListView } from '@/app/dashboard/clients/page';

type Tab = 'commerciale' | 'onboarding' | 'clients';

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
  const tabParam = searchParams.get('tab');
  // Tab piloté DIRECTEMENT par l'URL (pas de state local) : depuis la
  // sidebar les 3 entrées Prospects GHL / Production / Clients changent
  // l'URL via Next.js client-side nav, donc PipelinePageInner ne se
  // démonte pas. Si on stockait `tab` dans useState avec initialTab,
  // l'état resterait figé sur la valeur du premier mount → la sidebar
  // ne switcherait plus rien après la 1ère navigation.
  const tab: Tab = tabParam === 'onboarding' ? 'onboarding'
    : tabParam === 'clients' ? 'clients'
    : 'commerciale';
  const [kpi, setKpi] = useState<KpiData | null>(null);

  const loadKpi = useCallback(async () => {
    try {
      const [oR, cR] = await Promise.all([
        fetch('/api/gh-opportunities', { headers: authHeaders() }),
        fetch('/api/clients', { headers: authHeaders() }),
      ]);
      const oData = oR.ok ? await oR.json() : { opportunities: [] };
      const cData = cR.ok ? await cR.json() : [];
      type Opp = { client_id: string | null; prospect_status: string | null; monetary_value_cents: number | null; pipeline_stage_name: string | null };
      type Cl = { status: string };
      const opps: Opp[] = oData.opportunities || [];
      const clients: Cl[] = Array.isArray(cData) ? cData : [];

      // Définitions claires :
      //  - Prospects actifs = opps dans les stages commerciaux (Leads, Appel réservé,
      //    Réflexion, Follow-up, Attente signature) — pas encore signés
      //  - Gagnés = opps avec prospect_status contracted ou regular
      //  - Clients en production = clients dont la vidéo n'est pas encore publiée
      //  - CA à signer = somme monetary_value des opps "à signer" (réflexion + follow-up
      //    + attente signature). Fallback 500€ HT si valeur null.
      const isActiveLead = (o: Opp) => {
        const s = (o.prospect_status || '').toLowerCase();
        const stageName = (o.pipeline_stage_name || '').toLowerCase();
        // Pre-call stages (Leads, Appel réservé) ont pas de prospect_status mappé
        const preCall = !s && (stageName.includes('lead') || stageName.includes('appel'));
        return preCall || ['reflection', 'follow_up', 'awaiting_signature'].includes(s);
      };
      const isWon = (o: Opp) => o.prospect_status === 'contracted' || o.prospect_status === 'regular';

      const leads_active = opps.filter(isActiveLead).length;
      const won_total = opps.filter(isWon).length;
      const clients_active = clients.filter(c => c.status !== 'published').length;
      const conversion_rate = leads_active + won_total > 0
        ? Math.round((won_total / (leads_active + won_total)) * 100)
        : null;
      const ca_to_sign_cents = opps
        .filter(o => o.prospect_status && ['reflection', 'follow_up', 'awaiting_signature'].includes(o.prospect_status))
        .reduce((s, o) => s + (o.monetary_value_cents || 50000), 0);

      setKpi({ leads_active, clients_active, conversion_rate, ca_to_sign_cents });
    } catch { /* tolerate */ }
  }, []);

  useEffect(() => { loadKpi(); }, [loadKpi]);

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

        {/* Onglets retirés : la sidebar expose Prospects GHL / Production /
            Clients comme entrées dédiées. Le tab sélectionné reste piloté
            par le query param ?tab=... pour conserver les liens existants. */}
      </div>

      {/* Tab content */}
      <div className="bm-fade-in" key={tab}>
        {tab === 'commerciale' && <PipelineCommerciale />}
        {tab === 'onboarding' && <PipelineOnboarding />}
        {tab === 'clients' && <ClientsListView />}
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
