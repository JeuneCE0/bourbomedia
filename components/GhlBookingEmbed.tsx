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

const GHL_WIDGET_HOST = 'https://api.leadconnectorhq.com/widget/booking';

// Normalise une valeur d'URL de calendrier GHL. Tolère les configs Vercel
// où l'admin aurait collé juste l'ID, un path relatif, ou une URL sans
// protocol. Sans cette normalisation, l'iframe charge
// `https://bourbonmedia.fr/<valeur>` qui résout vers notre own /not-found.tsx
// — ce que le client voit alors comme un "404" dans le calendrier.
function normalizeGhlCalendarUrl(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  // URL absolue HTTPS → on suppose que c'est correct.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // URL absolue sans protocol (//api.leadconnectorhq.com/...) → préfixe https.
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  // Host GHL sans protocol (api.leadconnectorhq.com/widget/booking/<id>).
  if (trimmed.startsWith('api.leadconnectorhq.com/')) return `https://${trimmed}`;
  // Path /widget/booking/<id> → préfixe avec le host.
  if (trimmed.startsWith('/widget/booking/')) return `https://api.leadconnectorhq.com${trimmed}`;
  // ID GHL pur (alphanumérique, 15-32 chars) → préfixe widget endpoint complet.
  if (/^[A-Za-z0-9]{15,32}$/.test(trimmed)) return `${GHL_WIDGET_HOST}/${trimmed}`;
  // Cas fail-safe : on renvoie tel quel ; le check looksValid dans le render
  // déclenchera le fallback.
  return trimmed;
}

// Pattern qui matche les deux formats GHL valides en prod :
//   /widget/booking/<id>      (ID interne 20-char alphanumérique)
//   /widget/bookings/<slug>   (slug human-readable, avec tirets)
const GHL_VALID_PATH_RE = /^https:\/\/api\.leadconnectorhq\.com\/widget\/bookings?\/[A-Za-z0-9_-]+/i;

// Résout l'URL du calendrier de manière garantie : essaie d'abord la valeur
// env (potentiellement mal configurée), tombe sur l'ID hardcodé en dernier
// recours. Évite que le client tombe sur "Calendrier indisponible" si
// l'env Vercel est mal saisie. Logue un warning console pour que l'admin
// voit le souci en DevTools.
export function resolveGhlCalendarUrl(envValue: string | undefined, fallbackId: string): string {
  const fullFallback = `${GHL_WIDGET_HOST}/${fallbackId}`;
  if (!envValue) return fullFallback;
  const normalized = normalizeGhlCalendarUrl(envValue);
  if (GHL_VALID_PATH_RE.test(normalized)) return normalized;
  if (typeof console !== 'undefined') {
    console.warn(
      '[GhlBookingEmbed] Env var calendrier mal configurée, fallback sur ID interne. Valeur reçue :',
      envValue,
    );
  }
  return fullFallback;
}

function buildGhlUrlWithPrefill(url: string, prefill?: GhlPrefill): string {
  const normalized = normalizeGhlCalendarUrl(url);
  if (!normalized || !prefill) return normalized;
  const parts = (prefill.contact_name || '').trim().split(/\s+/).filter(Boolean);
  const params = new URLSearchParams();
  if (parts[0]) params.set('first_name', parts[0]);
  if (parts.length > 1) params.set('last_name', parts.slice(1).join(' '));
  if (prefill.email) params.set('email', prefill.email);
  if (prefill.phone) params.set('phone', prefill.phone);
  if (prefill.business_name) params.set('company_name', prefill.business_name);
  const qs = params.toString();
  if (!qs) return normalized;
  return normalized + (normalized.includes('?') ? '&' : '?') + qs;
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
  const calendarId = finalUrl.split('/').pop()?.split('?')[0] || 'calendar';
  // Timestamp évalué une seule fois au mount (lazy init) — pas de SSR
  // mismatch et l'id reste stable pour form_embed.js.
  const [iframeId] = useState(() => `${calendarId}_${Date.now()}`);

  // Garde-fou : si l'URL ne ressemble pas à un widget GHL valide après
  // normalisation, on affiche un fallback côté admin plutôt que de laisser
  // l'iframe charger une URL qui résout en interne sur notre /not-found
  // (le client verrait un "404 Page introuvable" dans le calendrier).
  // Accepte /widget/booking/<id> ET /widget/bookings/<slug> (les deux
  // formats valides côté GHL).
  const looksValid = GHL_VALID_PATH_RE.test(finalUrl);
  if (!looksValid) {
    return (
      <div style={{
        borderRadius: 14,
        border: '1px dashed var(--border-md)',
        background: 'var(--night-mid)',
        padding: '24px 22px',
        color: 'var(--text-mid)',
        fontSize: '0.86rem',
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--orange)', marginBottom: 8 }}>
          ⚠️ Calendrier indisponible
        </div>
        <p style={{ margin: 0 }}>
          Le lien du calendrier n&apos;est pas correctement configuré côté admin.
          L&apos;équipe BourbonMédia va vous proposer un créneau directement —
          vous serez recontacté·e très vite.
        </p>
      </div>
    );
  }

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
