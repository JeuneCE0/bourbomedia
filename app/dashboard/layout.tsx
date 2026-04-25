'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ToastProvider } from '@/components/ui/Toast';

const NAV_SECTIONS: { title: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    title: 'Pilotage',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
      { href: '/dashboard/pipeline', label: 'Pipeline', icon: '📊' },
      { href: '/dashboard/tasks', label: 'Tâches', icon: '✅' },
      { href: '/dashboard/scripts', label: 'Scripts / Tournages', icon: '📝' },
    ],
  },
  {
    title: 'Données',
    items: [
      { href: '/dashboard/clients', label: 'Clients', icon: '👥' },
      { href: '/dashboard/calendar', label: 'Calendrier', icon: '📅' },
      { href: '/dashboard/onboarding', label: 'Onboarding', icon: '🚀' },
      { href: '/dashboard/team', label: 'Équipe', icon: '👤' },
    ],
  },
];

interface SearchResult {
  type: 'client' | 'script' | 'comment';
  id: string;
  client_id: string;
  title: string;
  subtitle: string;
  status?: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  const [hoveredLogout, setHoveredLogout] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLDivElement>(null);

  const isLoginPage = pathname === '/dashboard/login' || pathname === '/dashboard/login/';
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.trim().length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('bbp_token');
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (r.ok) {
          const data = await r.json();
          setSearchResults(data);
          setSearchOpen(true);
        }
      } catch { /* */ }
    }, 300);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('global-search') as HTMLInputElement;
        input?.focus();
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKeyDown); };
  }, []);

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

  if (isLoginPage) return <ToastProvider>{children}</ToastProvider>;

  if (checking) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--night)' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
    </div>
  );

  const p = pathname?.replace(/\/$/, '') || '';
  const isActive = (href: string) => href === '/dashboard' ? p === '/dashboard' : p.startsWith(href);

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

      {/* Search */}
      {(!(collapsed && !isMobile)) && (
        <div ref={searchRef} style={{ padding: '10px 12px 0', position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 8,
            background: 'var(--night)', border: '1px solid var(--border-md)',
          }}>
            <span aria-hidden style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1 }}>🔍</span>
            <input
              id="global-search"
              type="text"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
              placeholder="Rechercher… ⌘K"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: '0.78rem', padding: 0,
              }}
            />
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 999,
              background: 'var(--night-card)', border: '1px solid var(--border-md)',
              borderRadius: 10, marginTop: 4, maxHeight: 320, overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,.5)',
            }}>
              {searchResults.map(r => (
                <Link
                  key={`${r.type}-${r.id}`}
                  href={`/dashboard/clients/${r.client_id}`}
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', textDecoration: 'none',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    background: r.type === 'client' ? 'rgba(232,105,43,.12)' : r.type === 'script' ? 'rgba(250,204,21,.12)' : 'rgba(139,92,246,.12)',
                    color: r.type === 'client' ? 'var(--orange)' : r.type === 'script' ? 'var(--yellow)' : '#8B5CF6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 700,
                  }} aria-hidden>{r.type === 'client' ? '👤' : r.type === 'script' ? '📝' : '💬'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav style={{ padding: '12px 8px', flex: 1 }}>
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.title} style={{ marginBottom: sIdx === NAV_SECTIONS.length - 1 ? 0 : 14 }}>
            {(!(collapsed && !isMobile)) && (
              <div style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '0 12px 6px',
              }}>
                {section.title}
              </div>
            )}
            {collapsed && !isMobile && sIdx > 0 && (
              <div style={{ height: 1, background: 'var(--border)', margin: '8px 12px 8px' }} />
            )}
            {section.items.map(item => {
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
                    marginBottom: 2,
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
          </div>
        ))}
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
          <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1 }}>🚪</span>
          {(!(collapsed && !isMobile)) && <span>Déconnexion</span>}
        </button>
      </div>
    </>
  );

  return (
    <ToastProvider>
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
          position: 'relative',
        }}>
          {/* Mobile search bar */}
          {isMobile && (
            <div ref={!isMobile ? undefined : searchRef} style={{ padding: '12px 16px 0', position: 'relative' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              }}>
                <span aria-hidden style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1 }}>🔍</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
                  placeholder="Rechercher…"
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: 'var(--text)', fontSize: '0.82rem', padding: 0,
                  }}
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 16, right: 16, zIndex: 999,
                  background: 'var(--night-card)', border: '1px solid var(--border-md)',
                  borderRadius: 10, marginTop: 4, maxHeight: 320, overflowY: 'auto',
                  boxShadow: '0 8px 24px rgba(0,0,0,.5)',
                }}>
                  {searchResults.map(r => (
                    <Link
                      key={`m-${r.type}-${r.id}`}
                      href={`/dashboard/clients/${r.client_id}`}
                      onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', textDecoration: 'none',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{
                        width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                        background: r.type === 'client' ? 'rgba(232,105,43,.12)' : r.type === 'script' ? 'rgba(250,204,21,.12)' : 'rgba(139,92,246,.12)',
                        color: r.type === 'client' ? 'var(--orange)' : r.type === 'script' ? 'var(--yellow)' : '#8B5CF6',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontWeight: 700,
                      }} aria-hidden>{r.type === 'client' ? '👤' : r.type === 'script' ? '📝' : '💬'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
