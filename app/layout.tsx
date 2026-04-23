import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BourbonMédia — SaaS',
  description: 'Plateforme de suivi client BourbonMédia',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/jpeg" href="/favicon.jpg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
