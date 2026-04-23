'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erreur');
      localStorage.setItem('bbp_token', data.token);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--night)',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360, padding: 32, borderRadius: 16,
        background: 'var(--night-card)', border: '1px solid var(--border)',
      }}>
        <h1 style={{
          fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
          fontSize: '1.5rem', color: 'var(--orange)', textAlign: 'center', marginBottom: 8,
        }}>
          BourbonMédia
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 28 }}>
          Plateforme de suivi client
        </p>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16,
            color: 'var(--red)', fontSize: '0.8rem',
          }}>{error}</div>
        )}

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6 }}>Identifiant</span>
          <input
            type="text" value={username} onChange={e => setUsername(e.target.value)}
            required autoFocus
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.9rem', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-mid)', marginBottom: 6 }}>Mot de passe</span>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            required
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: 'var(--night-mid)', border: '1px solid var(--border-md)',
              color: 'var(--text)', fontSize: '0.9rem', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '12px 0', borderRadius: 10,
          background: loading ? 'var(--orange-dark)' : 'var(--orange)',
          color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.9rem',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
