import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BourbonMédia — SaaS',
  description: 'Plateforme de suivi client BourbonMédia',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Bourbomedia',
  },
};

export const viewport: Viewport = {
  // Bg sombre pour la barre d'URL Android (status bar iOS gérée séparément
  // par apple-mobile-web-app-status-bar-style). #1A1008 = --night, matche
  // l'arrière-plan donc pas de discontinuité visuelle au démarrage.
  themeColor: '#1A1008',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // viewportFit cover : permet à la web app installée d'utiliser
  // toute la zone safe-area (notch iPhone, edges iPad) en mode plein
  // écran après "Ajouter à l'écran d'accueil".
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/jpeg" href="/favicon.jpg" />
        <link rel="apple-touch-icon" href="/favicon.jpg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon.jpg" />
        {/* PWA iOS : tags Apple-specific qui activent "Ajouter à l'écran
            d'accueil" en mode app fullscreen sans barre Safari. Le manifest
            (référencé via metadata.manifest) gère Android/desktop. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Bourbomedia" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Bourbomedia" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}
