'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { downloadCsv } from '@/lib/csv-export';

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
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: string;
  starts_at: string;
  notes: string | null;
  notes_completed_at: string | null;
  prospect_status: string | null;
  opportunity_id: string | null;
  contact_email: string | null;
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
  const sp = useSearchParams();
  const initialQ = sp?.get('q') || '';
  const [search, setSearch] = useState(initialQ);

  // Pre-open the matching prospect modal if ?q=... matches exactly one opp
  useEffect(() => {
    if (!initialQ || opps.length === 0) return;
    const matches = opps.filter(o => {
      const hay = [o.name, o.contact_name, o.contact_email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(initialQ.toLowerCase());
    });
    if (matches.length === 1 && !selectedId) setSelectedId(matches[0].id);
    // Only run on initial mount with q param
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opps]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

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
      <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="🔍 Rechercher un prospect / opportunité…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, maxWidth: 420, padding: '9px 14px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: '0.85rem', outline: 'none',
          }}
        />
        <button
          onClick={() => {
            const rows = filtered.map(o => ({
              Nom: o.name || '',
              Stage: o.pipeline_stage_name || '',
              'Statut prospect': o.prospect_status || '',
              Contact: o.contact_name || '',
              Email: o.contact_email || '',
              Téléphone: o.contact_phone || '',
              'Valeur (€)': o.monetary_value_cents ? (o.monetary_value_cents / 100).toFixed(2) : '',
              'Créée le': o.ghl_created_at ? new Date(o.ghl_created_at).toLocaleDateString('fr-FR') : '',
              'MAJ': o.ghl_updated_at ? new Date(o.ghl_updated_at).toLocaleDateString('fr-FR') : '',
            }));
            const date = new Date().toISOString().slice(0, 10);
            downloadCsv(`pipeline-commerciale-${date}.csv`, rows);
          }}
          style={{
            padding: '8px 14px', borderRadius: 10, background: 'var(--night-card)',
            border: '1px solid var(--border-md)', color: 'var(--text-mid)',
            cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
          }}
        >📊 Exporter CSV</button>
        <button
          onClick={() => { setSelectMode(s => !s); setBulkSelected(new Set()); }}
          style={{
            padding: '8px 14px', borderRadius: 10,
            background: selectMode ? 'var(--orange)' : 'var(--night-card)',
            border: `1px solid ${selectMode ? 'var(--orange)' : 'var(--border-md)'}`,
            color: selectMode ? '#fff' : 'var(--text-mid)',
            cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
          }}
        >{selectMode ? '✓ Sélection' : '☐ Sélection'}</button>
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            padding: '8px 14px', borderRadius: 10,
            background: 'var(--orange)', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
            boxShadow: '0 4px 14px rgba(232,105,43,.30)',
          }}
        >+ Nouveau prospect</button>
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
              selectMode={selectMode}
              bulkSelected={bulkSelected}
              onToggleSelect={(id) => setBulkSelected(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })}
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

      {showAddForm && (
        <QuickAddProspectModal
          stages={stages}
          onClose={() => setShowAddForm(false)}
          onCreated={() => { setShowAddForm(false); load(); }}
        />
      )}

      {/* Floating bulk action bar — visible quand selectMode + au moins 1 sélectionné */}
      {selectMode && bulkSelected.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 100, padding: '10px 16px', borderRadius: 14,
          background: 'var(--night-card)', border: '1px solid var(--orange)',
          boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          maxWidth: 'calc(100vw - 32px)',
        }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>
            {bulkSelected.size} sélectionné{bulkSelected.size > 1 ? 's' : ''}
          </span>

          <select
            disabled={bulkBusy}
            defaultValue=""
            onChange={async (e) => {
              const stageId = e.target.value;
              if (!stageId) return;
              setBulkBusy(true);
              try {
                const ids = Array.from(bulkSelected);
                await Promise.all(ids.map(id =>
                  fetch('/api/gh-opportunities', {
                    method: 'PATCH', headers: authHeaders(),
                    body: JSON.stringify({ id, pipeline_stage_id: stageId }),
                  }).catch(() => null)
                ));
                setBulkSelected(new Set());
                load();
              } finally { setBulkBusy(false); e.target.value = ''; }
            }}
            style={{
              padding: '7px 10px', borderRadius: 8,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.78rem', cursor: 'pointer',
            }}
          >
            <option value="">↗ Déplacer vers…</option>
            {stages.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <button
            disabled={bulkBusy}
            onClick={() => {
              const rows = Array.from(bulkSelected).map(id => opps.find(o => o.id === id)).filter(Boolean).map(o => ({
                Nom: o!.name || '',
                Stage: o!.pipeline_stage_name || '',
                Email: o!.contact_email || '',
                'Valeur (€)': o!.monetary_value_cents ? (o!.monetary_value_cents / 100).toFixed(2) : '',
              }));
              const date = new Date().toISOString().slice(0, 10);
              downloadCsv(`pipeline-selection-${date}.csv`, rows);
            }}
            style={{
              padding: '7px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid var(--border-md)',
              color: 'var(--text-mid)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
            }}
          >📊 Export</button>

          <button
            disabled={bulkBusy}
            onClick={async () => {
              if (!confirm(`Supprimer ${bulkSelected.size} prospect(s) ? Action irréversible.`)) return;
              setBulkBusy(true);
              try {
                const ids = Array.from(bulkSelected);
                await Promise.all(ids.map(id =>
                  fetch('/api/gh-opportunities', {
                    method: 'DELETE', headers: authHeaders(),
                    body: JSON.stringify({ id }),
                  }).catch(() => null)
                ));
                setBulkSelected(new Set());
                load();
              } finally { setBulkBusy(false); }
            }}
            style={{
              padding: '7px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid rgba(239,68,68,.40)',
              color: '#FCA5A5', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
            }}
          >🗑️ Supprimer</button>

          <button
            onClick={() => { setBulkSelected(new Set()); }}
            style={{
              padding: '7px 12px', borderRadius: 8,
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem',
            }}
          >Annuler</button>
        </div>
      )}
    </div>
  );
}

function Column({ stage, items, onSelect, selectMode, bulkSelected, onToggleSelect }: {
  stage: PipelineStage; items: Opportunity[]; onSelect: (id: string) => void;
  selectMode: boolean;
  bulkSelected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
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
          items.map(o => (
            <Card
              key={o.id}
              opp={o}
              onSelect={onSelect}
              selectMode={selectMode}
              isSelected={bulkSelected.has(o.id)}
              onToggleSelect={onToggleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}


function Card({ opp, onSelect, selectMode, isSelected, onToggleSelect }: {
  opp: Opportunity;
  onSelect: (id: string) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (selectMode && onToggleSelect) onToggleSelect(opp.id);
        else onSelect(opp.id);
      }}
      style={{
        padding: '8px 10px', borderRadius: 6,
        background: isSelected ? 'rgba(232,105,43,.18)' : 'var(--night-mid)',
        border: `1px solid ${isSelected ? 'var(--orange)' : 'var(--border)'}`,
        display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
        cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--text)',
        transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = 'var(--night-raised)'; e.currentTarget.style.borderColor = 'var(--border-md)'; } }}
      onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = 'var(--night-mid)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
    >
      {selectMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{
            width: 14, height: 14, borderRadius: 4,
            background: isSelected ? 'var(--orange)' : 'transparent',
            border: `1.5px solid ${isSelected ? 'var(--orange)' : 'var(--border-md)'}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '0.65rem', fontWeight: 700,
          }}>{isSelected ? '✓' : ''}</span>
        </div>
      )}
      {/* 1. Nom de l'opportunité */}
      <div style={{
        fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {opp.name || 'Sans nom'}
      </div>

      {/* 2. Nom de l'entreprise / contact */}
      {opp.contact_name && opp.contact_name !== opp.name && (
        <div style={{
          fontSize: '0.74rem', color: 'var(--text-mid)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          🏢 {opp.contact_name}
        </div>
      )}

      {/* 3. Email */}
      {opp.contact_email && (
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span aria-hidden>📧</span> {opp.contact_email}
        </div>
      )}

      {/* 4. Téléphone */}
      {opp.contact_phone && (
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span aria-hidden>📱</span> {opp.contact_phone}
        </div>
      )}

      {/* 5. Date de création + valeur si présente */}
      <div style={{
        fontSize: '0.65rem', color: 'var(--text-muted)',
        display: 'flex', justifyContent: 'space-between', gap: 6,
        alignItems: 'center', marginTop: 2, paddingTop: 4,
        borderTop: '1px solid var(--border)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span aria-hidden>📅</span> {relativeDate(opp.ghl_created_at)}
        </span>
        {opp.monetary_value_cents && (
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtEUR(opp.monetary_value_cents)}</span>
        )}
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

interface GhlContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  website: string | null;
  timezone: string | null;
  dnd: boolean;
  type: string | null;
  source: string | null;
  tags: string[];
  dateAdded: string | null;
  lastActivity: string | null;
  assignedTo: string | null;
  customFields: { id: string; label: string; dataType: string; value: unknown }[];
}

function ProspectModal({ opp, stages, onClose, onSaved }: { opp: Opportunity; stages: PipelineStage[]; onClose: () => void; onSaved: () => void }) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [allAppts, setAllAppts] = useState<Appointment[]>([]);
  const [loadingAppt, setLoadingAppt] = useState(true);
  const [ghlContact, setGhlContact] = useState<GhlContact | null>(null);
  const [loadingContact, setLoadingContact] = useState(true);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<string>(opp.prospect_status || '');
  const [stageId, setStageId] = useState<string>(opp.pipeline_stage_id);
  const [valueEUR, setValueEUR] = useState<string>(opp.monetary_value_cents ? (opp.monetary_value_cents / 100).toString() : '');
  const [saving, setSaving] = useState(false);

  // Fetch contact GHL avec merge_opps=1 → backend récupère + merge les
  // customFields des opportunités liées au contact (qualification commerciale
  // souvent au niveau opp dans GHL).
  useEffect(() => {
    if (!opp.ghl_contact_id) { setLoadingContact(false); return; }
    fetch(`/api/ghl/contact?id=${encodeURIComponent(opp.ghl_contact_id)}&merge_opps=1`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setGhlContact(d?.contact || null))
      .finally(() => setLoadingContact(false));
  }, [opp.ghl_contact_id]);

  // ESC to close — complements the click-outside on the backdrop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load every appointment tied to this opportunity (or to the same contact /
  // email) so the admin sees the full RDV history in the prospect drawer —
  // mirrors what GHL shows on a contact card.
  useEffect(() => {
    fetch(`/api/gh-appointments?recent=1`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { appointments: [] })
      .then(d => {
        const all: Appointment[] = d.appointments || [];
        const linked = all.filter(a =>
          a.opportunity_id === opp.ghl_opportunity_id
          || (opp.contact_email && a.contact_email && a.contact_email.toLowerCase() === opp.contact_email.toLowerCase())
        );
        setAllAppts(linked);
        const closing = linked.find(a => a.opportunity_id === opp.ghl_opportunity_id) || linked[0] || null;
        setAppointment(closing);
        if (closing) {
          setNotes(closing.notes || '');
          if (!status && closing.prospect_status) setStatus(closing.prospect_status);
        }
      })
      .finally(() => setLoadingAppt(false));
  }, [opp.ghl_opportunity_id, opp.contact_email, status]);

  const [confirmDelete, setConfirmDelete] = useState(false);

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
          {/* Quick actions — call / email / open in GHL */}
          {(opp.contact_email || opp.contact_phone || opp.ghl_contact_id) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {opp.contact_phone && (
                <a href={`tel:${opp.contact_phone}`} style={{
                  flex: 1, minWidth: 100, padding: '9px 12px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', textDecoration: 'none', textAlign: 'center',
                  fontSize: '0.78rem', fontWeight: 600,
                }}>📱 Appeler</a>
              )}
              {opp.contact_email && (
                <a href={`mailto:${opp.contact_email}`} style={{
                  flex: 1, minWidth: 100, padding: '9px 12px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                  color: 'var(--text)', textDecoration: 'none', textAlign: 'center',
                  fontSize: '0.78rem', fontWeight: 600,
                }}>📧 Email</a>
              )}
              {opp.contact_email && (
                <a href={`https://wa.me/${(opp.contact_phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{
                  flex: 1, minWidth: 100, padding: '9px 12px', borderRadius: 8,
                  background: 'var(--night-mid)', border: '1px solid rgba(34,197,94,.40)',
                  color: 'var(--green)', textDecoration: 'none', textAlign: 'center',
                  fontSize: '0.78rem', fontWeight: 600,
                  pointerEvents: opp.contact_phone ? 'auto' : 'none',
                  opacity: opp.contact_phone ? 1 : 0.5,
                }}>💬 WhatsApp</a>
              )}
              {opp.ghl_opportunity_id && (
                <a href={`https://app.gohighlevel.com/v2/location/${opp.pipeline_id ? '' : ''}opportunities/${opp.ghl_opportunity_id}`} target="_blank" rel="noreferrer" style={{
                  flex: 1, minWidth: 100, padding: '9px 12px', borderRadius: 8,
                  background: 'rgba(232,105,43,.10)', border: '1px solid rgba(232,105,43,.40)',
                  color: 'var(--orange)', textDecoration: 'none', textAlign: 'center',
                  fontSize: '0.78rem', fontWeight: 600,
                }}>↗ Ouvrir dans GHL</a>
              )}
            </div>
          )}

          {/* Contact info — fusion gh_opportunities + GHL fiche complète */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {(ghlContact?.email || opp.contact_email) && <InfoRow icon="📧" value={ghlContact?.email || opp.contact_email!} />}
            {(ghlContact?.phone || opp.contact_phone) && <InfoRow icon="📱" value={ghlContact?.phone || opp.contact_phone!} />}
            {ghlContact?.name && ghlContact.name !== opp.name && <InfoRow icon="👤" value={ghlContact.name} />}
            {ghlContact?.companyName && <InfoRow icon="🏢" value={ghlContact.companyName} />}
            {ghlContact?.city && <InfoRow icon="📍" value={[ghlContact.address1, ghlContact.city, ghlContact.postalCode].filter(Boolean).join(' · ')} />}
            {ghlContact?.website && <InfoRow icon="🌐" value={ghlContact.website} />}
            {ghlContact?.source && <InfoRow icon="🔗" value={`Source : ${ghlContact.source}`} />}
            {opp.ghl_created_at && <InfoRow icon="📅" value={`Créé ${relativeDate(opp.ghl_created_at)}`} />}
          </div>

          {/* Tags GHL */}
          {ghlContact?.tags && ghlContact.tags.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                🏷️ Tags
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {ghlContact.tags.map((t, i) => (
                  <span key={i} style={{
                    fontSize: '0.7rem', padding: '3px 9px', borderRadius: 999,
                    background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                    color: 'var(--text-mid)',
                  }}>#{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Qualification commerciale — champs GHL prioritaires (8 questions clé)
              Affichés en premier dans une grille compacte ; les autres custom
              fields restent en dessous. */}
          {ghlContact?.customFields && ghlContact.customFields.length > 0 && (() => {
            const PRIORITY_LABELS = [
              'Type de commerce',
              'Ville du commerce',
              'Ancienneté du commerce',
              'Expérience publicité en ligne',
              'Objectif principal',
              'Détail objectif',
              'Prêt à investir',
              'Qualifié',
            ];
            const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
            const priorityNorm = PRIORITY_LABELS.map(norm);
            const priorityFields = PRIORITY_LABELS.map(label => {
              const target = norm(label);
              const found = ghlContact.customFields.find(cf => {
                const n = norm(cf.label);
                return n === target || n.includes(target) || target.includes(n);
              });
              return { label, found };
            });
            const otherFields = ghlContact.customFields.filter(cf => {
              const n = norm(cf.label);
              return !priorityNorm.some(p => n === p || n.includes(p) || p.includes(n));
            });
            const renderValue = (v: unknown): string => Array.isArray(v) ? v.join(', ') : String(v);
            return (
              <>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    🎯 Qualification commerciale
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
                    {priorityFields.map(({ label, found }) => (
                      <div key={label} style={{
                        padding: '8px 10px', borderRadius: 6,
                        background: found ? 'var(--night-mid)' : 'transparent',
                        border: `1px solid ${found ? 'rgba(232,105,43,.25)' : 'var(--border)'}`,
                        opacity: found ? 1 : 0.55,
                      }}>
                        <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {label}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: found ? 'var(--text)' : 'var(--text-muted)', wordBreak: 'break-word', fontStyle: found ? 'normal' : 'italic' }}>
                          {found ? renderValue(found.value) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {otherFields.length > 0 && (
                  <details>
                    <summary style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', padding: '6px 0' }}>
                      📝 Autres champs ({otherFields.length})
                    </summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {otherFields.map(cf => (
                        <div key={cf.id} style={{
                          padding: '8px 10px', borderRadius: 6,
                          background: 'var(--night-mid)', border: '1px solid var(--border)',
                        }}>
                          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {cf.label}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text)', wordBreak: 'break-word' }}>
                            {renderValue(cf.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            );
          })()}

          {loadingContact && (
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: 8 }}>
              ⏳ Chargement de la fiche GHL complète…
            </div>
          )}

          {/* RDV history pour ce contact */}
          {allAppts.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                📅 Historique RDV ({allAppts.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allAppts.slice(0, 5).map(a => {
                  const meta: Record<string, { e: string; l: string; c: string }> = {
                    closing:    { e: '📞', l: 'Closing',     c: 'var(--orange)' },
                    onboarding: { e: '🚀', l: 'Onboarding',  c: '#14B8A6' },
                    tournage:   { e: '🎬', l: 'Tournage',    c: '#3B82F6' },
                    other:      { e: '📅', l: 'RDV',         c: 'var(--text-mid)' },
                  };
                  const m = meta[a.calendar_kind] || meta.other;
                  const pastBadge = a.status === 'no_show' ? { l: 'No show', c: '#FCA5A5' }
                    : a.status === 'cancelled' ? { l: 'Annulé', c: 'var(--text-muted)' }
                    : a.notes_completed_at ? { l: '✅ Documenté', c: 'var(--green)' }
                    : new Date(a.starts_at).getTime() < Date.now() ? { l: 'À documenter', c: '#D8B4FE' }
                    : { l: 'À venir', c: 'var(--text-mid)' };
                  const isFuture = new Date(a.starts_at).getTime() > Date.now();
                  const isActionable = a.status !== 'cancelled' && a.status !== 'no_show';
                  return (
                    <div key={a.id} style={{
                      display: 'flex', flexDirection: 'column', gap: 6,
                      padding: '8px 10px', borderRadius: 6,
                      background: 'var(--night-mid)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span aria-hidden style={{
                          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                          background: 'var(--night-raised)', border: `1.5px solid ${m.c}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem',
                        }}>{m.e}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text)' }}>{m.l}</div>
                          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                            {new Date(a.starts_at).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <span style={{
                          fontSize: '0.6rem', padding: '2px 8px', borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap',
                          background: pastBadge.c + '20', color: pastBadge.c, border: `1px solid ${pastBadge.c}40`,
                        }}>{pastBadge.l}</span>
                      </div>
                      {/* Actions GHL : Annuler / No-show / Replanifier */}
                      {isActionable && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button
                            onClick={async () => {
                              if (!confirm('Annuler ce RDV ? Le client sera notifié côté GHL.')) return;
                              await fetch('/api/gh-appointments', {
                                method: 'PATCH', headers: authHeaders(),
                                body: JSON.stringify({ id: a.id, status: 'cancelled' }),
                              });
                              setAllAppts(prev => prev.map(x => x.id === a.id ? { ...x, status: 'cancelled' } : x));
                            }}
                            style={{
                              padding: '4px 9px', borderRadius: 5, fontSize: '0.66rem', fontWeight: 600,
                              background: 'transparent', border: '1px solid rgba(239,68,68,.30)',
                              color: '#FCA5A5', cursor: 'pointer',
                            }}
                          >❌ Annuler</button>
                          {!isFuture && (
                            <button
                              onClick={async () => {
                                await fetch('/api/gh-appointments', {
                                  method: 'PATCH', headers: authHeaders(),
                                  body: JSON.stringify({ id: a.id, status: 'no_show' }),
                                });
                                setAllAppts(prev => prev.map(x => x.id === a.id ? { ...x, status: 'no_show' } : x));
                              }}
                              style={{
                                padding: '4px 9px', borderRadius: 5, fontSize: '0.66rem', fontWeight: 600,
                                background: 'transparent', border: '1px solid var(--border-md)',
                                color: 'var(--text-muted)', cursor: 'pointer',
                              }}
                            >👻 No show</button>
                          )}
                          <a
                            href={`https://app.gohighlevel.com/v2/location/${(opp as { location_id?: string }).location_id || ''}/appointments`}
                            target="_blank" rel="noreferrer"
                            style={{
                              padding: '4px 9px', borderRadius: 5, fontSize: '0.66rem', fontWeight: 600,
                              background: 'transparent', border: '1px solid var(--border-md)',
                              color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'none',
                            }}
                          >📅 Replanifier dans GHL ↗</a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
          {/* Bouton suppression — confirmation inline */}
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--red)', fontWeight: 600 }}>Sûr ?</span>
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    const r = await fetch('/api/gh-opportunities', {
                      method: 'DELETE', headers: authHeaders(),
                      body: JSON.stringify({ id: opp.id }),
                    });
                    if (r.ok) onSaved();
                    else alert('Suppression échouée');
                  } finally { setSaving(false); setConfirmDelete(false); }
                }}
                disabled={saving}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  background: 'var(--red)', color: '#fff', border: 'none',
                  cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700,
                }}
              >🗑️ Confirmer</button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  padding: '6px 10px', borderRadius: 6,
                  background: 'transparent', border: '1px solid var(--border-md)',
                  color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.74rem',
                }}
              >Non</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '7px 12px', borderRadius: 8,
                background: 'transparent', border: '1px solid rgba(239,68,68,.30)',
                color: 'var(--red)', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600,
              }}
            >🗑️ Supprimer</button>
          )}
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

function QuickAddProspectModal({ stages, onClose, onCreated }: {
  stages: PipelineStage[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', valueEUR: '500',
    stageName: stages[0]?.name || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!form.name.trim() || !form.email.trim()) {
      setError('Nom et email obligatoires');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/gh-opportunities', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          monetary_value_cents: form.valueEUR ? Math.round(parseFloat(form.valueEUR) * 100) : undefined,
          stage_name: form.stageName,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || 'Erreur');
        return;
      }
      onCreated();
    } finally { setSubmitting(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, padding: 24, borderRadius: 14,
        background: 'var(--night-card)', border: '1px solid var(--border-md)',
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        animation: 'bm-modal-pop var(--t-base) var(--ease-bounce) both',
      }}>
        <h2 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800,
          fontSize: '1.2rem', color: 'var(--text)', margin: '0 0 6px',
        }}>
          ➕ Nouveau prospect
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 18px' }}>
          Crée le contact + l&apos;opportunité dans GHL en un clic.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Nom *" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="Boulangerie de Jonas" />
          <Field label="Email *" value={form.email} onChange={v => setForm({ ...form, email: v })} placeholder="contact@boulangerie.fr" type="email" />
          <Field label="Téléphone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} placeholder="+262 XXX XX XX XX" type="tel" />
          <Field label="Valeur (€)" value={form.valueEUR} onChange={v => setForm({ ...form, valueEUR: v })} type="number" />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Stage de départ</span>
            <select
              value={form.stageName}
              onChange={e => setForm({ ...form, stageName: e.target.value })}
              style={{
                padding: '9px 12px', borderRadius: 8,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
                color: 'var(--text)', fontSize: '0.88rem', outline: 'none', fontFamily: 'inherit',
              }}
            >
              {stages.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </label>
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,.10)', color: '#FCA5A5', fontSize: '0.82rem',
          }}>❌ {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} disabled={submitting} style={{
            padding: '9px 16px', borderRadius: 8, background: 'transparent',
            border: '1px solid var(--border-md)', color: 'var(--text-mid)',
            cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600,
          }}>Annuler</button>
          <button onClick={submit} disabled={submitting} style={{
            padding: '9px 18px', borderRadius: 8, background: 'var(--orange)',
            color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 700,
            opacity: submitting ? 0.5 : 1,
          }}>
            {submitting ? '⏳ Création…' : '➕ Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '9px 12px', borderRadius: 8,
          background: 'var(--night-mid)', border: '1px solid var(--border-md)',
          color: 'var(--text)', fontSize: '0.88rem', outline: 'none', fontFamily: 'inherit',
        }}
      />
    </label>
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
