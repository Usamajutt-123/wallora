import Masonry from '@/components/Masonry';
import LoadMore from '@/components/LoadMore';
import { getAdsConfig } from '@/lib/ads';
import AdSlot from '@/components/ads/AdSlot';
import { getCategories, getWallpapers } from '@/lib/db';
import type { SortMode } from '@/lib/types';
import { cn, fmt } from '@/lib/utils';
import type { Metadata } from 'next';
import { isExcludedCategory } from '@/lib/filters';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q?.replace(/\s+/g, ' ').trim().slice(0, 60);
  const category = params.category?.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (query) return { title: `“${query}”`, robots: { index: false, follow: true } };
  if (category && !isExcludedCategory(category)) {
    return {
      title: `${category} Wallpapers`,
      description: `Explore high-resolution ${category} wallpapers available through the WALLORA catalog.`,
      alternates: { canonical: `/search?category=${encodeURIComponent(category)}` },
    };
  }
  return { title: 'Search', robots: { index: false, follow: true } };
}

const SUGGESTIONS = ['Dark', 'Anime', 'Nature', 'Amoled', 'Space', 'Minimal', 'Cars', '4K'];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const queryInput = params.q?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
  const q = queryInput.length >= 2 ? queryInput : undefined;
  const category = params.category?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
  const sort: SortMode = params.sort === 'popular' || params.sort === 'random' ? params.sort : 'newest';

  const [feed, ads, categories] = await Promise.all([
    getWallpapers({ search: q, category, sort, perPage: 30 }),
    getAdsConfig(),
    getCategories(),
  ]);

  const buildUrl = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, category, sort: params.sort, ...patch };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return s ? `/search?${s}` : '/search';
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-32 pb-10">
      {/* header */}
      <div className="max-w-3xl">
        <p className="text-[11px] font-display font-semibold tracking-[0.35em] text-accent2 uppercase mb-3">✦ Search the vault</p>
        <h1 className="font-display font-bold text-4xl sm:text-6xl tracking-tight leading-none">
          {q ? (
            <>
              Results for <span className="text-grad">“{q}”</span>
            </>
          ) : category ? (
            <>
              <span className="text-grad">{category}</span> walls
            </>
          ) : (
            <>
              Every wall. <span className="text-grad">One search away.</span>
            </>
          )}
        </h1>

        <form className="mt-7 flex items-center glass rounded-full pl-5 pr-1.5 py-1.5 focus-within:border-accent/60 transition" action="/search">
          {category && <input type="hidden" name="category" value={category} />}
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white/45 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            name="q"
            defaultValue={q}
            placeholder="Try “amoled anime”…"
            className="bg-transparent outline-none px-3 py-2 w-full placeholder:text-white/30"
          />
          <button className="shrink-0 rounded-full bg-accent hover:bg-accent2 text-black font-display font-semibold text-sm px-6 py-2.5 transition-colors">
            Search
          </button>
        </form>

        {/* chips */}
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          {SUGGESTIONS.map((s) => (
            <a
              key={s}
              href={`/search?q=${encodeURIComponent(s)}`}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-white/60 hover:border-accent/60 hover:text-white transition"
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      {/* filter bar */}
      <div className="mt-12 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <a
          href={buildUrl({ category: undefined })}
          className={cn(
            'shrink-0 rounded-full px-4 py-2 text-sm border transition',
            !category ? 'bg-accent text-black border-accent font-semibold' : 'glass text-white/60 hover:text-white',
          )}
        >
          All
        </a>
        {categories.slice(0, 10).map((c) => (
          <a
            key={c.id}
            href={buildUrl({ category: c.name })}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm border transition',
              category === c.name
                ? 'bg-accent text-black border-accent font-semibold'
                : 'glass text-white/60 hover:text-white',
            )}
          >
            {c.name}
          </a>
        ))}
      </div>

      {/* results */}
      <div className="mt-8">
        <p className="text-sm text-white/40 mb-6">
          <span className="text-accent2 font-semibold">{fmt(feed.total)}</span> wallpapers found
        </p>

        {feed.data.length ? (
          <>
            <Masonry items={feed.data} />
            {feed.data.length === 30 && (
              <div className="mt-8">
                <AdSlot id="feed-inline" config={ads['feed-inline']} />
              </div>
            )}
            <LoadMore initialPage={feed.page} lastPage={feed.lastPage} initialCount={feed.data.length} search={q} category={category} sort={sort} ad={ads['feed-inline']} />
          </>
        ) : (
          <div className="glass rounded-3xl py-20 text-center">
            <p className="font-display text-2xl font-semibold text-white/70">Nothing matched “{q}”</p>
            <p className="mt-2 text-white/40 text-sm">Try a broader keyword — or hit Shuffle on the home feed.</p>
          </div>
        )}
      </div>
    </div>
  );
}
