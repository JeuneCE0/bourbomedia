import Link from 'next/link';

// Page 404 personnalisée — déclenchée quand Next ne trouve pas la route.
// Garde l'utilisateur dans l'écosystème BBM (CTA vers landing + onboarding)
// au lieu de la 404 générique Vercel qui sort du contexte.
export default function NotFound() {
  return (
    <div style={{
      background: 'var(--night)',
      color: 'var(--text)',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: 480, width: '100%',
        background: 'var(--night-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '36px 28px',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: '"Bricolage Grotesque", sans-serif',
          fontSize: '4rem', fontWeight: 800,
          color: 'var(--orange)',
          lineHeight: 1, margin: '0 0 12px',
        }}>
          404
        </div>
        <h1 style={{
          fontFamily: '"Bricolage Grotesque", sans-serif',
          fontSize: '1.3rem', fontWeight: 700,
          color: 'var(--text)', margin: '0 0 10px',
        }}>
          Page introuvable
        </h1>
        <p style={{
          fontSize: '0.92rem', color: 'var(--text-mid)',
          lineHeight: 1.6, margin: '0 0 24px',
        }}>
          La page que vous cherchez n&apos;existe pas ou a été déplacée.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/" style={{
            padding: '11px 20px',
            borderRadius: 10,
            background: 'var(--orange)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: '0.9rem', fontWeight: 700,
          }}>
            Retour à l&apos;accueil
          </Link>
          <Link href="/onboarding/" style={{
            padding: '11px 20px',
            borderRadius: 10,
            background: 'var(--night-mid)',
            border: '1px solid var(--border-md)',
            color: 'var(--text-mid)',
            textDecoration: 'none',
            fontSize: '0.9rem', fontWeight: 600,
          }}>
            Espace client
          </Link>
        </div>
      </div>
    </div>
  );
}
