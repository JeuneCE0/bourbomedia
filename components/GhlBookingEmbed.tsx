'use client';

import { useEffect, useMemo, useState } from 'react';

// Embed du widget GHL Calendar avec wrapper branded BBM + pré-remplissage
// automatique. Ex-duplication entre /onboarding/page.tsx et /portal/page.tsx,
// extraite ici comme single source of truth.
//
// Mécanique :
//  - Charge form_embed.js (script GHL) une seule fois pour activer le
//    auto-resize de l'iframe via postMessage. Sans ça l'iframe reste figée à
//    sa hauteur initiale et les créneaux du bas sont rognés.
//  - L'iframe a un id stable au format `<calendarId>_<timestamp>` (pattern
//    GHL natif) — form_embed.js retrouve l'iframe via cet id.
//  - Le timestamp est généré côté client uniquement (useState lazy init)
//    pour éviter un mismatch d'hydratation SSR.
//  - Pré-remplissage : first_name, last_name, email, phone, company_name
//    passés en query-string ; GHL les injecte dans le formulaire de
//    réservation.

let formEmbedScriptLoaded = false;

export interface GhlPrefill {
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  business_name?: string | null;
}

function buildGhlUrlWithPrefill(url: string, prefill?: GhlPrefill): string {
  if (!url || !prefill) return url;
  const parts = (prefill.contact_name || '').trim().split(/\s+/).filter(Boolean);
  const params = new URLSearchParams();
  if (parts[0]) params.set('first_name', parts[0]);
  if (parts.length > 1) params.set('last_name', parts.slice(1).join(' '));
  if (prefill.email) params.set('email', prefill.email);
  if (prefill.phone) params.set('phone', prefill.phone);
  if (prefill.business_name) params.set('company_name', prefill.business_name);
  const qs = params.toString();
  if (!qs) return url;
  return url + (url.includes('?') ? '&' : '?') + qs;
}

export default function GhlBookingEmbed({ url, title, onLoad, prefill }: {
  url: string;
  title: string;
  onLoad?: () => void;
  prefill?: GhlPrefill;
}) {
  useEffect(() => {
    if (formEmbedScriptLoaded) return;
    if (typeof document === 'undefined') return;
    const existing = document.querySelector('script[src="https://link.msgsndr.com/js/form_embed.js"]');
    if (existing) { formEmbedScriptLoaded = true; return; }
    const s = document.createElement('script');
    s.src = 'https://link.msgsndr.com/js/form_embed.js';
    s.type = 'text/javascript';
    s.async = true;
    document.body.appendChild(s);
    formEmbedScriptLoaded = true;
  }, []);

  const finalUrl = useMemo(() => buildGhlUrlWithPrefill(url, prefill), [url, prefill]);
  const calendarId = url.split('/').pop()?.split('?')[0] || 'calendar';
  // Timestamp évalué une seule fois au mount (lazy init) — pas de SSR
  // mismatch et l'id reste stable pour form_embed.js.
  const [iframeId] = useState(() => `${calendarId}_${Date.now()}`);

  return (
    <div style={{
      borderRadius: 14,
      border: '1px solid var(--border-orange)',
      background: '#fff',
      minHeight: 720,
      overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(232,105,43,.08)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(232,105,43,.08), rgba(250,204,21,.04))',
        borderBottom: '1px solid var(--border-md)',
        fontSize: '0.78rem', color: 'var(--text-mid)', fontWeight: 600,
      }}>
        <span aria-hidden style={{ fontSize: '0.95rem' }}>📅</span>
        <span>Calendrier BourbonMédia</span>
        {prefill?.contact_name && (
          <span style={{
            marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500,
          }}>
            Pré-rempli pour <strong style={{ color: 'var(--orange)' }}>{prefill.contact_name}</strong>
          </span>
        )}
      </div>
      <iframe
        id={iframeId}
        src={finalUrl}
        title={title}
        scrolling="no"
        onLoad={onLoad}
        style={{ width: '100%', border: 'none', display: 'block', minHeight: 720, background: '#fff' }}
      />
    </div>
  );
}
