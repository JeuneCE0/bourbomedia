// Bundle analyzer : activé via ANALYZE=true npm run build pour générer
// les rapports HTML dans .next/analyze. Permet d'identifier les chunks
// lourds à lazy-loader. No-op en dev/prod normaux.
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // trailingSlash:true ⇒ canonique = avec slash final (ex: /onboarding/).
  // skipTrailingSlashRedirect a été retiré : il désactivait la redirection
  // automatique de Next vers la version canonique, donc /onboarding (sans
  // slash) renvoyait une erreur de chargement quand un commercial partageait
  // l'URL en appel. Avec le flag retiré, Next gère lui-même le 308 vers
  // /onboarding/ — bien plus fiable que des redirects() manuels (qui avaient
  // bouclé en ERR_TOO_MANY_REDIRECTS côté Vercel edge).
  trailingSlash: true,
  // Headers de sécurité appliqués globalement. Vercel pose déjà HSTS donc
  // on ne le redouble pas. CSP n'est pas activée pour l'instant — le
  // contrat GHL embeddé + Stripe + form_embed.js demandent une whitelist
  // précise qu'il faut tester en preview avant de pousser en prod.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Empêche le navigateur de deviner un type MIME différent de
          // celui annoncé (mitigation classique des XSS via assets uploadés).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Anti-clickjacking : interdit aux sites tiers d'embed nos pages
          // dans une iframe. SAMEORIGIN > DENY pour ne pas casser un
          // éventuel iframe BBM → BBM (ex : preview interne).
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Limite ce qui fuite dans le Referer header vers les sites
          // tiers (ex : tracking GHL, Stripe). Origine seule en cross-origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Désactive les API navigateur sensibles qu'aucune partie de
          // l'app n'utilise. camera/microphone autorisés (contrat GHL +
          // tournage prep). Geolocation, payment (Stripe utilise embedded
          // qui n'a pas besoin du Payment API), USB, accelerometer : non.
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()',
          },
          // Content-Security-Policy en Report-Only : on observe les
          // violations sans bloquer. Une fois qu'on a confirmé via les
          // logs Vercel que rien ne casse, on pourra passer à
          // "Content-Security-Policy" enforce. Les sources whitelistées :
          //   default-src   : self uniquement
          //   script-src    : self + Stripe (loader) + GHL form_embed +
          //                   inline (Next inject styles+scripts hashes
          //                   en CSR ; relaxer pour ne pas casser)
          //   style-src     : self + Google Fonts CSS + inline (Next CSS-in-JS)
          //   img-src       : self + data: + https: (vidéos thumbnails YouTube etc.)
          //   font-src      : self + Google Fonts
          //   frame-src     : Stripe Checkout + GHL widgets + YouTube/Vimeo
          //   connect-src   : self + Supabase + Stripe + GHL APIs
          //   frame-ancestors: SAMEORIGIN (déjà via X-Frame-Options)
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://link.msgsndr.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' https://fonts.gstatic.com data:",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.leadconnectorhq.com https://api.leadconnectorhq.com https://www.youtube.com https://player.vimeo.com https://sendlink.co",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.leadconnectorhq.com https://api.leadconnectorhq.com",
              "media-src 'self' https: blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              // Reporting endpoint : les violations sont POSTées ici
              // et persistées dans error_logs pour visualisation admin.
              'report-uri /api/csp-report',
            ].join('; '),
          },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        { source: '/admin/', destination: '/admin/index.html' },
        { source: '/adresses/', destination: '/adresses/index.html' },
        { source: '/confirmation/', destination: '/confirmation/index.html' },
        { source: '/mentions-legales/', destination: '/mentions-legales/index.html' },
        { source: '/non-eligible/', destination: '/non-eligible/index.html' },
        { source: '/politique-de-confidentialite/', destination: '/politique-de-confidentialite/index.html' },
        { source: '/qualification/', destination: '/qualification/index.html' },
        { source: '/reservation-appel/', destination: '/reservation-appel/index.html' },
      ],
    };
  },
};

module.exports = withBundleAnalyzer(nextConfig);
