import LazyTileUpgrader from '@/components/LazyTileUpgrader';
import { getCategories } from '@/lib/db';
import { imgSrcSet } from '@/lib/img';
import { siteUrl } from '@/lib/seo';
import { fmt } from '@/lib/utils';
import type { Metadata } from 'next';

// ISR — category names/counts/covers barely change (the admin cover overlay is
// applied at generation time, so custom covers appear within the revalidate
// window). Edge-cached for 5 minutes: this page used to run the full catalog
// scan on EVERY request, which is why TTFB was 0.4–1.9 s on 4G.
export const revalidate = 300;
export const metadata: Metadata = {
  title: 'Categories',
  // Absolute canonical via the shared site-URL convention, same as /wallpaper/[id].
  alternates: { canonical: siteUrl('/categories') },
};

/** Grid tile width per breakpoint: 2 cols on phones, 3 on sm, 4 on lg. */
const CATS_PAGE_SIZES =
  '(min-width: 1024px) calc((100vw - 96px) / 4), ' +
  '(min-width: 640px) calc((100vw - 80px) / 3), ' +
  'calc((100vw - 48px) / 2)';

// React 19 emits a preload for each eager image. Keep only the first three
// mobile above-the-fold covers in that preload budget; all later cards must be
// lazy so their bytes do not compete with the LCP request.
const EAGER_COUNT = 3;

// SSR src for below-the-fold tiles: a 1×1 transparent GIF data URI — never
// fetched, proxy not involved. The real /api/img URL rides in data-lazy-src
// and is swapped in by LazyTileUpgrader as the tile nears the viewport.
const PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-32 pb-10">
      <p className="text-[11px] font-display font-semibold tracking-[0.35em] text-accent2 uppercase mb-3">✦ The vault index</p>
      <h1 className="font-display font-bold text-4xl sm:text-6xl tracking-tight">
        Every <span className="text-grad">mood</span>, mapped.
      </h1>
      <p className="mt-4 text-white/50 max-w-lg text-sm sm:text-base">
        {categories.length} curated categories — from midnight amoled to daylight minimal. Pick one and dive in.
      </p>

      <LazyTileUpgrader>
      <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {categories.map((c, i) => {
          const { src, srcSet, sizes, candidates } = imgSrcSet(c.cover_url, { sizes: CATS_PAGE_SIZES });
          const eager = i < EAGER_COUNT;
          // If React/Next falls back to a preload href, use the same 380w
          // candidate the 390px layout selects, rather than the 1440w src.
          const mobileSrc = candidates?.[0] || src;
          return (
          <a
            key={c.id}
            href={`/search?category=${encodeURIComponent(c.name)}`}
            className={`card-shine group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-zinc-900 ${
              i % 7 === 0 ? 'row-span-2 h-full min-h-[320px]' : 'h-44 sm:h-52'
            }`}
          >
            {c.cover_url ? (
              eager ? (
                <img
                  src={mobileSrc}
                  srcSet={srcSet}
                  sizes={sizes}
                  alt={`${c.name} wallpapers`}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110"
                />
              ) : (
                <img
                  src={PLACEHOLDER}
                  data-lazy-src={src}
                  data-lazy-srcset={srcSet}
                  data-lazy-sizes={sizes}
                  alt={`${c.name} wallpapers`}
                  loading="lazy"
                  decoding="async"
                  style={{ opacity: 0 }}
                  className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110"
                />
              )
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-accent/40 to-accent2/20" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 p-4">
              <p className="font-display font-bold text-base sm:text-lg leading-tight">{c.name}</p>
              <p className="text-xs text-white/50 mt-1">{fmt(c.wallpaper_count)} wallpapers</p>
            </div>
            <span className="absolute top-3 right-3 grid place-items-center w-9 h-9 rounded-full bg-black/45 backdrop-blur border border-white/15 text-white opacity-0 group-hover:opacity-100 transition">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </span>
          </a>
          );
        })}
      </div>
      </LazyTileUpgrader>
    </div>
  );
}
