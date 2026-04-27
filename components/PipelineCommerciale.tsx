'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { SkeletonCard } from '@/components/ui/Skeleton';

interface Opportunity {
  id: string;
  ghl_opportunity_id: string;
  ghl_contact_id: string | null;
  pipeline_id: string;
  pipeline_stage_id: string;
  pipeline_stage_name: string | null;
  name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  monetary_value_cents: number | null;
  prospect_status: string | null;
  ghl_created_at: string | null;
  ghl_updated_at: string | null;
}

interface PipelineStage {
  id: string;
  name: string;
}

interface Appointment {
  id: string;
  ghl_appointment_id: string;
  starts_at: string;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  opportunity_id: string | null;
}

const PROSPECT_STATUS_OPTIONS: { value: string; label: string; emoji: string; color: string }[] = [
  { value: 'reflection',          label: 'En réflexion',                 emoji: '🤔', color: '#FACC15' },
  { value: 'follow_up',           label: 'Follow-up',                    emoji: '🔁', color: '#F97316' },
  { value: 'ghosting',            label: 'Ghosting',                     emoji: '👻', color: '#94A3B8' },
  { value: 'awaiting_signature',  label: 'Attente signature + paiement', emoji: '✍️', color: '#3B82F6' },
  { value: 'contracted',          label: 'Contracté',                    emoji: '🤝', color: '#22C55E' },
  { value: 'regular',             label: 'Client régulier',              emoji: '⭐', color: '#A855F7' },
  { value: 'not_interested',      label: 'Pas intéressé',                emoji: '🚫', color: '#737373' },
  { value: 'closed_lost',         label: 'Perdu',                        emoji: '❌', color: '#EF4444' },
];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} j`;
  if (days < 30) return `Il y a ${Math.floor(days / 7)} sem.`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtEUR(cents: number | null): string {
  if (!cents) return '—';
  return `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

export default function PipelineCommerciale() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/gh-opportunities', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { opportunities: [], stages: [] })
      .then(d => {
        setOpps(d.opportunities || []);
        setStages(d.stages || []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => opps.find(o => o.id === selectedId) || null, [opps, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return opps;
    return opps.filter(o => {
      const hay = [o.name, o.contact_name, o.contact_email, o.pipeline_stage_name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [opps, search]);

  // Group by pipeline_stage_id (so columns mirror GHL exactly)
  const grouped = useMemo(() => {
    const out: Record<string, Opportunity[]> = {};
    stages.forEach(s => { out[s.id] = []; });
    filtered.forEach(o => {
      if (!out[o.pipeline_stage_id]) out[o.pipeline_stage_id] = [];
      out[o.pipeline_stage_id].push(o);
    });
    Object.keys(out).forEach(k => {
      out[k].sort((a, b) => {
        const ad = a.ghl_updated_at || a.ghl_created_at || '';
        const bd = b.ghl_updated_at || b.ghl_created_at || '';
        return bd.localeCompare(ad);
      });
    });
    return out;
  }, [filtered, stages]);

  const totalOpps = opps.length;
  const wonStages = stages.filter(s => /contracté|client régulier/i.test(s.name));
  const wonCount = wonStages.reduce((s, st) => s + (grouped[st.id]?.length || 0), 0);
  const totalValue = opps.reduce((s, o) => s + (o.monetary_value_cents || 50000), 0);

  return (
    <div style={{ padding: 'clamp(16px, 2.5vw, 28px)', maxWidth: '100%', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
            fontSize: '1.7rem', color: 'var(--text)', margin: 0, lineHeight: 1.2,
          }}>
            🎯 Pipeline commercial
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Mirroir live de la <strong>Pipeline Bourbon Media</strong> dans GHL — sync bidirectionnel
          </p>
        </div>
        <div style={{
          display: 'flex', gap: 0, padding: 0, borderRadius: 10,
          background: 'var(--night-card)', border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          <Stat label="Opportunités" value={totalOpps.toString()} color="var(--orange)" />
          <Stat label="Gagnées" value={wonCount.toString()} color="var(--green)" />
          <Stat label="Valeur totale" value={fmtEUR(totalValue)} color="#3B82F6" last />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          type="text" placeholder="🔍 Rechercher un prospect / opportunité…"
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
      ) : opps.length === 0 ? (
        <div style={{
          background: 'var(--night-card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🪧</div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>Aucune opportunité importée</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
            Lance le backfill GHL depuis <strong>⚙️ Paramètres → 🔌 Intégrations</strong>.
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: `repeat(${stages.length}, minmax(220px, 1fr))`,
          alignItems: 'start',
          overflowX: 'auto', paddingBottom: 8,
        }}>
          {stages.map(stage => (
            <Column
              key={stage.id}
              stage={stage}
              items={grouped[stage.id] || []}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      {selected && (
        <ProspectModal
          opp={selected}
          stages={stages}
          onClose={() => setSelectedId(null)}
          onSaved={() => { setSelectedId(null); load(); }}
        />
      )}
    </div>
  );
}

function Column({ stage, items, onSelect }: { stage: PipelineStage; items: Opportunity[]; onSelect: (id: string) => void }) {
  const colorOf = stage.name.toLowerCase();
  const color = colorOf.includes('contract') || colorOf.includes('régulier') ? '#22C55E'
    : colorOf.includes('attente signature') ? '#3B82F6'
    : colorOf.includes('réflexion') ? '#FACC15'
    : colorOf.includes('follow-up') ? '#F97316'
    : colorOf.includes('ghosting') ? '#94A3B8'
    : colorOf.includes('non-qualif') ? '#EF4444'
    : colorOf.includes('appel') ? '#A855F7'
    : colorOf.includes('lead') ? '#E8692B'
    : 'var(--text-mid)';

  return (
    <div style={{
      background: 'var(--night-card)', borderRadius: 10,
      border: `1px solid ${items.length > 0 ? color + '40' : 'var(--border)'}`,
      padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
      maxHeight: 'calc(100vh - 220px)', minWidth: 220,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stage.name}
        </span>
        <span style={{
          padding: '1px 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700,
          background: items.length > 0 ? color + '20' : 'var(--night-mid)',
          color: items.length > 0 ? color : 'var(--text-muted)',
          border: `1px solid ${items.length > 0 ? color + '40' : 'var(--border-md)'}`,
          flexShrink: 0,
        }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', padding: '8px 4px', fontStyle: 'italic' }}>
            Vide
          </div>
        ) : (
          items.map(o => <Card key={o.id} opp={o} onSelect={onSelect} />)
        )}
      </div>
    </div>
  );
}

function Card({ opp, onSelect }: { opp: Opportunity; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(opp.id)}
      style={{
        padding: '7px 10px', borderRadius: 6,
        background: 'var(--night-mid)', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'stretch',
        cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--text)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--night-raised)'; e.currentTarget.style.borderColor = 'var(--border-md)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--night-mid)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {opp.name || opp.contact_name || opp.contact_email || 'Sans nom'}
      </div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>{relativeDate(opp.ghl_updated_at || opp.ghl_created_at)}</span>
        {opp.monetary_value_cents && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmtEUR(opp.monetary_value_cents)}</span>}
      </div>
    </button>
  );
}

function Stat({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <div style={{
      padding: '10px 16px', textAlign: 'center', minWidth: 80,
      borderRight: last ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 800, color, fontFamily: "'Bricolage Grotesque', sans-serif", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────── */

function ProspectModal({ opp, stages, onClose, onSaved }: { opp: Opportunity; stages: PipelineStage[]; onClose: () => void; onSaved: () => void }) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loadingAppt, setLoadingAppt] = useState(true);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<string>(opp.prospect_status || '');
  const [stageId, setStageId] = useState<string>(opp.pipeline_stage_id);
  const [valueEUR, setValueEUR] = useState<string>(opp.monetary_value_cents ? (opp.monetary_value_cents / 100).toString() : '');
  const [saving, setSaving] = useState(false);

  // Try to load the related appointment to surface notes (closing only)
  useEffect(() => {
    fetch(`/api/gh-appointments?recent=1`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => {
        const found = (d.appointments || []).find((a: Appointment) => a.opportunity_id === opp.ghl_opportunity_id) || null;
        setAppointment(found);
        if (found) {
          setNotes(found.notes || '');
          if (!status && found.prospect_status) setStatus(found.prospect_status);
        }
      })
      .finally(() => setLoadingAppt(false));
  }, [opp.ghl_opportunity_id, status]);

  async function save() {
    setSaving(true);
    try {
      // 1. Update the appointment if any (notes + prospect_status → triggers GHL pipeline sync)
      if (appointment) {
        await fetch('/api/gh-appointments', {
          method: 'PATCH', headers: authHeaders(),
          body: JSON.stringify({ id: appointment.id, notes: notes.trim() || null, prospect_status: status || null }),
        });
      }
      // 2. Update the opportunity (stage + monetary value) → push to GHL
      const newValueCents = valueEUR.trim() === '' ? null : Math.round(parseFloat(valueEUR) * 100);
      const oppPatch: Record<string, unknown> = { id: opp.id };
      if (stageId !== opp.pipeline_stage_id) oppPatch.pipeline_stage_id = stageId;
      if (newValueCents !== opp.monetary_value_cents) oppPatch.monetary_value_cents = newValueCents;
      if (Object.keys(oppPatch).length > 1) {
        await fetch('/api/gh-opportunities', {
          method: 'PATCH', headers: authHeaders(),
          body: JSON.stringify(oppPatch),
        });
      }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(540px, 100vw)', height: '100vh',
          background: 'var(--night-card)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '-12px 0 40px rgba(0,0,0,.45)',
          animation: 'bm-slide-in-right .18s ease-out',
        }}
      >
        <style>{`@keyframes bm-slide-in-right { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0, fontFamily: "'Bricolage Grotesque', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {opp.name || opp.contact_name || opp.contact_email || 'Sans nom'}
            </h2>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
              🏷️ {opp.pipeline_stage_name || 'Stage inconnu'}
              {opp.monetary_value_cents && ` · 💰 ${fmtEUR(opp.monetary_value_cents)}`}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contact info */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {opp.contact_email && <InfoRow icon="📧" value={opp.contact_email} />}
            {opp.contact_phone && <InfoRow icon="📱" value={opp.contact_phone} />}
            {opp.contact_name && opp.contact_name !== opp.name && <InfoRow icon="👤" value={opp.contact_name} />}
            {opp.ghl_created_at && <InfoRow icon="📅" value={`Créé ${relativeDate(opp.ghl_created_at)}`} />}
          </div>

          {/* Valeur de l'opportunité (sync GHL bidirectionnel) */}
          <div>
            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              💰 Valeur de l&apos;opportunité (€)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number" min="0" step="50" value={valueEUR}
                onChange={e => setValueEUR(e.target.value)}
                placeholder="500"
                style={{
                  flex: 1, padding: '9px 12px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', fontSize: '0.95rem', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem', padding: '0 4px' }}>€ HT</span>
            </div>
            <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Vide = utilise le tarif standard (500 € HT) dans les calculs de pipeline
            </p>
          </div>

          {/* Stage GHL (déplacer dans le pipeline) */}
          <div>
            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Déplacer dans le pipeline GHL
            </label>
            <select value={stageId} onChange={e => setStageId(e.target.value)} style={{
              width: '100%', padding: '9px 12px', borderRadius: 8,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
            }}>
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Statut prospect (notre enum interne) */}
          {appointment && (
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Statut prospect (déclencheurs internes)
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PROSPECT_STATUS_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setStatus(opt.value)} style={{
                    padding: '6px 11px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600,
                    background: status === opt.value ? opt.color : 'var(--night-mid)',
                    color: status === opt.value ? '#fff' : 'var(--text-mid)',
                    border: `1px solid ${status === opt.value ? opt.color : 'var(--border-md)'}`,
                    cursor: 'pointer',
                  }}>
                    {opt.emoji} {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Notes du closing
              {!appointment && !loadingAppt && (
                <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  (pas de RDV closing lié — les notes ne seront pas sauvegardées)
                </span>
              )}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!appointment}
              placeholder={appointment ? "Compte-rendu, prochaines étapes, objections, budget..." : "Aucun appel closing lié à cette opportunité."}
              rows={8}
              style={{
                width: '100%', padding: '11px 13px', borderRadius: 8,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.88rem', resize: 'vertical', outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box',
                opacity: appointment ? 1 : 0.5,
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            🔁 Sync auto vers GHL
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '9px 16px', borderRadius: 8,
              background: 'transparent', border: '1px solid var(--border-md)',
              color: 'var(--text-mid)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
            }}>Annuler</button>
            <button onClick={save} disabled={saving} style={{
              padding: '9px 18px', borderRadius: 8, background: 'var(--orange)',
              color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
              opacity: saving ? 0.5 : 1,
            }}>
              {saving ? '⏳' : '💾'} Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, value }: { icon: string; value: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
      background: 'var(--night-mid)', borderRadius: 6, border: '1px solid var(--border)',
      fontSize: '0.78rem', color: 'var(--text)', minWidth: 0,
    }}>
      <span aria-hidden style={{ flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}
