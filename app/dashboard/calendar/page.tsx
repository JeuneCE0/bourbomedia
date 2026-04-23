'use client';

import { useEffect, useState, useCallback } from 'react';

interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  status: string;
  filming_date?: string;
}

const STATUS_COLORS: Record<string, string> = {
  onboarding: '#8A7060',
  script_writing: '#FACC15',
  script_review: '#F28C55',
  script_validated: '#22C55E',
  filming_scheduled: '#3B82F6',
  filming_done: '#8B5CF6',
  editing: '#EC4899',
  published: '#22C55E',
};

const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  script_writing: 'Écriture',
  script_review: 'Révision',
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

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function CalendarPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const loadClients = useCallback(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();

  const filmingByDate: Record<string, Client[]> = {};
  clients.forEach(c => {
    if (c.filming_date) {
      const key = c.filming_date.slice(0, 10);
      if (!filmingByDate[key]) filmingByDate[key] = [];
      filmingByDate[key].push(c);
    }
  });

  const days: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let i = 1; i <= totalDays; i++) days.push(i);
  while (days.length % 7 !== 0) days.push(null);

  const prev = () => setCurrentDate(new Date(year, month - 1, 1));
  const next = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => {
    setCurrentDate(new Date());
    setExpandedDay(null);
  };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;

  const cssVars = {
    '--cal-cell-min': '88px',
    '--cal-cell-pad': '6px 8px',
    '--cal-font-day': '0.75rem',
    '--cal-font-slot': '0.68rem',
    '--cal-gap': '3px',
  } as React.CSSProperties;

  return (
    <div style={{
      padding: '28px 32px',
      ...cssVars,
    }}>
      <style>{`
        @media (max-width: 768px) {
          .cal-root {
            --cal-cell-min: 44px !important;
            --cal-cell-pad: 3px 4px !important;
            --cal-font-day: 0.65rem !important;
            --cal-font-slot: 0.58rem !important;
            --cal-gap: 2px !important;
            padding: 16px 12px !important;
          }
          .cal-header-row { flex-wrap: wrap !important; gap: 8px !important; }
          .cal-title { font-size: 1.1rem !important; }
          .cal-slot-label { display: none; }
          .cal-slot-dot { display: inline-block !important; }
        }
        @media (max-width: 480px) {
          .cal-root {
            --cal-cell-min: 36px !important;
            padding: 10px 6px !important;
          }
        }
      `}</style>

      <h1 style={{
        fontFamily: "'Bricolage Grotesque', sans-serif",
        fontWeight: 700,
        fontSize: '1.5rem',
        marginBottom: 24,
      }}>
        Calendrier
      </h1>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement...</div>
      ) : (
        <div className="cal-root" style={{
          background: 'var(--night-card)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          padding: 22,
          overflowX: 'auto',
          ...cssVars,
        }}>
          {/* Month navigation */}
          <div className="cal-header-row" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            gap: 12,
          }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={prev} style={{
                background: 'var(--night-mid)',
                border: '1px solid var(--border-md)',
                borderRadius: 8,
                color: 'var(--text-mid)',
                cursor: 'pointer',
                padding: '7px 14px',
                fontSize: '0.9rem',
                fontWeight: 600,
                transition: 'background .15s, border-color .15s',
                lineHeight: 1,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-md)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
              title="Mois précédent (flèche gauche)"
              >
                &#8592;
              </button>
              <button onClick={next} style={{
                background: 'var(--night-mid)',
                border: '1px solid var(--border-md)',
                borderRadius: 8,
                color: 'var(--text-mid)',
                cursor: 'pointer',
                padding: '7px 14px',
                fontSize: '0.9rem',
                fontWeight: 600,
                transition: 'background .15s, border-color .15s',
                lineHeight: 1,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-md)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--night-mid)'; }}
              title="Mois suivant (flèche droite)"
              >
                &#8594;
              </button>
            </div>

            <span className="cal-title" style={{
              fontWeight: 700,
              fontSize: '1.15rem',
              fontFamily: "'Bricolage Grotesque', sans-serif",
              letterSpacing: '-0.01em',
            }}>
              {MONTHS[month]} {year}
            </span>

            <button onClick={goToday} style={{
              background: isCurrentMonth ? 'rgba(232,105,43,.12)' : 'var(--night-mid)',
              border: isCurrentMonth ? '1px solid var(--border-orange)' : '1px solid var(--border-md)',
              borderRadius: 8,
              color: isCurrentMonth ? 'var(--orange)' : 'var(--text-mid)',
              cursor: 'pointer',
              padding: '7px 14px',
              fontSize: '0.78rem',
              fontWeight: 600,
              transition: 'all .15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(232,105,43,.18)';
              e.currentTarget.style.borderColor = 'var(--border-orange)';
              e.currentTarget.style.color = 'var(--orange)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = isCurrentMonth ? 'rgba(232,105,43,.12)' : 'var(--night-mid)';
              e.currentTarget.style.borderColor = isCurrentMonth ? 'var(--border-orange)' : 'var(--border-md)';
              e.currentTarget.style.color = isCurrentMonth ? 'var(--orange)' : 'var(--text-mid)';
            }}
            >
              Aujourd&apos;hui
            </button>
          </div>

          {/* Day headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 'var(--cal-gap)',
            marginBottom: 4,
            minWidth: 'calc(7 * var(--cal-cell-min))',
          }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{
                textAlign: 'center',
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: i >= 5 ? 'var(--text-muted)' : 'var(--text-mid)',
                opacity: i >= 5 ? 0.5 : 0.7,
                padding: '6px 0',
              }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 'var(--cal-gap)',
            minWidth: 'calc(7 * var(--cal-cell-min))',
          }}>
            {days.map((day, i) => {
              if (day === null) {
                return (
                  <div key={`empty-${i}`} style={{
                    minHeight: 'var(--cal-cell-min)',
                    borderRadius: 8,
                    background: 'rgba(0,0,0,.06)',
                    border: '1px solid transparent',
                  }} />
                );
              }

              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === today;
              const isPast = dateStr < today;
              const dayClients = filmingByDate[dateStr] || [];
              const isWeekend = (i % 7) >= 5;
              const isExpanded = expandedDay === dateStr;
              const hasSlots = dayClients.length > 0;

              return (
                <div key={`day-${i}`}>
                  <div
                    onClick={() => setExpandedDay(isExpanded ? null : dateStr)}
                    style={{
                      minHeight: 'var(--cal-cell-min)',
                      borderRadius: 8,
                      padding: 'var(--cal-cell-pad)',
                      cursor: 'pointer',
                      transition: 'all .15s',
                      background: isToday
                        ? 'rgba(232,105,43,.07)'
                        : isWeekend
                          ? 'rgba(0,0,0,.12)'
                          : 'var(--night-mid)',
                      border: isToday
                        ? '2px solid var(--orange)'
                        : '1px solid rgba(255,255,255,.04)',
                      boxShadow: isToday
                        ? '0 0 0 3px rgba(232,105,43,.15), inset 0 0 0 1px rgba(232,105,43,.1)'
                        : 'none',
                      opacity: isPast && !isToday ? 0.55 : isWeekend ? 0.7 : 1,
                      position: 'relative',
                    }}
                    onMouseEnter={e => {
                      if (!isToday) {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,.12)';
                        e.currentTarget.style.background = isWeekend ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.04)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isToday) {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,.04)';
                        e.currentTarget.style.background = isWeekend ? 'rgba(0,0,0,.12)' : 'var(--night-mid)';
                      }
                    }}
                  >
                    {/* Day number */}
                    <div style={{
                      fontSize: 'var(--cal-font-day)',
                      fontWeight: isToday ? 800 : hasSlots ? 600 : 400,
                      color: isToday ? 'var(--orange)' : hasSlots ? 'var(--text)' : 'var(--text-muted)',
                      marginBottom: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <span>{day}</span>
                      {hasSlots && (
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--orange)',
                          display: 'inline-block',
                          opacity: 0.7,
                        }} />
                      )}
                    </div>

                    {/* Filming slots preview */}
                    {dayClients.slice(0, 2).map(c => {
                      const color = STATUS_COLORS[c.status] || '#8A7060';
                      const time = c.filming_date ? formatTime(c.filming_date) : '';
                      return (
                        <div key={c.id} style={{
                          fontSize: 'var(--cal-font-slot)',
                          padding: '2px 5px',
                          borderRadius: 4,
                          marginBottom: 2,
                          background: color + '18',
                          borderLeft: `2px solid ${color}`,
                          color: color,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 500,
                          lineHeight: 1.4,
                        }}>
                          <span className="cal-slot-dot" style={{ display: 'none' }}>
                            &#9679;
                          </span>
                          <span className="cal-slot-label">
                            {time ? `${time} ` : ''}{c.business_name}
                          </span>
                        </div>
                      );
                    })}
                    {dayClients.length > 2 && (
                      <div style={{
                        fontSize: 'var(--cal-font-slot)',
                        color: 'var(--text-muted)',
                        fontWeight: 500,
                        paddingLeft: 5,
                      }}>
                        +{dayClients.length - 2} de plus
                      </div>
                    )}
                  </div>

                  {/* Expanded day detail */}
                  {isExpanded && (
                    <div style={{
                      marginTop: 4,
                      background: 'var(--night-card)',
                      border: '1px solid var(--border-md)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      animation: 'fadeIn .15s ease-out',
                    }}>
                      <div style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: 'var(--text-mid)',
                        marginBottom: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <span>{day} {MONTHS[month]} {year}</span>
                        <span style={{
                          fontSize: '0.65rem',
                          color: 'var(--text-muted)',
                          fontWeight: 400,
                        }}>
                          {dayClients.length} tournage{dayClients.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {dayClients.length === 0 ? (
                        <div style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          fontStyle: 'italic',
                          padding: '6px 0',
                        }}>
                          Aucun tournage planifie
                        </div>
                      ) : (
                        dayClients.map(c => {
                          const color = STATUS_COLORS[c.status] || '#8A7060';
                          const label = STATUS_LABELS[c.status] || c.status;
                          const time = c.filming_date ? formatTime(c.filming_date) : '';
                          return (
                            <div key={c.id} style={{
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: color + '10',
                              borderLeft: `3px solid ${color}`,
                              marginBottom: 6,
                            }}>
                              <div style={{
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                color: 'var(--text)',
                                marginBottom: 2,
                              }}>
                                {c.business_name}
                              </div>
                              <div style={{
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                              }}>
                                {c.contact_name}
                              </div>
                              <div style={{
                                display: 'flex',
                                gap: 8,
                                marginTop: 4,
                                alignItems: 'center',
                              }}>
                                {time && (
                                  <span style={{
                                    fontSize: '0.68rem',
                                    color: 'var(--text-mid)',
                                    fontWeight: 500,
                                  }}>
                                    &#128337; {time}
                                  </span>
                                )}
                                <span style={{
                                  fontSize: '0.65rem',
                                  padding: '1px 7px',
                                  borderRadius: 20,
                                  background: color + '20',
                                  color: color,
                                  fontWeight: 600,
                                }}>
                                  {label}
                                </span>
                              </div>
                            </div>
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
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
          }}>
            {Object.entries(STATUS_COLORS).map(([key, color]) => (
              <div key={key} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: '0.65rem',
                color: 'var(--text-muted)',
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  display: 'inline-block',
                }} />
                {STATUS_LABELS[key] || key}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
