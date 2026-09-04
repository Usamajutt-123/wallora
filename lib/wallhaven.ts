// Wallhaven API v1 — curated shelves for the categories NexWall lacks.
// Safety rules:General-only or Anime-flag as needed, purity=100 (SFW),
// toplist sorting (established, highest-rated uploads), attribution kept.
import type { NormalizedWall } from './nexwall';
import { isHardBlockedWallpaper } from './filters';

const key = () => process.env.WALLHAVEN_API_KEY;
export const wallhavenConfigured = () => Boolean(key());

/** Missing category shelves, each backed by a curated Wallhaven query. */
export const WH_SHELVES: { name: string; slug: string; query: string; emoji: string }[] = [
  // NOTE: single broad tags only — wallhaven multi-term queries are strict AND (nearly empty)
  { name: 'Gaming', slug: 'gaming', query: 'gaming', emoji: '🎮' }, // ~497
  { name: 'Space & Cosmos', slug: 'space-cosmos', query: 'space', emoji: '🌌' }, // ~69
  { name: 'AMOLED & Dark', slug: 'amoled-dark', query: 'dark', emoji: '⬛' }, // ~302
  { name: 'Cyberpunk City', slug: 'cyberpunk-city', query: 'cyberpunk', emoji: '🌃' }, // ~28
  { name: 'Fantasy Worlds', slug: 'fantasy', query: 'fantasy', emoji: '🐉' }, // ~651
];

export function shelfBySlug(slug: string) {
  return WH_SHELVES.find((s) => s.slug === slug);
}

/** Tag walls with their shelf name; search results carry no tags, so give a readable fallback title. */
export function withShelf<T extends { category: string | null; title: string; tags: string | null; resolution: string | null }>(
  walls: T[],
  shelfName: string,
): T[] {
  return walls.map((w) => ({
    ...w,
    category: shelfName,
    // real keyword-rich name when the API gives no tags (NEVER a bare "5000x2813")
    title: w.tags ? w.title : `${shelfName} Wallpaper · ${w.resolution || 'HD'}`,
  }));
}

export interface WhPaged {
  items: NormalizedWall[];
  current: number;
  last: number;
  total: number;
}

function trustedWallhavenUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password &&
      (host === 'wallhaven.cc' || host.endsWith('.wallhaven.cc'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeWallhaven(w: any, hint?: string | null): NormalizedWall | null {
  if (!w?.id || !w?.path) return null;
  const sourceId = String(w.id);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) return null;
  const image = trustedWallhavenUrl(w.path);
  if (!image) return null;
  if (String(w.category ?? '').toLowerCase() === 'people') return null;
  if (w.purity && String(w.purity).toLowerCase() !== 'sfw') return null;
  const resolutionMatch = String(w.resolution ?? '').match(/^(\d{3,5})x(\d{3,5})$/i);
  const rawWidth = resolutionMatch ? Number(resolutionMatch[1]) : 0;
  const rawHeight = resolutionMatch ? Number(resolutionMatch[2]) : 0;
  const width = rawWidth > 0 && rawWidth <= 20000 ? rawWidth : 0;
  const height = rawHeight > 0 && rawHeight <= 20000 ? rawHeight : 0;
  const resolution = width && height ? `${width}x${height}` : null;
  const tags = Array.isArray(w.tags)
    ? w.tags
        .map((t: any) => (typeof t?.name === 'string' ? t.name.replace(/\s+/g, ' ').trim().slice(0, 60) : ''))
        .filter(Boolean)
    : [];
  const capHint = hint
    ? hint
        .replace(/[^a-z0-9\s-]/gi, ' ')
        .trim()
        .slice(0, 60)
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => s.replace(/\b\w/g, (c: string) => c.toUpperCase()))
        .join(' ')
    : null;
  const title = (
    tags.length
      ? tags
          .slice(0, 2)
          .map((t: string) => t.replace(/\b\w/g, (c: string) => c.toUpperCase()))
          .join(' · ')
      : `${capHint ? capHint + ' HD' : 'HD'} Wallpaper · ${resolution ?? `#${sourceId}`}`
  ).replace(/\s+/g, ' ').trim().slice(0, 140);
  const tagsText = tags.join(', ').slice(0, 500) || null;
  const rawViews = Math.floor(Number(w.views));
  const rawFavorites = Math.floor(Number(w.favorites));
  const normalized: NormalizedWall = {
    source: 'wallhaven',
    source_id: sourceId,
    // Wallhaven's LIST endpoint ships no tags — fallback remains descriptive.
    title,
    category: null, // shelf name gets assigned by the caller
    image_url: image,
    thumb_url: trustedWallhavenUrl(w.thumbs?.large ?? w.thumbs?.small) ?? image,
    width,
    height,
    resolution,
    tags: tagsText,
    is_premium: false,
    source_url: trustedWallhavenUrl(w.url) ?? `https://wallhaven.cc/w/${encodeURIComponent(sourceId)}`, // attribution
    api_views: Number.isSafeInteger(rawViews) && rawViews > 0 ? rawViews : 0,
    api_downloads: Number.isSafeInteger(rawFavorites) && rawFavorites > 0 ? rawFavorites : 0,
  };
  return isHardBlockedWallpaper(normalized) ? null : normalized;
}

/** Excluded source-level: no real-person/glamour PHOTOS ever reach the site.
 *  (Illustrated/fantasy art untouched — only photography-realm tags are negated,
 *   and the entire "people" category is OFF below.) */
const WH_PEOPLE_NEGATIVES =
  '-people -person -models -actress -celebrity -cosplay -bikini -lingerie -bride -selfie -photograph -photoshoot -glamour';

export async function fetchWallhavenSearch(opts: {
  q: string;
  page?: number;
  categories?: string; // '100' general · '010' anime · '001' people
}): Promise<WhPaged> {
  const categories = opts.categories && ['100', '010', '110'].includes(opts.categories) ? opts.categories : '110';
  const page = Math.min(40, Math.max(1, Math.floor(Number(opts.page) || 1)));
  const p = new URLSearchParams({
    q: `${opts.q.slice(0, 120)} ${WH_PEOPLE_NEGATIVES}`, // negative tags drop real-girl photos at the SOURCE
    categories, // people category is always OFF
    purity: '100', // SFW only — always
    sorting: 'toplist', // best walls first — always
    page: String(page),
  });
  if (key()) p.set('apikey', key()!);
  const res = await fetch(`https://wallhaven.cc/api/v1/search?${p.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Wallhaven HTTP ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data.slice(0, 100) : [];
  const titleHint = opts.q.split(/\s+/)[0] ?? null; // e.g. "gaming" from the user's query
  const current = Math.min(40, Math.max(1, Math.floor(Number(json?.meta?.current_page) || 1)));
  const last = Math.min(40, Math.max(current, Math.floor(Number(json?.meta?.last_page) || current)));
  const rawTotal = Math.floor(Number(json?.meta?.total));
  return {
    items: list.map((w: any) => normalizeWallhaven(w, titleHint)).filter(Boolean) as NormalizedWall[],
    current,
    last,
    total: Number.isSafeInteger(rawTotal) && rawTotal >= 0 ? rawTotal : list.length,
  };
}

export async function fetchWallhavenById(id: string): Promise<NormalizedWall | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  const url = new URL(`https://wallhaven.cc/api/v1/w/${encodeURIComponent(id)}`);
  if (key()) url.searchParams.set('apikey', key()!);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Wallhaven HTTP ${res.status}`);
  const json = await res.json();
  return json?.data ? normalizeWallhaven(json.data) : null;
}
