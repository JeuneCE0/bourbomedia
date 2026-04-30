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

module.exports = nextConfig;
