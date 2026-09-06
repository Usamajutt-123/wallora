import { ImageResponse } from 'next/og';
import { siteOrigin } from '@/lib/seo';

// /categories OG card — same dark brand shell as the home card.
export const alt = 'WALLORA Categories — Every mood, mapped.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
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
          Wallora · Categories
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 700 }}>
            <span>{'Every '}</span>
            <span
              style={{
                backgroundImage: 'linear-gradient(100deg, #a78bfa, #7c6cff, #c6f432)',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              mood
            </span>
            <span>, mapped.</span>
          </div>
          <div style={{ display: 'flex', marginTop: 20, fontSize: 30, color: 'rgba(255, 255, 255, 0.62)' }}>
            Curated categories from midnight AMOLED to daylight minimal.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 3, color: 'rgba(255, 255, 255, 0.4)' }}>{host}</div>
      </div>
    ),
    { ...size },
  );
}
