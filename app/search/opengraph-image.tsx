import { ImageResponse } from 'next/og';
import { siteOrigin } from '@/lib/seo';

// /search OG card — same dark brand shell as the home card. Consumes
// `searchParams` exactly like app/search/page.tsx (Next 16: a Promise —
// await it). NOTE: Next 16 currently invokes image handlers with `params`
// only, so this must degrade gracefully to the generic card when
// `searchParams` is not forwarded (the card then reads "Browse Wallpapers").
export const dynamic = 'force-dynamic';
export const alt = 'WALLORA — Browse Wallpapers';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const category = params?.category?.replace(/\s+/g, ' ').trim().slice(0, 60);
  const label = category && category.length > 40 ? `${category.slice(0, 39)}…` : category;
  const heading = label ? `${label} Wallpapers` : 'Browse Wallpapers';
  const host = siteOrigin().replace(/^https?:\/\//, '');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          backgroundColor: '#09090b',
          color: '#ffffff',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              'radial-gradient(ellipse 780px 520px at 78% 20%, rgba(124, 108, 255, 0.32), rgba(124, 108, 255, 0))',
          }}
        />
        <div style={{ display: 'flex', fontSize: 24, letterSpacing: 10, textTransform: 'uppercase', color: '#C6F432' }}>
          Wallora · Search the vault
        </div>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1.15 }}>{heading}</div>
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 3, color: 'rgba(255, 255, 255, 0.4)' }}>{host}</div>
      </div>
    ),
    { ...size },
  );
}
