/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
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
