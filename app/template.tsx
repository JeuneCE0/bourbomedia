'use client';

// Page-level fade-in. Next.js re-mounts this template on every route change,
// so the entry animation fires naturally without manual key bumps.

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="bm-fade-in" style={{ minHeight: '100vh' }}>
      {children}
    </div>
  );
}
