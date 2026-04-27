'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  filming_date?: string;
  publication_deadline?: string;
  scripts?: { id: string; status: string; updated_at: string }[];
}

interface TaskFromApi {
  id: string;
  client_id: string;
  client_name: string;
  text: string;
  done: boolean;
  due_date?: string;
}

interface GhAppointmentFromApi {
  id: string;
  ghl_appointment_id: string;
  calendar_kind: 'closing' | 'onboarding' | 'tournage' | 'other';
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  contact_name: string | null;
  contact_email: string | null;
  client_id: string | null;
  notes_completed_at: string | null;
  opportunity_name?: string | null;
}

type EventKind = 'filming' | 'publication' | 'script_sent' | 'script_due' | 'task' | 'onboarding_deadline'
  | 'closing_call' | 'onboarding_call' | 'appt_other';

interface CalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM (optional)
  kind: EventKind;
  label: string;
  client_id?: string;
  client_name?: string;
  status?: string;
  done?: boolean;
}

const KIND_META: Record<EventKind, { color: string; emoji: string; label: string }> = {
  filming:             { color: '#3B82F6', emoji: '🎬', label: 'Tournage' },
  publication:         { color: '#A855F7', emoji: '📺', label: 'Publication prévue' },
  script_sent:         { color: '#F28C55', emoji: '📤', label: 'Script envoyé' },
  script_due:          { color: '#FACC15', emoji: '⏰', label: 'Script à finaliser' },
  task:                { color: '#22C55E', emoji: '✅', label: 'Tâche' },
  onboarding_deadline: { color: '#EF4444', emoji: '🚀', label: 'Onboarding bloqué' },
  closing_call:        { color: '#E8692B', emoji: '📞', label: 'Appel closing' },
  onboarding_call:     { color: '#14B8A6', emoji: '🚀', label: 'Appel onboarding' },
  appt_other:          { color: '#94A3B8', emoji: '📅', label: 'Rendez-vous' },
};

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture',
  script_review: 'Relecture',
  script_validated: 'Validé',
  filming_scheduled: 'Tournage prévu',
  filming_done: 'Tourné',
  editing: 'Montage',
  published: 'Publié',
};

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const hh = d.getHours();
    const mm = d.getMinutes();
    if (hh === 0 && mm === 0) return ''; // pure date, no time component
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function CalendarPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<TaskFromApi[]>([]);
  const [appointments, setAppointments] = useState<GhAppointmentFromApi[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [activeKinds, setActiveKinds] = useState<EventKind[]>([]); // empty = all
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load a 9-month window (3 months back, 6 months forward) so the user can
      // page through the calendar without re-querying. This avoids the bug
      // where today's appointments disappear because future ones push them out.
      const from = new Date();
      from.setMonth(from.getMonth() - 3);
      const to = new Date();
      to.setMonth(to.getMonth() + 6);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const [cR, tR, aR] = await Promise.all([
        fetch('/api/clients', { headers: authHeaders() }),
        fetch('/api/tasks', { headers: authHeaders() }),
        fetch(`/api/gh-appointments?from=${fromStr}&to=${toStr}`, { headers: authHeaders() }),
      ]);
      const c = cR.ok ? await cR.json() : [];
      const t = tR.ok ? await tR.json() : [];
      const a = aR.ok ? await aR.json() : { appointments: [] };
      if (Array.isArray(c)) setClients(c);
      if (Array.isArray(t)) setTasks(t);
      if (Array.isArray(a.appointments)) setAppointments(a.appointments);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
      } else if ((e.key === 't' || e.key === 'T') && !(e.target as HTMLElement)?.matches('input,textarea')) {
        setCurrentDate(new Date()); setExpandedDay(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build a unified events array
  const allEvents = useMemo<CalEvent[]>(() => {
    const evs: CalEvent[] = [];
    const seen = new Set<string>();

    const push = (e: CalEvent) => {
      const key = `${e.kind}|${e.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      evs.push(e);
    };

    clients.forEach(c => {
      // 🎬 Filming
      if (c.filming_date) {
        push({
          id: `filming-${c.id}`,
          date: c.filming_date.slice(0, 10),
          time: formatTime(c.filming_date),
          kind: 'filming',
          label: c.business_name,
          client_id: c.id,
          client_name: c.business_name,
          status: c.status,
        });
      }
      // 📺 Publication deadline
      if (c.publication_deadline) {
        push({
          id: `pub-${c.id}`,
          date: c.publication_deadline.slice(0, 10),
          kind: 'publication',
          label: c.business_name,
          client_id: c.id,
          client_name: c.business_name,
          status: c.status,
        });
      }
      // 📤 Script sent (when script.status='proposition' or 'modified')
      if (c.scripts?.length) {
        const s = c.scripts[0];
        if ((s.status === 'proposition' || s.status === 'modified') && s.updated_at) {
          push({
            id: `script-sent-${c.id}-${s.id}`,
            date: s.updated_at.slice(0, 10),
            kind: 'script_sent',
            label: c.business_name,
            client_id: c.id,
            client_name: c.business_name,
            status: c.status,
          });
        }
      }
    });

    tasks.forEach(t => {
      if (!t.due_date) return;
      push({
        id: `task-${t.id}`,
        date: t.due_date.slice(0, 10),
        kind: 'task',
        label: `${t.text}${t.client_name ? ` (${t.client_name})` : ''}`,
        client_id: t.client_id,
        client_name: t.client_name,
        done: t.done,
      });
    });

    // GHL appointments (closing / onboarding / tournage / other) — skip cancelled/no-show
    appointments.forEach(a => {
      if (a.status === 'cancelled' || a.status === 'no_show') return;
      const kind: EventKind = a.calendar_kind === 'closing' ? 'closing_call'
        : a.calendar_kind === 'onboarding' ? 'onboarding_call'
        : a.calendar_kind === 'tournage' ? 'filming'
        : 'appt_other';
      push({
        id: `appt-${a.id}`,
        date: a.starts_at.slice(0, 10),
        time: formatTime(a.starts_at),
        kind,
        label: a.opportunity_name || a.contact_name || a.contact_email || 'Sans nom',
        client_id: a.client_id || undefined,
        client_name: a.opportunity_name || a.contact_name || undefined,
      });
    });

    return evs;
  }, [clients, tasks, appointments]);

  // Filter
  const filteredEvents = useMemo(() => {
    if (activeKinds.length === 0) return allEvents;
    return allEvents.filter(e => activeKinds.includes(e.kind));
  }, [allEvents, activeKinds]);

  // Group by date
  const eventsByDate = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    filteredEvents.forEach(e => {
      if (!m[e.date]) m[e.date] = [];
      m[e.date].push(e);
    });
    // Sort within day: filming first, then publication, then scripts, then tasks
    const order: Record<EventKind, number> = { filming: 0, publication: 1, closing_call: 2, onboarding_call: 3, appt_other: 4, script_sent: 5, script_due: 6, onboarding_deadline: 7, task: 8 };
    Object.values(m).forEach(list => list.sort((a, b) => (order[a.kind] - order[b.kind]) || (a.time || '').localeCompare(b.time || '')));
    return m;
  }, [filteredEvents]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  const monthEvents = useMemo(() => filteredEvents.filter(e => e.date.startsWith(monthKey)), [filteredEvents, monthKey]);
  const monthCountsByKind = useMemo(() => {
    const counts: Record<EventKind, number> = { filming: 0, publication: 0, script_sent: 0, script_due: 0, task: 0, onboarding_deadline: 0, closing_call: 0, onboarding_call: 0, appt_other: 0 };
    monthEvents.forEach(e => { counts[e.kind]++; });
    return counts;
  }, [monthEvents]);

  const days: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let i = 1; i <= totalDays; i++) days.push(i);
  while (days.length % 7 !== 0) days.push(null);

  const prev = () => setCurrentDate(new Date(year, month - 1, 1));
  const next = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => { setCurrentDate(new Date()); setExpandedDay(null); };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;

  function toggleKind(k: EventKind) {
    setActiveKinds(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  }

  // Drag-to-reschedule for filming events
  async function handleDropOnDate(targetDate: string, eventId: string) {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev || ev.kind !== 'filming' || !ev.client_id) return;
    if (ev.date === targetDate) return;
    const client = clients.find(c => c.id === ev.client_id);
    if (!client) return;
    // Preserve the original time-of-day so we don't lose hours
    const original = client.filming_date ? new Date(client.filming_date) : new Date();
    const [y, m, d] = targetDate.split('-').map(Number);
    const newDate = new Date(original);
    newDate.setFullYear(y); newDate.setMonth(m - 1); newDate.setDate(d);
    const friendlyOld = original.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const friendlyNew = newDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!confirm(`Déplacer le tournage de ${client.business_name}\nde ${friendlyOld}\nvers ${friendlyNew} ?`)) return;
    setRescheduling(true);
    try {
      const r = await fetch('/api/clients', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ id: client.id, filming_date: newDate.toISOString() }),
      });
      if (r.ok) {
        // Optimistic local update
        setClients(prev => prev.map(c => c.id === client.id ? { ...c, filming_date: newDate.toISOString() } : c));
      } else {
        alert("Le déplacement n'a pas pu être enregistré.");
      }
    } catch {
      alert("Le déplacement n'a pas pu être enregistré.");
    } finally {
      setRescheduling(false);
      setDragOverDate(null);
      setDraggingEventId(null);
    }
  }

  const cssVars = {
    '--cal-cell-min': '130px',
    '--cal-cell-pad': '8px 10px',
    '--cal-font-day': '0.92rem',
    '--cal-font-slot': '0.78rem',
    '--cal-gap': '4px',
  } as React.CSSProperties;

  return (
    <div style={{ padding: 'clamp(16px, 2.5vw, 28px)', maxWidth: '100%', margin: '0 auto', ...cssVars }}>
      <style>{`
        @media (max-width: 768px) {
          .cal-root {
            --cal-cell-min: 56px !important;
            --cal-cell-pad: 4px 5px !important;
            --cal-font-day: 0.7rem !important;
            --cal-font-slot: 0.6rem !important;
            --cal-gap: 2px !important;
          }
          .cal-header-row { flex-wrap: wrap !important; gap: 8px !important; }
          .cal-title { font-size: 1.1rem !important; }
        }
        @media (max-width: 480px) {
          .cal-root { --cal-cell-min: 40px !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800, fontSize: '1.6rem', color: 'var(--text)',
            margin: 0, lineHeight: 1.3,
          }}>
            📅 Calendrier
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Tournages, publications, scripts envoyés, tâches — glissez un 🎬 tournage sur un autre jour pour le reprogrammer
          </p>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          ← / → pour changer de mois · <kbd style={kbdStyle}>T</kbd> pour aujourd&apos;hui
        </div>
      </div>

      {/* Today's events — sticky panel above the calendar */}
      {!loading && (() => {
        const todaysEvents = eventsByDate[today] || [];
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowKey = tomorrowDate.toISOString().slice(0, 10);
        const tomorrowsEvents = eventsByDate[tomorrowKey] || [];
        return (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12,
            marginBottom: 14,
          }}>
            <div style={{
              background: todaysEvents.length > 0 ? 'rgba(232,105,43,.08)' : 'var(--night-card)',
              border: `1px solid ${todaysEvents.length > 0 ? 'var(--border-orange)' : 'var(--border)'}`,
              borderRadius: 14, padding: 14,
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: todaysEvents.length > 0 ? 'var(--orange)' : 'var(--text-mid)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>📌</span> Aujourd&apos;hui · {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              {todaysEvents.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Rien de prévu — bonne journée !
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {todaysEvents.map(e => {
                    const meta = KIND_META[e.kind];
                    const inner = (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span aria-hidden style={{ fontSize: '1rem' }}>{meta.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '0.83rem', color: 'var(--text)', fontWeight: 600,
                            textDecoration: e.done ? 'line-through' : 'none',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {e.label}
                          </div>
                          <div style={{ fontSize: '0.66rem', color: 'var(--text-mid)' }}>
                            {e.time && <>🕐 {e.time} · </>}{meta.label}
                          </div>
                        </div>
                      </div>
                    );
                    return e.client_id ? (
                      <Link key={e.id} href={`/dashboard/clients/${e.client_id}${e.kind === 'filming' ? '?tab=filming' : e.kind === 'script_sent' || e.kind === 'script_due' ? '?tab=script' : ''}`} style={{
                        padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
                        background: 'var(--night-mid)',
                      }}>{inner}</Link>
                    ) : (
                      <div key={e.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--night-mid)' }}>{inner}</div>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{
              background: 'var(--night-card)',
              border: '1px solid var(--border)',
              borderRadius: 14, padding: 14,
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-mid)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>📅</span> Demain · {tomorrowDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              {tomorrowsEvents.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Aucun évènement prévu demain.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {tomorrowsEvents.slice(0, 4).map(e => {
                    const meta = KIND_META[e.kind];
                    return (
                      <Link key={e.id} href={e.client_id ? `/dashboard/clients/${e.client_id}${e.kind === 'filming' ? '?tab=filming' : e.kind === 'script_sent' ? '?tab=script' : ''}` : '#'} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 8, textDecoration: 'none',
                        background: 'var(--night-mid)',
                      }}>
                        <span aria-hidden style={{ fontSize: '0.95rem' }}>{meta.emoji}</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.label}
                        </span>
                        {e.time && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{e.time}</span>}
                      </Link>
                    );
                  })}
                  {tomorrowsEvents.length > 4 && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', paddingTop: 4 }}>
                      + {tomorrowsEvents.length - 4} autre{tomorrowsEvents.length - 4 > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Month summary by kind */}
      {!loading && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8,
          marginBottom: 14,
        }}>
          {(Object.keys(KIND_META) as EventKind[]).filter(k => k !== 'script_due' && k !== 'onboarding_deadline' || monthCountsByKind[k] > 0).map(k => {
            const meta = KIND_META[k];
            const count = monthCountsByKind[k];
            const active = activeKinds.includes(k);
            const filterApplied = activeKinds.length > 0;
            return (
              <button key={k} onClick={() => toggleKind(k)} style={{
                background: active ? meta.color + '20' : 'var(--night-card)',
                border: `1px solid ${active ? meta.color : 'var(--border)'}`,
                borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
                textAlign: 'left', transition: 'all .15s',
                opacity: !active && filterApplied ? 0.55 : 1,
              }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden>{meta.emoji}</span> {meta.label}
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: meta.color, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                  {count}
                </div>
              </button>
            );
          })}
          {activeKinds.length > 0 && (
            <button onClick={() => setActiveKinds([])} style={{
              background: 'transparent', border: '1px dashed var(--border-md)',
              borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
              color: 'var(--orange)', fontSize: '0.8rem', fontWeight: 600,
            }}>
              ✕ Tout afficher
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '40px 0', textAlign: 'center' }}>Chargement…</div>
      ) : (
        <div className="cal-root" style={{
          background: 'var(--night-card)', borderRadius: 14,
          border: '1px solid var(--border)', padding: 22,
          overflowX: 'auto', ...cssVars,
        }}>
          {/* Month nav */}
          <div className="cal-header-row" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 18, gap: 12,
          }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <NavBtn onClick={prev} label="◀" title="Mois précédent" />
              <NavBtn onClick={next} label="▶" title="Mois suivant" />
            </div>
            <span className="cal-title" style={{
              fontWeight: 700, fontSize: '1.15rem',
              fontFamily: "'Bricolage Grotesque', sans-serif",
            }}>
              {MONTHS[month]} {year}
            </span>
            <button onClick={goToday} style={{
              background: isCurrentMonth ? 'rgba(232,105,43,.12)' : 'var(--night-mid)',
              border: isCurrentMonth ? '1px solid var(--border-orange)' : '1px solid var(--border-md)',
              borderRadius: 8, color: isCurrentMonth ? 'var(--orange)' : 'var(--text-mid)',
              cursor: 'pointer', padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600,
            }}>
              📍 Aujourd&apos;hui
            </button>
          </div>

          {/* Day headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 'var(--cal-gap)', marginBottom: 4,
            minWidth: 'calc(7 * var(--cal-cell-min))',
          }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{
                textAlign: 'center', fontSize: '0.72rem', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                color: i >= 5 ? 'var(--text-muted)' : 'var(--text-mid)',
                opacity: i >= 5 ? 0.5 : 0.7, padding: '6px 0',
              }}>{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 'var(--cal-gap)', minWidth: 'calc(7 * var(--cal-cell-min))',
          }}>
            {days.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} style={{
                  minHeight: 'var(--cal-cell-min)', borderRadius: 8,
                  background: 'rgba(0,0,0,.06)', border: '1px solid transparent',
                }} />;
              }

              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === today;
              const isPast = dateStr < today;
              const dayEvents = eventsByDate[dateStr] || [];
              const isWeekend = (i % 7) >= 5;
              const isExpanded = expandedDay === dateStr;
              const hasSlots = dayEvents.length > 0;

              const isDropTarget = dragOverDate === dateStr && draggingEventId !== null;
              return (
                <div key={`day-${i}`}>
                  <div
                    onClick={() => setExpandedDay(isExpanded ? null : dateStr)}
                    onDragOver={(e) => {
                      if (!draggingEventId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverDate !== dateStr) setDragOverDate(dateStr);
                    }}
                    onDragLeave={() => { if (dragOverDate === dateStr) setDragOverDate(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const evId = e.dataTransfer.getData('text/plain') || draggingEventId;
                      if (evId) handleDropOnDate(dateStr, evId);
                    }}
                    style={{
                      minHeight: 'var(--cal-cell-min)', borderRadius: 8,
                      padding: 'var(--cal-cell-pad)', cursor: 'pointer',
                      transition: 'all .15s',
                      background: isDropTarget ? 'rgba(232,105,43,.18)' : isToday ? 'rgba(232,105,43,.07)' : isWeekend ? 'rgba(0,0,0,.12)' : 'var(--night-mid)',
                      border: isDropTarget ? '2px dashed var(--orange)' : isToday ? '2px solid var(--orange)' : '1px solid rgba(255,255,255,.04)',
                      boxShadow: isToday ? '0 0 0 3px rgba(232,105,43,.15)' : 'none',
                      opacity: isPast && !isToday ? 0.55 : isWeekend ? 0.7 : 1,
                    }}
                  >
                    <div style={{
                      fontSize: 'var(--cal-font-day)',
                      fontWeight: isToday ? 800 : hasSlots ? 600 : 400,
                      color: isToday ? 'var(--orange)' : hasSlots ? 'var(--text)' : 'var(--text-muted)',
                      marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <span>{day}</span>
                      {hasSlots && (
                        <div style={{ display: 'flex', gap: 2 }}>
                          {Array.from(new Set(dayEvents.map(e => e.kind))).slice(0, 4).map(k => (
                            <span key={k} aria-hidden style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: KIND_META[k].color, opacity: 0.9,
                            }} />
                          ))}
                        </div>
                      )}
                    </div>

                    {dayEvents.slice(0, 3).map(e => {
                      const meta = KIND_META[e.kind];
                      const draggable = e.kind === 'filming' && !rescheduling;
                      // Compute the target URL — same logic as expanded view
                      const eventHref =
                        e.kind === 'closing_call'
                          ? `/dashboard/pipeline${e.label ? `?q=${encodeURIComponent(e.label)}` : ''}`
                          : e.client_id
                            ? `/dashboard/clients/${e.client_id}${
                                e.kind === 'filming' ? '?tab=delivery'
                                : e.kind === 'onboarding_call' || e.kind === 'appt_other' ? '?tab=ghl'
                                : e.kind === 'script_sent' || e.kind === 'script_due' ? '?tab=script'
                                : ''
                              }`
                            : `/dashboard/pipeline${e.label ? `?q=${encodeURIComponent(e.label)}` : ''}`;
                      return (
                        <div
                          key={e.id}
                          draggable={draggable}
                          onDragStart={(ev) => {
                            if (!draggable) return;
                            ev.dataTransfer.setData('text/plain', e.id);
                            ev.dataTransfer.effectAllowed = 'move';
                            setDraggingEventId(e.id);
                          }}
                          onDragEnd={() => { setDraggingEventId(null); setDragOverDate(null); }}
                          onClick={(ev) => {
                            // Don't navigate if drag is in progress
                            if (draggingEventId) return;
                            ev.stopPropagation();
                            if (typeof window !== 'undefined') window.location.href = eventHref;
                          }}
                          title={draggable ? 'Glissez sur un autre jour pour reprogrammer · clic pour ouvrir' : 'Clic pour ouvrir'}
                          style={{
                            fontSize: 'var(--cal-font-slot)', padding: '2px 5px',
                            borderRadius: 4, marginBottom: 2,
                            background: meta.color + '18', borderLeft: `2px solid ${meta.color}`,
                            color: meta.color, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', fontWeight: 500, lineHeight: 1.4,
                            textDecoration: e.done ? 'line-through' : 'none',
                            opacity: e.done ? 0.6 : draggingEventId === e.id ? 0.4 : 1,
                            cursor: draggable ? 'grab' : 'pointer',
                          }}
                        >
                          <span aria-hidden style={{ marginRight: 3 }}>{meta.emoji}</span>
                          {e.time ? `${e.time} ` : ''}{e.label}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div style={{
                        fontSize: 'var(--cal-font-slot)', color: 'var(--text-muted)',
                        fontWeight: 500, paddingLeft: 5,
                      }}>
                        +{dayEvents.length - 3} autres
                      </div>
                    )}
                  </div>

                  {/* Expanded day detail */}
                  {isExpanded && (
                    <div style={{
                      marginTop: 4, background: 'var(--night-card)',
                      border: '1px solid var(--border-md)', borderRadius: 10,
                      padding: '10px 12px',
                    }}>
                      <div style={{
                        fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-mid)',
                        marginBottom: 8, display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>{day} {MONTHS[month]} {year}</span>
                        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                          {dayEvents.length} évènement{dayEvents.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {dayEvents.length === 0 ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 0' }}>
                          Rien de prévu ce jour-là
                        </div>
                      ) : (
                        dayEvents.map(e => {
                          const meta = KIND_META[e.kind];
                          const inner = (
                            <>
                              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, textDecoration: e.done ? 'line-through' : 'none' }}>
                                <span aria-hidden>{meta.emoji}</span>
                                {e.label}
                              </div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                                {e.time && (
                                  <span style={{ fontSize: '0.66rem', color: 'var(--text-mid)', fontWeight: 500 }}>
                                    🕐 {e.time}
                                  </span>
                                )}
                                <span style={{
                                  fontSize: '0.62rem', padding: '1px 7px', borderRadius: 20,
                                  background: meta.color + '20', color: meta.color, fontWeight: 600,
                                }}>{meta.label}</span>
                                {e.status && (
                                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                                    {STATUS_LABELS[e.status] || e.status}
                                  </span>
                                )}
                              </div>
                            </>
                          );
                          // Route the click to the page where the user can take action :
                          //  - GHL closing call : /pipeline (modal d'édition avec actions GHL)
                          //  - GHL appointment lié à un client : /clients/[id]?tab=ghl
                          //  - Filming (clients table) : /clients/[id]?tab=delivery
                          //  - Script events : /clients/[id]?tab=script
                          //  - Otherwise : /pipeline (search-friendly)
                          const targetHref =
                            e.kind === 'closing_call'
                              ? `/dashboard/pipeline${e.label ? `?q=${encodeURIComponent(e.label)}` : ''}`
                              : e.client_id
                                ? `/dashboard/clients/${e.client_id}${
                                    e.kind === 'filming' ? '?tab=delivery'
                                    : e.kind === 'onboarding_call' || e.kind === 'appt_other' ? '?tab=ghl'
                                    : e.kind === 'script_sent' || e.kind === 'script_due' ? '?tab=script'
                                    : ''
                                  }`
                                : `/dashboard/pipeline${e.label ? `?q=${encodeURIComponent(e.label)}` : ''}`;
                          return (
                            <Link key={e.id} href={targetHref} style={{
                              display: 'block', padding: '8px 10px', borderRadius: 8,
                              background: meta.color + '10', borderLeft: `3px solid ${meta.color}`,
                              marginBottom: 6, textDecoration: 'none',
                              transition: 'background .15s, transform .15s',
                            }}
                              onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.background = meta.color + '20'; (ev.currentTarget as HTMLElement).style.transform = 'translateX(2px)'; }}
                              onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.background = meta.color + '10'; (ev.currentTarget as HTMLElement).style.transform = 'none'; }}
                            >
                              {inner}
                            </Link>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 12,
            marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)',
          }}>
            {(Object.keys(KIND_META) as EventKind[]).map(k => {
              const meta = KIND_META[k];
              return (
                <div key={k} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: '0.7rem', color: 'var(--text-muted)',
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color }} />
                  <span aria-hidden>{meta.emoji}</span>
                  {meta.label}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: '1px 6px', borderRadius: 4, background: 'var(--night-mid)',
  border: '1px solid var(--border-md)', fontSize: '0.65rem', fontFamily: 'monospace',
};

function NavBtn({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'var(--night-mid)', border: '1px solid var(--border-md)',
      borderRadius: 8, color: 'var(--text-mid)', cursor: 'pointer',
      padding: '7px 14px', fontSize: '0.9rem', fontWeight: 600,
      transition: 'background .15s', lineHeight: 1,
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-md)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
    >
      {label}
    </button>
  );
}
