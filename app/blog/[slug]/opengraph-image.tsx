import { ImageResponse } from 'next/og';
import { getPost } from '@/lib/blog';
import { siteOrigin } from '@/lib/seo';

// /blog/[slug] OG card — heading from the post title (same data source as
// app/blog/[slug]/page.tsx). A data/env failure must NEVER break the build:
// any error falls back to a plain "Wallpaper Blog" card.
export const alt = 'WALLORA Blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  let heading = 'Wallpaper Blog';
  try {
    const { slug } = await params;
    const post = await getPost(slug);
    if (post?.title) heading = post.title.length > 96 ? `${post.title.slice(0, 95)}…` : post.title;
  } catch {
    /* data/env unavailable — keep the generic fallback card */
  }
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
          The Wallora Journal
        </div>
        <div style={{ display: 'flex', fontSize: 58, fontWeight: 700, lineHeight: 1.2 }}>{heading}</div>
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 3, color: 'rgba(255, 255, 255, 0.4)' }}>{host}</div>
      </div>
    ),
    { ...size },
  );
}
