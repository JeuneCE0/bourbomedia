// Loading state global rendu pendant la résolution d'une route async.
// Next.js l'affiche automatiquement quand un Suspense boundary attend
// (ex : page server component qui fetch en parallèle, ou route avec
// dynamic data). Évite le flash blanc + améliore le perceived perf.

export default function Loading() {
  return (
    <div style={{
      background: 'var(--night)',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}>
        <div style={{
          width: 44, height: 44,
          borderRadius: '50%',
          border: '3px solid var(--border-md)',
          borderTopColor: 'var(--orange)',
          animation: 'spin 0.9s linear infinite',
        }} />
        <span style={{
          fontFamily: '"Bricolage Grotesque", sans-serif',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          fontWeight: 500,
        }}>
          BourbonMédia
        </span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
