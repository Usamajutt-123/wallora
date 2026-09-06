import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { siteOrigin } from '@/lib/seo';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: 'WALLORA — High-Resolution Wallpapers',
    template: '%s · WALLORA',
  },
  description:
    'Discover high-resolution wallpapers across anime, gaming, nature, AMOLED, space and more in a fast multi-source catalog.',
  keywords: ['wallpapers', '4K wallpapers', 'HD background', 'amoled', 'anime wallpapers'],
  // No openGraph.images here — the per-route opengraph-image.tsx generators
  // (home, /categories, /search, /blog, /blog/[slug]) provide them.
  openGraph: { type: 'website', siteName: 'WALLORA', locale: 'en_US' },
};

export const viewport: Viewport = {
  themeColor: '#060609',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <div className="noise" aria-hidden />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
