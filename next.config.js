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
