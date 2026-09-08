import Hero from '@/components/Hero';
import Ticker from '@/components/Ticker';
import TrendingRow from '@/components/TrendingRow';
import BentoFeatured from '@/components/BentoFeatured';
import CategoryRow from '@/components/CategoryRow';
import Masonry from '@/components/Masonry';
import LoadMore from '@/components/LoadMore';
import SectionHeading from '@/components/SectionHeading';
import { getCategories, getFeatured, getHeroTiles, getSiteStats, getTrending, getWallpapers } from '@/lib/db';
import { getAdsConfig } from '@/lib/ads';
import AdSlot from '@/components/ads/AdSlot';
import { siteUrl } from '@/lib/seo';
import type { SortMode } from '@/lib/types';
import { cn, jsonLdString } from '@/lib/utils';
import type { Metadata } from 'next';

// ISR — the whole page (hero, trending, feed, stats) is edge-cached for 5
// minutes. Stats may trail live tracking by up to 5 min: acceptable, the
// tracking POSTs still hit real data. NOTE: do NOT read `searchParams` in this
// page — that would silently flip the route back to per-request rendering and
// kill the edge cache (it did exactly that at revalidate=60).
export const revalidate = 300;

// Absolute canonical via the shared site-URL convention, same as /wallpaper/[id].
export const metadata: Metadata = {
  alternates: { canonical: siteUrl('/') },
  openGraph: { url: siteUrl('/') },
};

/** WebSite JSON-LD — same render style as the detail page's structured data. */
const websiteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'WALLORA',
  url: siteUrl('/'),
  description:
    'Discover high-resolution wallpapers across anime, gaming, nature, AMOLED, space and more in a fast multi-source catalog.',
};

/** Feed-sort pills point at the (deliberately dynamic) search page. */
const SORTS: { id: SortMode; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'popular', label: 'Popular' },
  { id: 'random', label: 'Shuffle' },
];

/** "Pick your vibe" — a MIXED dozen: curated shelves + biggest NexWall cats + top anime (not anime-only). */
function pickVibes(cats: Awaited<ReturnType<typeof getCategories>>, count = 12) {
  const wh = [...cats.filter((c) => c.source === 'wallhaven')];
  const nx = [...cats.filter((c) => c.source === 'nexwall' || c.source === 'demo')].sort(
    (a, b) => b.wallpaper_count - a.wallpaper_count,
  );
  const ap = [...cats.filter((c) => c.source === 'animepixels')].sort(
    (a, b) => b.wallpaper_count - a.wallpaper_count,
  );
  const pools = [wh, nx, ap]; // round-robin interleave
  const picked: typeof cats = [];
  for (let i = 0; picked.length < count && pools.some((p) => p.length); i++) {
    const p = pools[i % pools.length];
    if (p.length) picked.push(p.shift()!);
  }
  return picked;
}

export default async function Home() {
  const [latest, trending, featured, feed, categories, stats, ads] = await Promise.all([
    getHeroTiles(15), // hero mosaic — mixed categories, not just newest
    getTrending(10),
    getFeatured(6),
    getWallpapers({ perPage: 30 }), // "Fresh drops" = newest
    getCategories(),
    getSiteStats(),
    getAdsConfig(),
  ]);

  // NOTE: the hero's eager <img fetchPriority="high"> tiles get their
  // <link rel="preload" as="image" imageSrcSet=...> tags automatically (React
  // 19 hoists preloads for eager images into <head>, before any JS runs).
  // Keeping the page free of extra eager images is what keeps the preload
  // budget at the ~3 first-viewport hero tiles — everything below the fold
  // stays lazy and loads in the background while the user scrolls.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(websiteLd) }} />
      <Hero tiles={latest} stats={stats} />
      <Ticker />

      {/* Ad: home top banner */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 mt-10">
        <AdSlot id="home-top" config={ads['home-top']} />
      </div>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-20">
        <SectionHeading kicker="Moods" title="Pick your vibe" linkHref="/categories" linkLabel="All categories" />
        <CategoryRow categories={pickVibes(categories)} />
      </section>

      {/* Trending */}
      <section id="trending" className="mx-auto max-w-7xl px-4 sm:px-6 mt-24 scroll-mt-28">
        <SectionHeading kicker="Most viewed" title="Popular wallpapers" linkHref="/search?sort=popular" linkLabel="View all" />
        <TrendingRow items={trending} />
      </section>

      {/* Featured bento */}
      <section id="featured" className="mx-auto max-w-7xl px-4 sm:px-6 mt-24 scroll-mt-28">
        <SectionHeading kicker="Curators' picks" title="Featured sets" linkHref="/search?sort=popular" linkLabel="More like this" />
        <BentoFeatured items={featured} />
      </section>

      {/* Ad: mid-page before the feed */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 mt-16">
        <AdSlot id="home-mid" config={ads['home-mid']} />
      </div>

      {/* The feed */}
      <section id="browse" className="mx-auto max-w-7xl px-4 sm:px-6 mt-24 scroll-mt-28">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
          <div>
            <p className="text-[11px] font-display font-semibold tracking-[0.35em] text-accent2 uppercase mb-2">✦ The feed</p>
            <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Fresh drops</h2>
          </div>
          <div className="flex gap-2">
            {SORTS.map((s, i) => (
              <a
                key={s.id}
                href={`/search?sort=${s.id}`}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition border',
                  i === 0
                    ? 'bg-accent text-black border-accent font-semibold'
                    : 'glass text-white/60 hover:text-white hover:border-white/25',
                )}
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>

        <Masonry items={feed.data} />
        {/* In-feed ads appear only after each 30 rendered wallpapers. */}
        {feed.data.length === 30 && (
          <div className="mt-8">
            <AdSlot id="feed-inline" config={ads['feed-inline']} />
          </div>
        )}
        <LoadMore initialPage={feed.page} lastPage={feed.lastPage} initialCount={feed.data.length} ad={ads['feed-inline']} />
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-28">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-accent/25 via-transparent to-accent2/10 px-6 py-16 text-center">
          <div className="absolute -top-24 left-1/3 w-96 h-96 rounded-full bg-accent/25 blur-[120px]" aria-hidden />
          <h3 className="relative font-display font-bold text-3xl sm:text-5xl tracking-tight">
            Fresh walls in <span className="text-grad">small batches.</span>
          </h3>
          <p className="relative mt-4 text-white/55 max-w-md mx-auto text-sm sm:text-base">
            The catalog can add small scheduled batches from three sources while manual curator picks stay fully supported.
          </p>
          <a
            href="#browse"
            className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-white text-black px-7 py-3.5 font-display font-semibold text-sm hover:bg-accent2 transition-colors"
          >
            Dive back in
          </a>
        </div>
      </section>
    </>
  );
}
