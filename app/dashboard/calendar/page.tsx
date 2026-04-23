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

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('bbp_token')}`, 'Content-Type': 'application/json' };
}

export default function CalendarPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  const loadClients = useCallback(() => {
    fetch('/api/clients', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setClients(d); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

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
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.5rem', marginBottom: 24 }}>
        Calendrier
      </h1>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
      ) : (
        <div style={{ background: 'var(--night-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <button onClick={prev} style={{
              background: 'var(--night-mid)', border: '1px solid var(--border-md)', borderRadius: 8,
              color: 'var(--text-mid)', cursor: 'pointer', padding: '6px 12px', fontSize: '0.85rem',
            }}>←</button>
            <span style={{ fontWeight: 600, fontSize: '1rem' }}>{MONTHS[month]} {year}</span>
            <button onClick={next} style={{
              background: 'var(--night-mid)', border: '1px solid var(--border-md)', borderRadius: 8,
              color: 'var(--text-mid)', cursor: 'pointer', padding: '6px 12px', fontSize: '0.85rem',
            }}>→</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: '0.7rem', fontWeight: 600,
                color: 'var(--text-muted)', padding: '4px 0',
              }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {days.map((day, i) => {
              if (day === null) return <div key={i} style={{ minHeight: 80 }} />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = dateStr === today;
              const dayClients = filmingByDate[dateStr] || [];
              const isWeekend = (i % 7) >= 5;

              return (
                <div key={i} style={{
                  minHeight: 80, borderRadius: 8, padding: '4px 6px',
                  background: isToday ? 'rgba(232,105,43,.08)' : isWeekend ? 'rgba(0,0,0,.15)' : 'var(--night-mid)',
                  border: isToday ? '1px solid var(--border-orange)' : '1px solid transparent',
                }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: isToday ? 700 : 400,
                    color: isToday ? 'var(--orange)' : 'var(--text-muted)', marginBottom: 4,
                  }}>{day}</div>
                  {dayClients.map(c => (
                    <div key={c.id} style={{
                      fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, marginBottom: 2,
                      background: STATUS_COLORS[c.status] + '20',
                      color: STATUS_COLORS[c.status],
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{c.business_name}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
