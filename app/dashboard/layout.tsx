'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

const NAV = [
  { href: '/dashboard', label: 'Tableau de bord', icon: '▣' },
  { href: '/dashboard/onboarding', label: 'Onboarding', icon: '◎' },
  { href: '/dashboard/clients', label: 'Clients', icon: '◉' },
  { href: '/dashboard/calendar', label: 'Calendrier', icon: '▦' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  const [hoveredLogout, setHoveredLogout] = useState(false);

  const isLoginPage = pathname === '/dashboard/login' || pathname === '/dashboard/login/';

  // Responsive breakpoint detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Auth check — kept exactly as-is
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

  const p = pathname?.replace(/\/$/, '') || '';
  const isActive = (href: string) => href === '/dashboard' ? p === '/dashboard' : p.startsWith(href);

  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  const sidebarWidth = collapsed && !isMobile ? 60 : 220;

  // Shared sidebar content
  const sidebarContent = (
    <>
      {/* Sidebar header */}
      <div style={{
        padding: collapsed && !isMobile ? '20px 10px' : '20px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
        minHeight: 60,
      }}>
        {(!(collapsed && !isMobile)) && (
          <span style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 700,
            fontSize: '1rem',
            color: 'var(--orange)',
            letterSpacing: '-0.01em',
          }}>
            BourbonMédia
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.1rem',
              padding: 4,
              borderRadius: 4,
              transition: 'color .15s',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        )}
        {isMobile && (
          <button
            onClick={closeMobileSidebar}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.3rem',
              padding: 4,
              borderRadius: 4,
              transition: 'color .15s',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            aria-label="Fermer le menu"
          >
            ✕
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ padding: '12px 8px', flex: 1 }}>
        {NAV.map(item => {
          const active = isActive(item.href);
          const hovered = hoveredNav === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={() => setHoveredNav(item.href)}
              onMouseLeave={() => setHoveredNav(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed && !isMobile ? '10px 0' : '10px 12px',
                justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                borderRadius: 8,
                marginBottom: 4,
                textDecoration: 'none',
                fontSize: '0.85rem',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--orange)' : hovered ? 'var(--text)' : 'var(--text-mid)',
                background: active
                  ? 'rgba(232,105,43,.1)'
                  : hovered
                    ? 'rgba(255,255,255,.04)'
                    : 'transparent',
                transition: 'all .15s ease',
                borderLeft: active ? '3px solid var(--orange)' : '3px solid transparent',
              }}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>{item.icon}</span>
              {(!(collapsed && !isMobile)) && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => { localStorage.removeItem('bbp_token'); router.replace('/dashboard/login'); }}
          onMouseEnter={() => setHoveredLogout(true)}
          onMouseLeave={() => setHoveredLogout(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: collapsed && !isMobile ? '10px 0' : '10px 12px',
            justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
            background: hoveredLogout ? 'rgba(239,68,68,.08)' : 'none',
            border: 'none',
            borderRadius: 8,
            color: hoveredLogout ? 'var(--red)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            transition: 'all .15s ease',
          }}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>⏻</span>
          {(!(collapsed && !isMobile)) && <span>Déconnexion</span>}
        </button>
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--night)' }}>
      {/* Mobile top header bar */}
      {isMobile && (
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 56,
          background: 'var(--night-mid)',
          borderBottom: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 700,
            fontSize: '1rem',
            color: 'var(--orange)',
            letterSpacing: '-0.01em',
          }}>
            BourbonMédia
          </span>
          <button
            onClick={() => setMobileOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text)',
              cursor: 'pointer',
              padding: 8,
              borderRadius: 6,
              fontSize: '1.2rem',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Ouvrir le menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </header>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <aside style={{
            width: sidebarWidth,
            background: 'var(--night-mid)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            transition: 'width .2s ease',
            flexShrink: 0,
            height: '100vh',
            position: 'sticky',
            top: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}>
            {sidebarContent}
          </aside>
        )}

        {/* Mobile sidebar overlay */}
        {isMobile && (
          <>
            {/* Backdrop */}
            <div
              onClick={closeMobileSidebar}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,.6)',
                zIndex: 200,
                opacity: mobileOpen ? 1 : 0,
                pointerEvents: mobileOpen ? 'auto' : 'none',
                transition: 'opacity .25s ease',
              }}
            />
            {/* Sidebar drawer */}
            <aside style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: 260,
              maxWidth: '80vw',
              background: 'var(--night-mid)',
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 300,
              transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform .25s ease',
              overflowY: 'auto',
              boxShadow: mobileOpen ? '4px 0 24px rgba(0,0,0,.4)' : 'none',
            }}>
              {sidebarContent}
            </aside>
          </>
        )}

        {/* Main content */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
        }}>
          {children}
        </main>
      </div>
    </div>
  );
}
