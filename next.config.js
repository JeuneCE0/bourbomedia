/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  async redirects() {
    // trailingSlash:true + skipTrailingSlashRedirect:true ⇒ une URL sans slash
    // final renvoie 404 au lieu d'être redirigée vers la version canonique.
    // Cela cassait les liens partagés en appel (ex : bourbonmedia.fr/onboarding).
    // On redirige explicitement les routes Next dynamiques vers leur version
    // avec trailing slash pour récupérer un comportement humain-friendly.
    return [
      { source: '/onboarding', destination: '/onboarding/', permanent: true },
      { source: '/portal', destination: '/portal/', permanent: true },
      { source: '/nps', destination: '/nps/', permanent: true },
      { source: '/dashboard', destination: '/dashboard/', permanent: true },
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
