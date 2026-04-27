'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { SkeletonCard } from '@/components/ui/Skeleton';

interface Opportunity {
  id: string;
  ghl_opportunity_id: string;
  client_id: string | null;
  pipeline_stage_id: string;
  pipeline_stage_name: string | null;
  name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  monetary_value_cents: number | null;
  prospect_status: string | null;
  ghl_created_at: string | null;
  ghl_updated_at: string | null;
}

interface ClientCard {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  filming_date?: string;
  payment_amount?: number;
  paid_at?: string;
  delivered_at?: string;
  updated_at?: string;
  created_at: string;
}

interface PipelineStage {
  id: string;
  name: string;
}

// Production stages aligned with /dashboard/production STAGES
const PRODUCTION_STAGES: { key: string; label: string; emoji: string; color: string }[] = [
  { key: 'onboarding',          label: 'Onboarding',         emoji: '🤝', color: '#8A7060' },
  { key: 'onboarding_call',     label: 'Appel onboarding',   emoji: '📞', color: '#14B8A6' },
  { key: 'script_writing',      label: 'Script',             emoji: '✍️', color: '#FACC15' },
  { key: 'script_review',       label: 'Relecture',          emoji: '📝', color: '#F28C55' },
  { key: 'script_validated',    label: 'Validé',             emoji: '✅', color: '#22C55E' },
  { key: 'filming_scheduled',   label: 'Tournage prévu',     emoji: '🎬', color: '#3B82F6' },
  { key: 'filming_done',        label: 'Tourné',             emoji: '🎥', color: '#8B5CF6' },
  { key: 'editing',             label: 'Montage',            emoji: '🎞️', color: '#EC4899' },
  { key: 'video_review',        label: 'Vidéo à valider',    emoji: '👀', color: '#F97316' },
  { key: 'publication_pending', label: 'Date publication',   emoji: '🗓️', color: '#FB923C' },
  { key: 'published',           label: 'Publié',             emoji: '🎉', color: '#22C55E' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function fmtEUR(cents: number | null): string {
  if (!cents) return '—';
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days} j`;
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem.`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function FunnelPage() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [clients, setClients] = useState<ClientCard[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const [oR, cR] = await Promise.all([
        fetch('/api/gh-opportunities', { headers: authHeaders() }),
        fetch('/api/clients', { headers: authHeaders() }),
      ]);
      const oData = oR.ok ? await oR.json() : { opportunities: [], stages: [] };
      const cData = cR.ok ? await cR.json() : [];
      setOpps(oData.opportunities || []);
      setStages(oData.stages || []);
      if (Array.isArray(cData)) setClients(cData);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter
  const q = search.trim().toLowerCase();

  const filteredOpps = useMemo(() => {
    if (!q) return opps;
    return opps.filter(o => {
      const hay = [o.name, o.contact_name, o.contact_email, o.pipeline_stage_name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [opps, q]);

  const filteredClients = useMemo(() => {
    if (!q) return clients;
    return clients.filter(c => {
      const hay = [c.business_name, c.contact_name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [clients, q]);

  // Group opportunities by stage_id (only show stages that exist in the pipeline)
  const oppsByStage = useMemo(() => {
    const m: Record<string, Opportunity[]> = {};
    stages.forEach(s => { m[s.id] = []; });
    filteredOpps.forEach(o => {
      // Skip opportunities that have a linked client (they belong to production now)
      if (o.client_id) return;
      if (!m[o.pipeline_stage_id]) m[o.pipeline_stage_id] = [];
      m[o.pipeline_stage_id].push(o);
    });
    return m;
  }, [filteredOpps, stages]);

  // Group clients by production status
  const clientsByStage = useMemo(() => {
    const m: Record<string, ClientCard[]> = {};
    PRODUCTION_STAGES.forEach(s => { m[s.key] = []; });
    filteredClients.forEach(c => {
      if (m[c.status]) m[c.status].push(c);
    });
    Object.values(m).forEach(arr => arr.sort((a, b) => {
      const da = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
      const db = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
      return db - da;
    }));
    return m;
  }, [filteredClients]);

  // Stats
  const totalLeads = opps.filter(o => !o.client_id).length;
  const totalClients = clients.length;
  const wonOpps = opps.filter(o => o.prospect_status === 'contracted' || o.prospect_status === 'regular').length;
  const conversionRate = totalLeads + wonOpps > 0 ? Math.round((wonOpps / (totalLeads + wonOpps)) * 100) : null;
  const projectedValue = opps
    .filter(o => !o.client_id && o.prospect_status && ['reflection', 'follow_up', 'awaiting_signature'].includes(o.prospect_status))
    .reduce((s, o) => s + (o.monetary_value_cents || 50000), 0);

  const stageColor = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('contract') || n.includes('régulier')) return '#22C55E';
    if (n.includes('attente signature')) return '#3B82F6';
    if (n.includes('réflexion')) return '#FACC15';
    if (n.includes('follow-up')) return '#F97316';
    if (n.includes('ghosting')) return '#94A3B8';
    if (n.includes('non-qualif')) return '#EF4444';
    if (n.includes('appel')) return '#A855F7';
    if (n.includes('lead')) return '#E8692B';
    return 'var(--text-mid)';
  };

  return (
    <div style={{ padding: 'clamp(16px, 2.5vw, 28px)', maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: '1.7rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          }}>
            🌊 Funnel commercial → Production
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Vue d&apos;ensemble du parcours complet : du lead GHL à la vidéo publiée
          </p>
        </div>
        <div style={{
          display: 'flex', gap: 0, padding: 0, borderRadius: 10,
          background: 'var(--night-card)', border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          <FunnelStat label="Leads actifs" value={totalLeads.toString()} color="var(--orange)" />
          <FunnelStat label="Clients actifs" value={totalClients.toString()} color="#3B82F6" />
          <FunnelStat label="Taux conversion" value={conversionRate !== null ? `${conversionRate}%` : '—'} color="var(--green)" />
          <FunnelStat label="CA à signer" value={fmtEUR(projectedValue)} color="var(--green)" last />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          type="text" placeholder="🔍 Rechercher un prospect ou client…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', maxWidth: 420, padding: '9px 14px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
          }}
        />
      </div>

      {loading ? (
        <SkeletonCard lines={6} />
      ) : (
        <>
          {/* SECTION : Pipeline commercial GHL (avant signature) */}
          <SectionHeader emoji="🎯" title="Pipeline commercial" subtitle={`${stages.length} stages GHL · ${totalLeads} prospects`} color="var(--orange)" />
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: `repeat(${stages.length}, minmax(200px, 1fr))`,
            overflowX: 'auto', paddingBottom: 8, marginBottom: 28,
          }}>
            {stages.map(stage => (
              <FunnelColumn
                key={stage.id}
                label={stage.name}
                color={stageColor(stage.name)}
                count={oppsByStage[stage.id]?.length || 0}
              >
                {(oppsByStage[stage.id] || []).map(o => (
                  <OppCard key={o.id} opp={o} />
                ))}
              </FunnelColumn>
            ))}
          </div>

          {/* SECTION : Production (après signature) */}
          <SectionHeader emoji="🎬" title="Production" subtitle={`${PRODUCTION_STAGES.length} stages · ${totalClients} clients en pipeline`} color="#3B82F6" />
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: `repeat(${PRODUCTION_STAGES.length}, minmax(200px, 1fr))`,
            overflowX: 'auto', paddingBottom: 8,
          }}>
            {PRODUCTION_STAGES.map(stage => (
              <FunnelColumn
                key={stage.key}
                label={stage.label}
                emoji={stage.emoji}
                color={stage.color}
                count={clientsByStage[stage.key]?.length || 0}
              >
                {(clientsByStage[stage.key] || []).map(c => (
                  <ClientFunnelCard key={c.id} client={c} />
                ))}
              </FunnelColumn>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ emoji, title, subtitle, color }: { emoji: string; title: string; subtitle: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${color}40` }}>
      <span aria-hidden style={{ fontSize: '1.5rem' }}>{emoji}</span>
      <div style={{ flex: 1 }}>
        <h2 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '1.1rem', color: 'var(--text)', margin: 0,
        }}>{title}</h2>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>{subtitle}</p>
      </div>
    </div>
  );
}

function FunnelColumn({ label, emoji, color, count, children }: {
  label: string; emoji?: string; color: string; count: number; children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 10,
      border: `1px solid ${count > 0 ? color + '40' : 'var(--border)'}`,
      padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
      maxHeight: 'calc(100vh - 320px)', minWidth: 200,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {emoji && <span aria-hidden style={{ fontSize: '0.85rem' }}>{emoji}</span>}
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {label}
          </span>
        </div>
        <span style={{
          padding: '1px 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700,
          background: count > 0 ? color + '20' : 'var(--night-mid)',
          color: count > 0 ? color : 'var(--text-muted)',
          border: `1px solid ${count > 0 ? color + '40' : 'var(--border-md)'}`,
          flexShrink: 0,
        }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1 }}>
        {count === 0 ? (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', padding: '8px 4px', fontStyle: 'italic' }}>
            Vide
          </div>
        ) : children}
      </div>
    </div>
  );
}

function OppCard({ opp }: { opp: Opportunity }) {
  return (
    <Link href={`/dashboard/pipeline`} style={{
      padding: '7px 10px', borderRadius: 6,
      background: 'var(--night-mid)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 2, textDecoration: 'none',
      color: 'var(--text)',
    }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {opp.name || opp.contact_name || opp.contact_email || 'Sans nom'}
      </div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>{relativeDate(opp.ghl_updated_at || opp.ghl_created_at)}</span>
        {opp.monetary_value_cents && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmtEUR(opp.monetary_value_cents)}</span>}
      </div>
    </Link>
  );
}

function ClientFunnelCard({ client }: { client: ClientCard }) {
  const isPaid = !!client.paid_at;
  return (
    <Link href={`/dashboard/clients/${client.id}`} style={{
      padding: '7px 10px', borderRadius: 6,
      background: 'var(--night-mid)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 2, textDecoration: 'none',
      color: 'var(--text)',
    }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {client.business_name}
      </div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>{relativeDate(client.updated_at || client.created_at)}</span>
        {isPaid && client.payment_amount && (
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>
            {fmtEUR(client.payment_amount)}
          </span>
        )}
      </div>
    </Link>
  );
}

function FunnelStat({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      padding: '10px 16px', textAlign: 'center', minWidth: 100,
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
