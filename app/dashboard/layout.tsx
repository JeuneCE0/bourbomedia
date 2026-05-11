'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ToastProvider } from '@/components/ui/Toast';
import ErrorBoundary from '@/components/ErrorBoundary';
import DensityProvider from '@/components/DensityProvider';

// Composants chargés à la demande : aucun n'est visible au mount du
// dashboard, ils ne deviennent utiles qu'au déclenchement d'un trigger
// (Cmd+K pour CommandPalette, première visite pour WelcomeWizard, hover
// pour AiCopilot, ?/h pour ShortcutsCheatsheet, dégradation réseau pour
// OfflineIndicator). Lazy-load économise du JS first-load sur le dashboard.
const NotificationBell = dynamic(() => import('@/components/NotificationBell'), { ssr: false });
const AiCopilot = dynamic(() => import('@/components/AiCopilot'), { ssr: false });
const WelcomeWizard = dynamic(() => import('@/components/WelcomeWizard'), { ssr: false });
const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false });
const ShortcutsCheatsheet = dynamic(() => import('@/components/ShortcutsCheatsheet'), { ssr: false });
const OfflineIndicator = dynamic(() => import('@/components/OfflineIndicator'), { ssr: false });
const InstallPWAPrompt = dynamic(() => import('@/components/InstallPWAPrompt'), { ssr: false });

const NAV_SECTIONS: { title: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    title: '',
    items: [
      { href: '/dashboard',                       label: 'Dashboard',     icon: '🏠' },
      { href: '/dashboard/pipeline?tab=commerciale', label: 'Prospects GHL', icon: '🎯' },
      { href: '/dashboard/pipeline?tab=onboarding',  label: 'Production',    icon: '🚀' },
      { href: '/dashboard/pipeline?tab=clients',     label: 'Clients',       icon: '👥' },
      { href: '/dashboard/tasks',                 label: 'Tâches',        icon: '✅' },
      { href: '/dashboard/scripts',     label: 'Scripts',         icon: '📝' },
      { href: '/dashboard/calendar',    label: 'Calendriers',     icon: '📅' },
      { href: '/dashboard/finance',     label: 'Finances',        icon: '💰' },
      { href: '/dashboard/stats',       label: 'Statistiques',    icon: '📈' },
      { href: '/dashboard/funnel',      label: 'Funnel',          icon: '📊' },
      { href: '/dashboard/errors',      label: 'Erreurs',         icon: '🪲' },
      { href: '/dashboard/health',      label: 'Health',          icon: '🩺' },
      { href: '/dashboard/settings',    label: 'Paramètres',      icon: '⚙️' },
    ],
  },
];

interface SearchResult {
  type: 'client' | 'script' | 'comment' | 'script_content' | 'opportunity' | 'payment';
  id: string;
  client_id: string;
  title: string;
  subtitle: string;
  status?: string;
  highlight?: string;
  href?: string;
}

const RESULT_TYPE_META: Record<SearchResult['type'], { emoji: string; bg: string; color: string }> = {
  client:         { emoji: '👤', bg: 'rgba(232,105,43,.12)',  color: 'var(--orange)' },
  script:         { emoji: '📝', bg: 'rgba(250,204,21,.12)',  color: 'var(--yellow)' },
  script_content: { emoji: '🔍', bg: 'rgba(250,204,21,.12)',  color: 'var(--yellow)' },
  comment:        { emoji: '💬', bg: 'rgba(139,92,246,.12)',  color: '#8B5CF6' },
  opportunity:    { emoji: '🎯', bg: 'rgba(20,184,166,.12)',  color: '#14B8A6' },
  payment:        { emoji: '💸', bg: 'rgba(34,197,94,.12)',   color: 'var(--green)' },
};

function resultHref(r: SearchResult): string {
  if (r.href) return r.href;
  if (r.type === 'opportunity') return r.client_id ? `/dashboard/clients/${r.client_id}?tab=ghl` : '/dashboard/pipeline';
  if (r.type === 'payment') return r.client_id ? `/dashboard/clients/${r.client_id}?tab=payments` : '/dashboard/finance';
  if (!r.client_id) return '/dashboard';
  if (r.type === 'script' || r.type === 'script_content' || r.type === 'comment') return `/dashboard/clients/${r.client_id}?tab=script`;
  return `/dashboard/clients/${r.client_id}`;
}

function resultEmoji(type: SearchResult['type']): string {
  return RESULT_TYPE_META[type]?.emoji || '🔎';
}

function resultIconStyle(r: SearchResult): React.CSSProperties {
  const meta = RESULT_TYPE_META[r.type] || RESULT_TYPE_META.client;
  return {
    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
    background: meta.bg, color: meta.color,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.7rem', fontWeight: 700,
  };
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // SEO/UX : titre d'onglet pour toutes les pages admin.
  useEffect(() => { document.title = 'Dashboard Admin — BourbonMédia'; }, []);

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

  // Enregistre le service worker dès le chargement du dashboard (cache GETs
  // API + base pour les push notifs). Idempotent. Ne fait rien si déjà enregistré.
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K est désormais géré par <CommandPalette/> (search + actions)
      if (e.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKeyDown); };
  }, []);

  // Responsive breakpoint detection. iPad portrait (768–1024) garde la
  // sidebar desktop mais on l'auto-collapse pour libérer l'espace utile
  // sur l'écran (220 → 60px). iPhone et iPad split-view < 768 utilisent
  // le drawer mobile.
  useEffect(() => {
    const checkMobile = () => {
      const w = window.innerWidth;
      setIsMobile(w < 768);
      if (w >= 768) setMobileOpen(false);
      if (w >= 768 && w < 1024) setCollapsed(true);
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

  // Sync GHL → SaaS en arrière-plan, niveau layout : tant qu'un admin a
  // n'importe quelle page dashboard ouverte, on tire en parallèle les
  // opportunités + RDV depuis GHL toutes les 60s (skip si onglet en
  // arrière-plan ou si pas authentifié). Sans cron Vercel ni webhook
  // fiable, c'est ce qui garantit le quasi temps-réel sur toutes les
  // pages sans devoir câbler du polling sur chacune.
  useEffect(() => {
    if (isLoginPage || checking) return;
    const sync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const token = localStorage.getItem('bbp_token');
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      // Fire-and-forget en parallèle. Les endpoints sont idempotents
      // (upsert on_conflict) — pas de risque de double écriture.
      void fetch('/api/admin/ghl-sync-opps', { method: 'POST', headers }).catch(() => null);
      void fetch('/api/admin/ghl-sync-appointments', { method: 'POST', headers }).catch(() => null);
    };
    sync(); // immédiat à l'ouverture du dashboard
    const interval = window.setInterval(sync, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isLoginPage, checking]);

  if (isLoginPage) return <ToastProvider><DensityProvider>{children}</DensityProvider></ToastProvider>;

  if (checking) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--night)' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Chargement…</div>
    </div>
  );

  const p = pathname?.replace(/\/$/, '') || '';
  // Active state : pour /dashboard exact-match, pour /dashboard/pipeline on
  // matche aussi sur le tab si l'href en contient un (sinon les 3 entrées
  // sidebar Prospects/Production/Clients seraient actives en même temps).
  const currentTab = searchParams?.get('tab') || '';
  const isActive = (href: string) => {
    if (href === '/dashboard') return p === '/dashboard';
    const [hrefPath, hrefQuery] = href.split('?');
    const cleanHrefPath = hrefPath.replace(/\/$/, '');
    if (!hrefQuery) {
      // Item sans query : actif si pathname commence par lui ET aucun
      // autre item avec le même path mais query ne matche pas. Mais comme
      // dans notre nav on remplace les items "pipeline" par 3 items avec
      // ?tab=, l'absence de query dans href signifie "pas d'item parent".
      return p.startsWith(cleanHrefPath);
    }
    if (p !== cleanHrefPath) return false;
    const tabParam = new URLSearchParams(hrefQuery).get('tab');
    // Pour /pipeline?tab=commerciale, le tab par défaut est 'commerciale' donc
    // on l'active aussi si aucun tab n'est explicitement set dans l'URL.
    if (cleanHrefPath === '/dashboard/pipeline' && tabParam === 'commerciale' && !currentTab) return true;
    return currentTab === tabParam;
  };

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
                  href={resultHref(r)}
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', textDecoration: 'none',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={resultIconStyle(r)} aria-hidden>{resultEmoji(r.type)}</span>
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
          <div key={section.title || `sec-${sIdx}`} style={{ marginBottom: sIdx === NAV_SECTIONS.length - 1 ? 0 : 14 }}>
            {(!(collapsed && !isMobile)) && section.title && (
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
            {collapsed && !isMobile && sIdx > 0 && section.title && (
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
                    gap: 11,
                    padding: collapsed && !isMobile ? '11px 0' : '10px 14px',
                    justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                    borderRadius: 10,
                    marginBottom: 3,
                    textDecoration: 'none',
                    fontSize: '0.86rem',
                    fontWeight: active ? 700 : 500,
                    color: active ? '#fff' : hovered ? 'var(--text)' : 'var(--text-mid)',
                    background: active
                      ? 'linear-gradient(180deg, rgba(232,105,43,.22), rgba(232,105,43,.10))'
                      : hovered
                        ? 'rgba(255,255,255,.05)'
                        : 'transparent',
                    transform: hovered && !active ? 'translateX(2px)' : 'none',
                    transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                    borderLeft: active ? '3px solid var(--orange)' : '3px solid transparent',
                    boxShadow: active ? '0 4px 14px rgba(232,105,43,.15)' : 'none',
                    position: 'relative',
                  }}
                >
                  <span style={{
                    fontSize: '1.05rem', lineHeight: 1,
                    filter: active ? 'none' : hovered ? 'none' : 'grayscale(20%)',
                    transition: 'filter 200ms',
                  }}>{item.icon}</span>
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
    <DensityProvider>
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--night)' }}>
      {/* Mobile top header bar — paddingTop safe-area pour le notch iPhone
          en mode PWA standalone (sinon le bouton menu disparaît sous la
          status bar). max() garantit qu'on garde le padding visuel sur
          les appareils sans notch. */}
      {isMobile && (
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'max(16px, env(safe-area-inset-left))',
          paddingRight: 'max(16px, env(safe-area-inset-right))',
          height: 'calc(56px + env(safe-area-inset-top, 0px))',
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
            {/* Sidebar drawer — paddingTop/Bottom safe-area pour ne pas
                passer sous le notch ni l'indicateur home en mode PWA. */}
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
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              boxShadow: mobileOpen ? '4px 0 24px rgba(0,0,0,.4)' : 'none',
            }}>
              {sidebarContent}
            </aside>
          </>
        )}

        {/* Main content — paddingBottom safe-area pour que l'indicateur
            home iOS n'écrase pas le contenu en bas en PWA standalone. */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
          position: 'relative',
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : undefined,
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
                      href={resultHref(r)}
                      onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', textDecoration: 'none',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={resultIconStyle(r)} aria-hidden>{resultEmoji(r.type)}</span>
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
          <ErrorBoundary scope="page">{children}</ErrorBoundary>
        </main>
      </div>
      <ErrorBoundary scope="bell" fallback={() => null}><NotificationBell /></ErrorBoundary>
      <ErrorBoundary scope="copilot" fallback={() => null}><AiCopilot /></ErrorBoundary>
      <ErrorBoundary scope="offline" fallback={() => null}><OfflineIndicator /></ErrorBoundary>
      <ErrorBoundary scope="install-pwa" fallback={() => null}><InstallPWAPrompt /></ErrorBoundary>
      <ErrorBoundary scope="palette" fallback={() => null}><CommandPalette /></ErrorBoundary>
      <ErrorBoundary scope="cheatsheet" fallback={() => null}><ShortcutsCheatsheet /></ErrorBoundary>
      <ErrorBoundary scope="welcome" fallback={() => null}><WelcomeWizard /></ErrorBoundary>
    </div>
    </DensityProvider>
    </ToastProvider>
  );
}
