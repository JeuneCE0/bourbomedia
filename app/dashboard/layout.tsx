'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV = [
  { href: '/dashboard', label: 'Tableau de bord', icon: '▣' },
  { href: '/dashboard/clients', label: 'Clients', icon: '◉' },
  { href: '/dashboard/calendar', label: 'Calendrier', icon: '▦' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [checking, setChecking] = useState(true);

  const isLoginPage = pathname === '/dashboard/login';

  useEffect(() => {
    if (isLoginPage) { setChecking(false); return; }
    const token = localStorage.getItem('bbp_token');
    if (!token) { router.replace('/dashboard/login'); return; }
    fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(); setChecking(false); })
      .catch(() => { localStorage.removeItem('bbp_token'); router.replace('/dashboard/login'); });
  }, [router, isLoginPage]);

  if (isLoginPage) return <>{children}</>;

  if (checking) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--night)' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
    </div>
  );

  const isActive = (href: string) => href === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(href);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--night)' }}>
      <aside style={{
        width: collapsed ? 60 : 220,
        background: 'var(--night-mid)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width .2s',
        flexShrink: 0,
      }}>
        <div style={{
          padding: collapsed ? '20px 10px' : '20px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}>
          {!collapsed && (
            <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1rem', color: 'var(--orange)' }}>
              BourbonMédia
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: '1.1rem', padding: 4,
            }}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>

        <nav style={{ padding: '12px 8px', flex: 1 }}>
          {NAV.map(item => (
            <Link key={item.href} href={item.href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: collapsed ? '10px 0' : '10px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 8,
              marginBottom: 4,
              textDecoration: 'none',
              fontSize: '0.85rem',
              fontWeight: isActive(item.href) ? 600 : 400,
              color: isActive(item.href) ? 'var(--orange)' : 'var(--text-mid)',
              background: isActive(item.href) ? 'rgba(232,105,43,.1)' : 'transparent',
              transition: 'all .15s',
            }}>
              <span style={{ fontSize: '1rem' }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { localStorage.removeItem('bbp_token'); router.replace('/dashboard/login'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: collapsed ? '10px 0' : '10px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              background: 'none', border: 'none', borderRadius: 8,
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            <span style={{ fontSize: '1rem' }}>⏻</span>
            {!collapsed && <span>Déconnexion</span>}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
