// AnimePixels (Anima) API — currently accessed without an API key
// Base: https://anima-image-api.vercel.app/api/images?per_page=100&page=1&category=Naruto
import type { NormalizedWall } from './nexwall';
import { isHardBlockedWallpaper } from './filters';

const BASE = 'https://anima-image-api.vercel.app/api/images';

export interface ApItem {
  id: number;
  url: string;
  category: string;
  name: string;
  tags: string[];
  width: number;
  height: number;
  createdAt: string;
}

function trustedAnimeImage(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    const host = url.hostname.toLowerCase();
    const domains = ['cloudinary.com', 'anima-image-api.vercel.app'];
    return url.protocol === 'https:' && !url.username && !url.password &&
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** cloudinary on-the-fly transform → light thumbs */
function thumbOf(url: string): string {
  return url.includes('/image/upload/')
    ? url.replace('/image/upload/', '/image/upload/c_limit,w_900,f_auto,q_auto/')
    : url;
}

function normalize(w: ApItem): NormalizedWall | null {
  const id = Math.floor(Number(w?.id));
  if (!Number.isSafeInteger(id) || id <= 0 || !w?.url) return null;
  const image = trustedAnimeImage(w.url);
  if (!image) return null;
  const cat = String(w.category ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Anime & Manga';
  const title = String(w.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || cat;
  const widthValue = Math.round(Number(w.width));
  const heightValue = Math.round(Number(w.height));
  const width = Number.isFinite(widthValue) && widthValue > 0 && widthValue <= 20000 ? widthValue : 0;
  const height = Number.isFinite(heightValue) && heightValue > 0 && heightValue <= 20000 ? heightValue : 0;
  const tags = Array.isArray(w.tags)
    ? w.tags.filter((tag): tag is string => typeof tag === 'string').join(', ').replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';
  const normalized: NormalizedWall = {
    source: 'animepixels',
    source_id: String(id),
    title,
    category: cat,
    image_url: image,
    thumb_url: thumbOf(image),
    width,
    height,
    resolution: width && height ? `${width}x${height}` : null,
    tags: tags || `anime, ${cat.toLowerCase()}`.slice(0, 500),
    is_premium: false,
    source_url: 'https://anima-image-api.vercel.app',
    api_views: 0,
    api_downloads: 0,
  };
  return isHardBlockedWallpaper(normalized) ? null : normalized;
}

export interface ApPaged {
  items: NormalizedWall[];
  page: number;
  /** API gives no totals — treat a short/empty page as the end */
  lastPage: number;
}

export async function fetchAnimePixels(opts: {
  page?: number;
  perPage?: number;
  category?: string;
} = {}): Promise<ApPaged> {
  const page = Math.min(10_000, Math.max(1, Math.floor(Number(opts.page) || 1)));
  const perPage = Math.min(100, Math.max(1, Math.floor(Number(opts.perPage) || 24)));
  const p = new URLSearchParams({ per_page: String(perPage), page: String(page) });
  if (opts.category) p.set('category', opts.category.trim().slice(0, 80));
  const res = await fetch(`${BASE}?${p.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`AnimePixels HTTP ${res.status}`);
  const list = (await res.json()) as ApItem[];
  const rawItems = Array.isArray(list) ? list.slice(0, 100) : [];
  const items = rawItems.map(normalize).filter(Boolean) as NormalizedWall[];
  return { items, page, lastPage: rawItems.length < perPage ? page : Math.min(10_000, page + 1) };
}

const GENERIC_CATS = new Set(['nature', 'other', 'others', 'misc', 'random', 'general', 'aesthetic']);

/** Derive the franchise shelf (Naruto, Demon Slayer…) by scanning the library — cached by caller. */
export async function fetchAnimeCategories(): Promise<
  { name: string; count: number; cover: string; totalLibrary: number }[]
> {
  const pages = [1, 2, 3, 4, 5, 6, 7];
  const results = await Promise.all(
    pages.map(async (p) => {
      const res = await fetch(`${BASE}?per_page=100&page=${p}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`AnimePixels HTTP ${res.status}`);
      return (await res.json()) as ApItem[];
    }),
  );
  const map = new Map<string, { count: number; cover: string }>();
  let total = 0;
  for (const list of results) {
    for (const it of Array.isArray(list) ? list.slice(0, 100) : []) {
      const image = trustedAnimeImage(it.url);
      if (!image) continue;
      total++;
      const name = typeof it.category === 'string'
        ? it.category.replace(/\s+/g, ' ').trim().slice(0, 80)
        : '';
      if (!name) continue;
      const cur = map.get(name);
      if (cur) cur.count++;
      else map.set(name, { count: 1, cover: thumbOf(image) });
    }
  }
  return [...map.entries()]
    .filter(([name]) => !GENERIC_CATS.has(name.toLowerCase()))
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, v]) => ({ name, count: v.count, cover: v.cover, totalLibrary: total }));
}
