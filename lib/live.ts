// Live mode — serves real NexWall + AnimePixels content through the Next.js
// data cache when Supabase isn't connected yet. Quota-safe: every upstream
// call is cached at the edge (feed 10 min, categories 1 h, single wall 30 min).
import { unstable_cache } from 'next/cache';
import {
  fetchNexwallCategories,
  fetchNexwallCategoryWalls,
  fetchNexwallWallpaper,
  fetchNexwallWallpapers,
  nexwallConfigured,
  type NormalizedWall,
} from './nexwall';
import { fetchAnimeCategories, fetchAnimePixels } from './animepixels';
import { fetchWallhavenById, fetchWallhavenSearch, shelfBySlug, withShelf, WH_SHELVES } from './wallhaven';
import { filterCategories, filterWallpapers, isExcludedCategory, isHardBlockedWallpaper } from './filters';
import { isSupabaseConfigured } from './supabase';
import type { Category, Paged, SortMode, Wallpaper } from './types';
import fs from 'node:fs';
import path from 'node:path';

export function liveMode(): boolean {
  return !isSupabaseConfigured() && nexwallConfigured();
}

function safeSourceUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function toWallpaper(n: NormalizedWall): Wallpaper {
  const views = n.api_views || 0;
  return {
    id: `${n.source}:${n.source_id}`,
    source: n.source,
    source_id: n.source_id,
    title: n.title,
    category: n.category,
    image_url: n.image_url,
    thumb_url: n.thumb_url,
    width: n.width,
    height: n.height,
    resolution: n.resolution,
    source_url: safeSourceUrl(n.source_url),
    views,
    downloads: n.api_downloads || 0,
    is_featured: false,
    is_premium: n.is_premium,
    // In live mode the normalized APIs do not expose a reliable upload date.
    // Use retrieval time rather than fabricating a pseudo-historical date.
    created_at: new Date().toISOString(),
  };
}

/** Oversample upstream pages so post-filter pages still feel full (costs the same 1 request). */
function upstreamPerPage(uiPerPage: number): number {
  return Math.min(100, Math.max(50, uiPerPage * 3));
}

const _feed = unstable_cache(
  async (
    page: number,
    perPage: number,
    sort: string,
    search: string,
    applyFilter: boolean,
  ): Promise<Paged<Wallpaper>> => {
    const r = await fetchNexwallWallpapers({
      page,
      perPage: upstreamPerPage(perPage),
      sort: sort as 'newest' | 'popular' | 'random',
      search: search || undefined,
    });
    let items = r.items;
    // people-block is unconditional — even typed searches stay clean
    items = items.filter((w) => !isHardBlockedWallpaper(w));
    if (applyFilter) items = filterWallpapers(items);
    return {
      data: items.slice(0, perPage).map(toWallpaper),
      page: r.current,
      lastPage: r.last,
      total: r.total,
    };
  },
  ['wallora-live-feed-v3'],
  { revalidate: 1200 },
);

const _catFeed = unstable_cache(
  async (catId: string, page: number, perPage: number): Promise<Paged<Wallpaper>> => {
    const r = await fetchNexwallCategoryWalls(catId, page, upstreamPerPage(perPage));
    const items = filterWallpapers(r.items);
    return {
      data: items.slice(0, perPage).map(toWallpaper),
      page: r.current,
      lastPage: r.last,
      total: r.total,
    };
  },
  ['wallora-live-catfeed-v3'],
  { revalidate: 1200 },
);

/** AnimePixels feed — full library or one franchise. */
const _apFeed = unstable_cache(
  async (page: number, perPage: number, category: string): Promise<Paged<Wallpaper>> => {
    const r = await fetchAnimePixels({ page, perPage, category: category || undefined });
    const items = filterWallpapers(r.items).map(toWallpaper);
    return { data: items, page: r.page, lastPage: r.lastPage, total: items.length };
  },
  ['wallora-live-ap-v2'],
  { revalidate: 1200 },
);

/**
 * QUOTA-SAFE FEED — when NexWall's daily request quota runs out (HTTP 429),
 * the site keeps serving from AnimePixels + Wallhaven instead of demo walls.
 * Interleaves the two fallback sources so the mix stays varied.
 */
const _quotaFeed = unstable_cache(
  async (page: number, perPage: number, search: string): Promise<Paged<Wallpaper>> => {
    const half = Math.ceil(perPage / 2);
    let ap: Paged<Wallpaper> = { data: [], page: 1, lastPage: 1, total: 0 };
    let whTotal = 0, whLast = 1;
    try {
      ap = await _apFeed(page, half, search || '');
    } catch {/* anime down too */}
    let wh: Wallpaper[] = [];
    try {
      const r = await fetchWallhavenSearch({ q: search || '', page });
      wh = r.items.filter((wallpaper) => !isHardBlockedWallpaper(wallpaper)).slice(0, half).map(toWallpaper);
      whTotal = r.total; whLast = r.last;
    } catch {/* wallhaven down */}
    const mixed: Wallpaper[] = [];
    const a = [...ap.data], b = [...wh];
    while (a.length || b.length) { if (a.length) mixed.push(a.shift()!); if (b.length) mixed.push(b.shift()!); }
    return { data: mixed.slice(0, perPage), page, lastPage: Math.max(whLast, ap.lastPage), total: ap.total + whTotal };
  },
  ['wallora-live-quota-v2'],
  { revalidate: 900 },
);

/** Wallhaven curated shelves — best toplist walls for categories NexWall lacks. */
const _whFeed = unstable_cache(
  async (slug: string, page: number, perPage: number): Promise<Paged<Wallpaper>> => {
    const shelf = shelfBySlug(slug);
    if (!shelf) return { data: [], page: 1, lastPage: 1, total: 0 };
    const r = await fetchWallhavenSearch({ q: shelf.query, page });
    const items = filterWallpapers(withShelf(r.items, shelf.name));
    return {
      data: items.slice(0, perPage).map(toWallpaper),
      page: r.current,
      lastPage: r.last,
      total: r.total,
    };
  },
  ['wallora-wh-feed'],
  { revalidate: 1200 },
);

/** Persisted NexWall category snapshot — survives daily-quota outages (auto-refreshed when alive). */
const CATS_SNAPSHOT = path.join(process.cwd(), 'content', 'cats-snapshot.json');
function readCatSnapshot(): Category[] {
  try { return JSON.parse(fs.readFileSync(CATS_SNAPSHOT, 'utf8')); } catch { return []; }
}
function writeCatSnapshot(cats: Category[]) {
  try { fs.mkdirSync(path.dirname(CATS_SNAPSHOT), { recursive: true }); fs.writeFileSync(CATS_SNAPSHOT, JSON.stringify(cats, null, 1)); } catch {/* dev-only nicety */}
}

const _cats = unstable_cache(
  async (): Promise<Category[]> => {
    // NexWall first — but if its daily quota is over, shelves still load without it
    let mapped: Category[] = [];
    try {
      const cats = await fetchNexwallCategories();
      const visible = filterCategories(cats);
      mapped = visible
        .map((c) => ({
          id: `nexwall:${c.source_id}`,
          slug: c.slug,
          name: c.name,
          cover_url: c.cover_url,
          wallpaper_count: c.wallpaper_count,
          is_premium: c.is_premium,
          source: 'nexwall',
        }))
        .sort((a, b) => b.wallpaper_count - a.wallpaper_count);
    } catch {
      // NexWall quota over — keep its categories via the last good snapshot
      mapped = readCatSnapshot();
    }
    if (mapped.length) writeCatSnapshot(mapped);

    // ── Anime shelf — powered by the keyless AnimePixels endpoint ──
    // NexWall's plan has no Anime category, so we build one plus a franchise shelf.
    if (!mapped.some((c) => /anime|manga/i.test(c.name))) {
      try {
        const apCats = await fetchAnimeCategories();
        const total = apCats.reduce((a, c) => Math.max(a, c.totalLibrary), 0);
        const shelf: Category[] = apCats.slice(0, 8).map((c) => ({
          id: `animepixels:${c.name}`,
          slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: c.name,
          cover_url: c.cover,
          wallpaper_count: c.count,
          is_premium: false,
          source: 'animepixels',
        }));
        const all: Category = {
          id: 'animepixels:__all',
          slug: 'anime',
          name: 'Anime',
          cover_url:
            apCats[0]?.cover ??
            (await _apFeed(1, 1, '').then((r) => r.data[0]?.thumb_url).catch(() => null)) ??
            null,
          wallpaper_count: total,
          is_premium: false,
          source: 'animepixels',
        };
        mapped.unshift(all, ...shelf);
      } catch {
        /* AnimePixels unreachable — shelf just stays hidden */
      }
    }

    // ── Wallhaven curated shelves — Gaming, Space, AMOLED… (best toplist, SFW) ──
    try {
      const whCats: Category[] = [];
      for (const s of WH_SHELVES) {
        const r = await fetchWallhavenSearch({ q: s.query, page: 1 });
        const safeItems = filterWallpapers(r.items);
        whCats.push({
          id: `wallhaven:${s.slug}`,
          slug: s.slug,
          name: s.name,
          cover_url: safeItems[0]?.thumb_url ?? null,
          wallpaper_count: r.total,
          is_premium: false,
          source: 'wallhaven',
        });
      }
      const animeBlock = mapped.findIndex((c) => c.source === 'nexwall');
      mapped.splice(animeBlock === -1 ? 0 : animeBlock, 0, ...whCats);
    } catch {
      /* Wallhaven unreachable — shelves stay hidden */
    }
    return mapped;
  },
  ['wallora-live-cats-v8'],
  { revalidate: 3600 },
);

const _byId = unstable_cache(
  async (sourceAndId: string): Promise<Wallpaper | null> => {
    const sep = sourceAndId.indexOf(':');
    const source = sourceAndId.slice(0, sep);
    const id = sourceAndId.slice(sep + 1);
    let n: NormalizedWall | null = null;
    if (source === 'animepixels') {
      // no /:id endpoint — scan pages until found (small library)
      for (let p = 1; p <= 8 && !n; p++) {
        const r = await fetchAnimePixels({ page: p, perPage: 100 });
        n = r.items.find((x) => x.source_id === id) ?? null;
        if (r.lastPage <= p) break;
      }
    } else if (source === 'wallhaven') {
      n = await fetchWallhavenById(id);
      if (n) {
        // put its shelf name back on so related-walls + badges line up
        for (const s of WH_SHELVES) {
          if ((n.tags ?? '').toLowerCase().includes(s.query.split(' ')[0])) {
            n = { ...n, category: s.name };
            break;
          }
        }
      }
    } else n = await fetchNexwallWallpaper(id);
    // Direct pages reached from an explicit search may show devotional results,
    // but real-person/glamour and sexualized content is never renderable.
    if (!n || isHardBlockedWallpaper(n)) return null;
    return toWallpaper(n);
  },
  ['wallora-live-byid-v6'],
  { revalidate: 1800 },
);

interface LiveQuery {
  page?: number;
  perPage?: number;
  category?: string | null;
  search?: string | null;
  sort?: SortMode;
}

export async function liveWallpapers(q: LiveQuery): Promise<Paged<Wallpaper>> {
  const perPage = Math.min(q.perPage ?? 24, 50);
  const page = Math.max(1, q.page ?? 1);

  if (q.category) {
    if (isExcludedCategory(q.category)) return { data: [], page, lastPage: 1, total: 0 };
    const cats = await _cats();
    // tolerate URL slugs too ("anime", "demon-slayer"…)
    const needle = q.category.toLowerCase().replace(/[-_]+/g, ' ');
    const cat = cats.find(
      (c) => c.name === q.category || c.name.toLowerCase() === needle || c.slug === needle.replace(/ /g, '-'),
    );
    if (!cat) {
      // not on any shelf — try AnimePixels franchise…
      try {
        const probe = await _apFeed(1, perPage, q.category);
        if (probe.data.length) return page === 1 ? probe : _apFeed(page, perPage, q.category);
      } catch {/* keep falling */}
      // …then Wallhaven by first word — covers NexWall-only cats when its quota is gone
      try {
        const r = await fetchWallhavenSearch({ q: q.category.toLowerCase().split(/\s|&/)[0] || 'aesthetic', page });
        const items = filterWallpapers(r.items).slice(0, perPage).map(toWallpaper);
        return { data: items, page: r.current, lastPage: r.last, total: r.total };
      } catch {
        return { data: [], page, lastPage: 1, total: 0 };
      }
    }
    if (cat.source === 'animepixels') return _apFeed(page, perPage, cat.name === 'Anime' ? '' : cat.name);
    if (cat.source === 'wallhaven') return _whFeed(cat.slug, page, perPage);
    try {
      return await _catFeed(cat.id.split(':')[1], page, perPage);
    } catch {
      // NexWall quota exhausted — serve the category via Wallhaven search instead
      const r = await fetchWallhavenSearch({ q: cat.name.toLowerCase().split(' ')[0], page });
      const items = filterWallpapers(r.items).slice(0, perPage).map(toWallpaper);
      return { data: items, page: r.current, lastPage: r.last, total: r.total };
    }
  }
  // explicit text searches bypass the content filter (user intent) — feeds stay clean
  const explicitSearch = Boolean(q.search && q.search.trim().length >= 2);
  // NexWall natively supports newest / popular / random — pass through
  try {
    return await _feed(page, perPage, q.sort ?? 'newest', q.search ?? '', !explicitSearch);
  } catch {
    // NexWall daily quota over (or API down) → full site keeps serving via AnimePixels + Wallhaven
    return _quotaFeed(page, perPage, q.search ?? '');
  }
}

/** Random anime tiles for mixing into the hero mosaic. */
export async function liveAnimePeek(limit = 8): Promise<Wallpaper[]> {
  const page = 1 + (Math.floor(Math.random() * 10_000) % 6); // bounded page rotation
  const r = await _apFeed(page, 50, '');
  // pseudo-shuffle so the hero varies between cache windows
  return [...r.data].sort(() => Math.random() - 0.5).slice(0, limit);
}

export async function liveCategories(): Promise<Category[]> {
  return _cats();
}

export async function liveWallpaperById(source: string, sourceId: string): Promise<Wallpaper | null> {
  return _byId(`${source}:${sourceId}`);
}

export async function liveRelated(w: Wallpaper, limit = 8): Promise<Wallpaper[]> {
  if (!w.category) return [];
  // AnimePixels items → same franchise via its category param (even if not on the shelf)
  if (w.source === 'animepixels') {
    const r = await _apFeed(1, limit + 1, w.category === 'Anime' ? '' : w.category);
    const items = r.data.filter((x) => x.id !== w.id);
    if (items.length) return items.slice(0, limit);
  }
  const feed = await liveWallpapers({ category: w.category, perPage: limit + 1 });
  return feed.data.filter((x) => x.id !== w.id).slice(0, limit);
}

export async function liveSiteStats(): Promise<{ walls: number; views: number; downloads: number }> {
  const cats = await _cats();
  // categories overlap (one wall can sit in several) so this is a display estimate
  const walls = cats.reduce((a, c) => a + c.wallpaper_count, 0);
  // Upstream category totals are the only available live-mode aggregate.
  // Engagement remains zero until Supabase event tracking is configured.
  return { walls, views: 0, downloads: 0 };
}
