import { DEMO_WALLPAPERS, DEMO_CATEGORIES } from './demo-data';
import { getAnonSupabase, getServiceSupabase, isSupabaseConfigured, serviceKeyConfigured } from './supabase';
import { nexwallConfigured } from './nexwall';
import { filterCategories, filterWallpapers, isHardBlockedWallpaper } from './filters';
import { liveAnimePeek, liveCategories, liveRelated, liveSiteStats, liveWallpaperById, liveWallpapers } from './live';
import type { Category, DashboardStats, Paged, SortMode, Wallpaper } from './types';
import { seedOf } from './utils';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';

const PER_PAGE = 24;
const STORED_SOURCE_LIST = ['nexwall', 'animepixels', 'wallhaven', 'manual'] as const;
const STORED_SOURCES = new Set<string>(STORED_SOURCE_LIST);
const isStoredSource = (value: unknown) => STORED_SOURCES.has(String(value));
const isStoredWallpaperRow = (row: { source?: unknown; source_id?: unknown }) =>
  isStoredSource(row.source) && /^[A-Za-z0-9_-]{1,100}$/.test(String(row.source_id ?? ''));

export type SiteMode = 'supabase' | 'live' | 'demo';
export function getMode(): SiteMode {
  if (isSupabaseConfigured()) return 'supabase';
  if (nexwallConfigured()) return 'live';
  return 'demo';
}

/* ---------------------------------- row → type --------------------------------- */

function safeSourceUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToWallpaper(r: any): Wallpaper {
  return {
    id: `${r.source}:${r.source_id}`,
    source: r.source,
    source_id: r.source_id,
    title: r.title ?? 'Untitled',
    category: r.category ?? null,
    // prefer our ImgBB mirror when it exists — survives any source outage
    image_url: r.mirror_url || r.image_url,
    // Prefer the mirror for cards too; otherwise a dead source thumbnail can
    // make a successfully mirrored wallpaper disappear from discovery feeds.
    thumb_url: r.mirror_url || r.thumb_url || r.image_url,
    width: r.width || 0,
    height: r.height || 0,
    resolution: r.resolution ?? null,
    tags: r.tags ?? null,
    source_url: safeSourceUrl(r.source_url),
    seo_title: r.seo_title ?? null,
    seo_description: r.seo_description ?? null,
    seo_keywords: r.seo_keywords ?? null,
    seo_alt: r.seo_alt ?? null,
    views: r.views ?? 0,
    downloads: r.downloads ?? 0,
    is_featured: !!r.is_featured,
    is_premium: !!r.is_premium,
    created_at: r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCategory(r: any): Category {
  return {
    id: `${r.source}:${r.source_id}`,
    slug: r.slug ?? r.source_id,
    name: r.name,
    cover_url: r.cover_url ?? null,
    wallpaper_count: r.wallpaper_count ?? 0,
    is_premium: !!r.is_premium,
    source: r.source,
  };
}

/* --------------------------------- demo helpers -------------------------------- */

function demoFeed(q: FeedQuery): Paged<Wallpaper> {
  const perPage = q.perPage ?? PER_PAGE;
  let list = [...DEMO_WALLPAPERS];
  if (q.category) list = list.filter((w) => w.category === q.category);
  if (q.search) {
    const s = q.search.toLowerCase();
    list = list.filter((w) => (w.title + ' ' + w.category).toLowerCase().includes(s));
  }
  if (q.sort === 'popular') list.sort((a, b) => b.views - a.views);
  else if (q.sort === 'random') list.sort((a, b) => (seedOf(a.title) % 97) - (seedOf(b.title) % 97));
  else list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const total = list.length;
  const page = Math.max(1, q.page ?? 1);
  const data = list.slice((page - 1) * perPage, page * perPage);
  return { data, page, lastPage: Math.max(1, Math.ceil(total / perPage)), total };
}

/* ----------------------------------- public feed -------------------------------- */

export interface FeedQuery {
  page?: number;
  perPage?: number;
  category?: string | null;
  search?: string | null;
  sort?: SortMode;
}

/**
 * Some categories in the UI are SOURCE umbrella rows (source_id = '__all',
 * e.g. AnimePixels' "Anime" shelf). Walls are stored under their real
 * sub-category (a franchise name like "Demon Slayer"), never under the
 * umbrella label — so an exact `category = 'Anime'` filter used to return
 * zero rows even when the library is full. For those rows we instead show
 * every wallpaper from that source. (Audit fix.)
 */
async function umbrellaSourceFor(
  sb: NonNullable<ReturnType<typeof getAnonSupabase>>,
  category: string | null | undefined,
): Promise<string | null> {
  if (!category) return null;
  try {
    const { data } = await sb
      .from('categories')
      .select('source')
      .eq('name', category)
      .eq('source_id', '__all')
      .maybeSingle();
    const source = data?.source;
    return source && isStoredSource(source) ? String(source) : null;
  } catch {
    return null;
  }
}

async function supabaseFeed(q: FeedQuery): Promise<Paged<Wallpaper>> {
  const sb = getAnonSupabase()!;
  const perPage = Math.min(50, Math.max(1, Math.floor(q.perPage ?? PER_PAGE)));
  let page = Math.max(1, Math.floor(q.page ?? 1));
  const safeSearch = (q.search ?? '').replace(/[%,()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const hasSearch = safeSearch.length >= 2;
  // Umbrella category → filter by SOURCE instead of exact category text.
  const umbrellaSource = q.category ? await umbrellaSourceFor(sb, q.category) : null;
  const applyCategory = <T,>(qb: T): T =>
    umbrellaSource
      ? (qb as any).eq('source', umbrellaSource) as T
      : q.category
        ? (qb as any).eq('category', q.category) as T
        : qb;

  if (q.sort === 'random') {
    let countQuery = applyCategory(sb.from('wallpapers').select('*', { count: 'exact', head: true }).in('source', [...STORED_SOURCE_LIST]));
    if (hasSearch) countQuery = countQuery.or(`title.ilike.%${safeSearch}%,tags.ilike.%${safeSearch}%`);
    const { count, error } = await countQuery;
    if (error) throw new Error(error.message);
    const pages = Math.max(1, Math.ceil((count ?? 0) / perPage));
    page = 1 + (Math.floor(Math.random() * 10_000) % pages);
  }

  let query = applyCategory(sb.from('wallpapers').select('*', { count: 'exact' }).in('source', [...STORED_SOURCE_LIST]));
  if (hasSearch) query = query.or(`title.ilike.%${safeSearch}%,tags.ilike.%${safeSearch}%`);
  if (q.sort === 'popular') query = query.order('views', { ascending: false });
  else query = query.order('created_at', { ascending: false });
  // Stable tie-breakers prevent duplicates when many rows share timestamps/counts.
  query = query.order('source', { ascending: true }).order('source_id', { ascending: true });

  const { data, count, error } = await query.range((page - 1) * perPage, page * perPage - 1);
  if (error) throw new Error(error.message);
  let rows = (data ?? []).filter(isStoredWallpaperRow).map(rowToWallpaper);
  // Real-person/glamour content is never allowed, including typed searches.
  rows = rows.filter((wallpaper) => !isHardBlockedWallpaper(wallpaper));
  // Devotional discovery may be bypassed only by a meaningful explicit search.
  if (!hasSearch) rows = filterWallpapers(rows);
  return {
    data: rows,
    page,
    lastPage: Math.max(1, Math.ceil((count ?? 0) / perPage)),
    total: count ?? 0,
  };
}

export async function getWallpapers(q: FeedQuery): Promise<Paged<Wallpaper>> {
  const mode = getMode();
  try {
    if (mode === 'supabase') return await supabaseFeed(q);
    if (mode === 'live') return await liveWallpapers(q);
  } catch (e) {
    console.error('feed error:', e);
    if (mode === 'supabase') {
      const page = Math.max(1, q.page ?? 1);
      return { data: [], page, lastPage: page, total: 0 };
    }
  }
  return demoFeed(q);
}

export async function getWallpaperById(id: string): Promise<Wallpaper | null> {
  const sep = id.indexOf(':');
  if (sep < 0) return null;
  const source = id.slice(0, sep);
  const sourceId = id.slice(sep + 1);

  if (source === 'demo') {
    const wallpaper = DEMO_WALLPAPERS.find((w) => w.source_id === sourceId) ?? null;
    return wallpaper && !isHardBlockedWallpaper(wallpaper) ? wallpaper : null;
  }
  if (!isStoredSource(source) || !/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) return null;

  const mode = getMode();
  try {
    if (mode === 'supabase') {
      const { data } = await getAnonSupabase()!
        .from('wallpapers')
        .select('*')
        .eq('source', source)
        .eq('source_id', sourceId)
        .maybeSingle();
      if (data) {
        const wallpaper = rowToWallpaper(data);
        return isHardBlockedWallpaper(wallpaper) ? null : wallpaper;
      }
    } else if (mode === 'live' && (source === 'nexwall' || source === 'animepixels' || source === 'wallhaven')) {
      const wallpaper = await liveWallpaperById(source, sourceId);
      return wallpaper && !isHardBlockedWallpaper(wallpaper) ? wallpaper : null;
    }
  } catch (e) {
    console.error('wallpaper lookup failed:', e);
  }
  return null;
}

/* ---------------------------------- categories -------------------------------- */

/** Deterministic slug for a real stored category name. */
function categorySlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return s || 'misc';
}

/**
 * Moods/category cards are built from the STORED catalog, not from the source
 * `categories` table. The source table advertises totals for the WHOLE source
 * (e.g. "NexWall Nature — 3,200 walls") even when only a few rows have been
 * synced, which made most cards lead to "Nothing matched". Building from the
 * wallpapers rows guarantees:
 *   • every card corresponds to categories that actually contain walls,
 *   • the number on the card is the REAL stored count,
 *   • clicking a card always returns results.
 *
 * A source umbrella row (source_id '__all', e.g. AnimePixels → "Anime") is
 * kept when that source has walls; it resolves to all of that source's walls.
 */
/** Categories WITHOUT the Admin custom-cover overlay — the auto covers.
 *  Uncached implementation; the exported getCategoriesRaw adds memoization. */
async function getCategoriesRawUncached(): Promise<Category[]> {
  const mode = getMode();
  try {
    if (mode === 'supabase') {
      const sb = getAnonSupabase()!;
      // Aggregate real (source, category) facts from the stored catalog.
      const pageSize = 1000;
      const facts: { source: string; category: string; cover: string | null }[] = [];
      let start = 0;
      while (facts.length < 250_000) {
        const { data, error } = await sb
          .from('wallpapers')
          .select('source, category, created_at, mirror_url, thumb_url, image_url')
          .in('source', [...STORED_SOURCE_LIST])
          .order('created_at', { ascending: false })
          .range(start, start + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        for (const r of batch) {
          const source = String(r.source ?? '');
          const name = String(r.category ?? '').trim().slice(0, 80);
          if (!isStoredSource(source) || !name) continue;
          const cover = r.mirror_url || r.thumb_url || r.image_url || null;
          facts.push({ source, category: name, cover: typeof cover === 'string' ? cover : null });
        }
        if (batch.length < pageSize) break;
        start += pageSize;
      }

      const group = new Map<string, { name: string; source: string; count: number; cover: string | null }>();
      const sourceTotal = new Map<string, number>();
      for (const f of facts) {
        const key = `${f.source}::${f.category}`;
        const cur = group.get(key);
        if (cur) {
          cur.count++;
          if (!cur.cover && f.cover) cur.cover = f.cover;
        } else {
          group.set(key, { name: f.category, source: f.source, count: 1, cover: f.cover });
        }
        sourceTotal.set(f.source, (sourceTotal.get(f.source) ?? 0) + 1);
      }

      const cats: Category[] = [];
      for (const g of group.values()) {
        cats.push({
          id: `${g.source}:${categorySlug(g.name)}`,
          slug: categorySlug(g.name),
          name: g.name,
          cover_url: g.cover,
          wallpaper_count: g.count,
          is_premium: false,
          source: g.source,
        });
      }

      // Re-add source umbrella shelves (e.g. AnimePixels → "Anime") that exist
      // in the categories table when that source actually has stored walls.
      try {
        const { data: umbrellas } = await sb
          .from('categories')
          .select('source, source_id, name, slug, cover_url')
          .eq('source_id', '__all')
          .in('source', [...STORED_SOURCE_LIST]);
        for (const u of umbrellas ?? []) {
          const total = sourceTotal.get(String(u.source)) ?? 0;
          if (!total) continue;
          const firstGroup = [...group.values()].find((g) => g.source === u.source && g.cover)?.cover;
          const name = String(u.name ?? '');
          if (!name) continue;
          cats.push({
            id: `${u.source}:${u.source_id}`,
            slug: String(u.slug || categorySlug(name)),
            name,
            cover_url: u.cover_url || firstGroup || null,
            wallpaper_count: total,
            is_premium: false,
            source: String(u.source),
          });
        }
      } catch {
        /* umbrella shelves optional */
      }

      // Dedupe by display name (biggest count wins), then discovery-filter and sort.
      const best = new Map<string, Category>();
      for (const c of cats) {
        const prev = best.get(c.name);
        if (!prev || c.wallpaper_count > prev.wallpaper_count) best.set(c.name, c);
      }

      return filterCategories([...best.values()]).sort((a, b) => b.wallpaper_count - a.wallpaper_count);
    } else if (mode === 'live') {
      return await liveCategories();
    }
  } catch (e) {
    console.error('categories error:', e);
    if (mode === 'supabase') return [];
  }
  return filterCategories(DEMO_CATEGORIES);
}

/* ── Server-side memoization for the category aggregation ────────────────────
   The raw catalog scan above is the heaviest read on public pages and the root
   Navbar re-reads categories on every route, so the result is memoized three
   times:
   • React cache() dedupes the concurrent reads within a single request;
   • a short in-process TTL keeps the aggregation reusable across requests;
   • unstable_cache (5 min) survives across serverless instances — with the
     ISR revalidate on home/categories, the scan now runs at most once per
     5 minutes instead of once per page generation.
   Admin-set custom covers are applied AFTER this layer on every request, so a
   cover change still shows within the same 5-minute window. */
const CATS_MEMO_TTL_MS = 60_000;
let catsMemoJson: string | null = null;
let catsMemoAt = 0;

/**
 * Cross-instance data cache for the scan. An empty scan result is the error
 * path of `getCategoriesRawUncached()` — throw instead of returning it so the
 * failure is never cached for 5 minutes across instances.
 */
const _catsRawDataCache = unstable_cache(
  async (): Promise<Category[]> => {
    const cats = await getCategoriesRawUncached();
    if (cats.length === 0) throw new Error('empty category scan — not caching');
    return cats;
  },
  ['wallora-cats-raw-v1'],
  { revalidate: 300 },
);

export async function getCategoriesRaw(): Promise<Category[]> {
  if (getMode() === 'supabase' && catsMemoJson) {
    const now = Date.now();
    if (now - catsMemoAt < CATS_MEMO_TTL_MS) {
      try {
        return JSON.parse(catsMemoJson) as Category[];
      } catch {
        /* corrupted memo — rebuild below */
      }
    }
  }
  let fresh: Category[];
  if (getMode() === 'supabase') {
    try {
      fresh = await _catsRawDataCache();
    } catch {
      fresh = await getCategoriesRawUncached(); // transient failure — try live
    }
  } else {
    fresh = await getCategoriesRawUncached();
  }
  // Never memoize an empty result — it doubles as the "error path" of the
  // scan, and we don't want a transient failure pinning an empty shelf list.
  if (getMode() === 'supabase' && fresh.length > 0) {
    catsMemoJson = JSON.stringify(fresh);
    catsMemoAt = Date.now();
  }
  return fresh;
}

/**
 * Categories exactly as public pages show them: the auto cover from
 * {@link getCategoriesRaw}, overridden by any Admin-set custom covers
 * (categories rows with source='custom', keyed by the exact display name).
 * Custom rows sit outside the public RLS source allowlist, so they are read
 * with the server-side service client when one exists.
 */
async function getCategoriesLive(): Promise<Category[]> {
  const categories = await getCategoriesRaw();
  if (getMode() !== 'supabase') return categories;
  try {
    const svc = serviceKeyConfigured() ? getServiceSupabase() : null;
    const source = svc ?? getAnonSupabase();
    if (!source) return categories;
    const { data: covers } = await source
      .from('categories')
      .select('name, cover_url')
      .eq('source', 'custom');
    const byName = new Map(categories.map((category) => [category.name, category]));
    for (const row of covers ?? []) {
      const name = String(row.name ?? '');
      const url = String(row.cover_url ?? '');
      const entry = byName.get(name);
      if (entry && url) entry.cover_url = url;
    }
  } catch {
    /* custom covers optional */
  }
  return categories;
}

/** React cache() — within one request the root Navbar and the page body both
 *  call getCategories(); dedupe so the expensive part runs exactly once. */
export const getCategories = cache(getCategoriesLive);

export async function getTrending(limit = 10): Promise<Wallpaper[]> {
  return (await getWallpapers({ sort: 'popular', perPage: limit })).data;
}

export async function getFeatured(limit = 6): Promise<Wallpaper[]> {
  const mode = getMode();
  if (mode === 'supabase') {
    try {
      const { data, error } = await getAnonSupabase()!
        .from('wallpapers')
        .select('*')
        .in('source', [...STORED_SOURCE_LIST])
        .eq('is_featured', true)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return filterWallpapers((data ?? []).filter(isStoredWallpaperRow).map(rowToWallpaper));
    } catch (error) {
      console.error('featured error:', error);
      return [];
    }
  }
  if (mode === 'live') return (await getWallpapers({ sort: 'random', perPage: limit })).data;
  return DEMO_WALLPAPERS.filter((w) => w.is_featured).slice(0, limit);
}

export async function getLatest(limit = 15): Promise<Wallpaper[]> {
  return (await getWallpapers({ sort: 'newest', perPage: limit })).data;
}

/** Hero mosaic tiles — shuffled and interleaved across as many distinct categories as possible. */
export async function getHeroTiles(count = 15): Promise<Wallpaper[]> {
  let pool: Wallpaper[] = [];
  try {
    // Stored-catalog mode must never spend source API quota during a page view.
    // A live AnimePixels peek is useful only when the whole site is in live mode.
    const anime = getMode() === 'live' ? await liveAnimePeek(8).catch(() => [] as Wallpaper[]) : [];
    const feed = await getWallpapers({ sort: 'random', perPage: 24 }).catch(() => ({ data: [] as Wallpaper[] }));
    pool = [...anime, ...feed.data]; // anime first so franchises get their own buckets
  } catch {
    /* fall through */
  }
  if (getMode() === 'demo' && pool.length < count) pool = [...pool, ...DEMO_WALLPAPERS];

  // group by category, then round-robin so neighbouring tiles are different vibes
  const byCat = new Map<string, Wallpaper[]>();
  for (const w of pool) {
    const k = w.category ?? 'misc';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(w);
  }
  const buckets = [...byCat.values()];
  const out: Wallpaper[] = [];
  while (out.length < count && buckets.some((b) => b.length)) {
    for (const b of buckets) {
      if (out.length >= count) break;
      const w = b.shift();
      if (w) out.push(w);
    }
  }
  return out;
}

export async function getRelated(w: Wallpaper, limit = 8): Promise<Wallpaper[]> {
  if (getMode() === 'live') return liveRelated(w, limit).catch(() => []);
  const feed = await getWallpapers({ category: w.category ?? undefined, perPage: limit + 1 });
  return feed.data.filter((x) => x.id !== w.id).slice(0, limit);
}

/* ----------------------------------- tracking ----------------------------------- */

export async function trackEvent(id: string, type: 'view' | 'download'): Promise<boolean> {
  const sb = getServiceSupabase();
  if (!sb) return true; // demo/live mode: analytics need Supabase
  const sep = id.indexOf(':');
  if (sep < 0) return false;
  const source = id.slice(0, sep);
  const source_id = id.slice(sep + 1);
  if (source === 'demo') return true;
  const { data, error } = await sb.rpc('track_wallpaper_event', {
    p_source: source,
    p_source_id: source_id,
    p_type: type,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/* ---------------------------------- site stats ---------------------------------- */

export interface SiteStats {
  walls: number;
  views: number;
  downloads: number;
}

/**
 * Site counters trail live tracking POSTs by at most 5 minutes — accepted so
 * the home/categories ISR pages can render from cache instead of hitting
 * Supabase on every generation. (The tracking endpoints themselves always
 * write real data; only the display numbers are stale-while-revalidate.)
 */
const _siteStatsCache = unstable_cache(
  async (): Promise<SiteStats> => {
    const { data, error } = await getAnonSupabase()!.from('site_stats').select('*').maybeSingle();
    if (error) throw new Error(error.message);
    return {
      walls: Number(data?.walls ?? 0),
      views: Number(data?.views ?? 0),
      downloads: Number(data?.downloads ?? 0),
    };
  },
  ['wallora-site-stats-v1'],
  { revalidate: 300 },
);

export async function getSiteStats(): Promise<SiteStats> {
  const mode = getMode();
  try {
    if (mode === 'supabase') {
      return await _siteStatsCache();
    } else if (mode === 'live') {
      return await liveSiteStats();
    }
  } catch (e) {
    console.error('stats error:', e);
    if (mode === 'supabase') return { walls: 0, views: 0, downloads: 0 };
  }
  return demoSiteStats();
}

export function demoSiteStats(): SiteStats {
  return { walls: DEMO_WALLPAPERS.length, views: 0, downloads: 0 };
}

/* ----------------------------------- dashboard ---------------------------------- */

export async function getDashboardStats(): Promise<DashboardStats> {
  const sb = getServiceSupabase();
  if (!sb) return demoDashboardStats();

  const dayMs = 36e5 * 24;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = new Date(Date.now() - 13 * dayMs).toISOString().slice(0, 10);

  const [statsRes, dailyRes, topRes, nexRes, whRes, apRes, manualRes, allWallsRes, tvRes, tdRes] = await Promise.all([
    sb.from('site_stats').select('*').maybeSingle(),
    sb.from('daily_stats').select('*').gte('day', since),
    sb.from('wallpapers').select('*').order('views', { ascending: false }).limit(8),
    sb.from('wallpapers').select('*', { count: 'exact', head: true }).eq('source', 'nexwall'),
    sb.from('wallpapers').select('*', { count: 'exact', head: true }).eq('source', 'wallhaven'),
    sb.from('wallpapers').select('*', { count: 'exact', head: true }).eq('source', 'animepixels'),
    sb.from('wallpapers').select('*', { count: 'exact', head: true }).eq('source', 'manual'),
    sb.from('wallpapers').select('*', { count: 'exact', head: true }),
    sb.from('events').select('*', { count: 'exact', head: true }).eq('type', 'view').gte('created_at', today.toISOString()),
    sb.from('events').select('*', { count: 'exact', head: true }).eq('type', 'download').gte('created_at', today.toISOString()),
  ]);

  const series: DashboardStats['series'] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * dayMs);
    const dayKey = d.toISOString().slice(0, 10);
    const row = (dailyRes.data ?? []).find((r: any) => String(r.day).slice(0, 10) === dayKey);
    series.push({
      day: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      views: Number(row?.views ?? 0),
      downloads: Number(row?.downloads ?? 0),
    });
  }

  return {
    demo: false,
    totals: {
      // Count the catalog directly so manual additions/deletions appear on the next render.
      walls: Number(allWallsRes.count ?? statsRes.data?.walls ?? 0),
      views: Number(statsRes.data?.views ?? 0),
      downloads: Number(statsRes.data?.downloads ?? 0),
      todayViews: tvRes.count ?? 0,
      todayDownloads: tdRes.count ?? 0,
    },
    series,
    top: filterWallpapers((topRes.data ?? []).filter(isStoredWallpaperRow).map(rowToWallpaper)).slice(0, 8),
    bySource: {
      nexwall: nexRes.count ?? 0,
      wallhaven: whRes.count ?? 0,
      animepixels: apRes.count ?? 0,
      manual: manualRes.count ?? 0,
      demo: 0,
    },
  };
}

function demoDashboardStats(): DashboardStats {
  const totals = demoSiteStats();
  const series: DashboardStats['series'] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 36e5 * 24);
    series.push({
      day: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      views: 0,
      downloads: 0,
    });
  }
  return {
    demo: true,
    totals: { ...totals, todayViews: 0, todayDownloads: 0 },
    series,
    top: DEMO_WALLPAPERS.slice(0, 8),
    bySource: { nexwall: 0, wallhaven: 0, animepixels: 0, manual: 0, demo: DEMO_WALLPAPERS.length },
  };
}

export async function getRecentSyncRuns() {
  const sb = getServiceSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('sync_runs')
    .select('*')
    .not('source', 'like', 'manual-sync:%')
    .not('source', 'like', 'job-reservation:%')
    .order('created_at', { ascending: false })
    .limit(8);
  return data ?? [];
}
