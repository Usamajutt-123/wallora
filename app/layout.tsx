import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { siteOrigin } from '@/lib/seo';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

// Google Search Console verification (HTML-tag method). Set
// NEXT_PUBLIC_GSC_VERIFICATION in Vercel env — the meta tag only renders when
// the value exists, so nothing changes until the owner verifies. The sitemap
// to submit in GSC is https://www.wallora.cloud/sitemap.xml.
const GSC_VERIFICATION = (process.env.NEXT_PUBLIC_GSC_VERIFICATION ?? '').trim();
// GA4 measurement ID (G-XXXXXXXX). Shape-checked so a mistyped value can never
// inject script content. First-party view/download analytics (/api/track → the
// admin dashboard) work regardless of whether GA4 is configured.
const GA_ID = /^G-[A-Z0-9]{4,}$/.test((process.env.NEXT_PUBLIC_GA_ID ?? '').trim())
  ? (process.env.NEXT_PUBLIC_GA_ID as string).trim()
  : '';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: 'WALLORA — High-Resolution Wallpapers',
    template: '%s · WALLORA',
  },
  description:
    'Discover high-resolution wallpapers across anime, gaming, nature, AMOLED, space and more in a fast multi-source catalog.',
  keywords: ['wallpapers', '4K wallpapers', 'HD background', 'amoled', 'anime wallpapers'],
  ...(GSC_VERIFICATION ? { verification: { google: GSC_VERIFICATION } } : {}),
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
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
