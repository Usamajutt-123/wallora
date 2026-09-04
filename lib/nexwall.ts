// NexWall Developer API — https://nexwall.kodnextech.com/wallpaper-api/docs
const BASE = 'https://nexwall.kodnextech.com/api/developer/v1';

const key = () => process.env.NEXWALL_API_KEY;
export const nexwallConfigured = () => Boolean(key());

// ── Quota circuit-breaker: once NexWall says "daily limit reached" (429),
// stop calling it entirely until reset (00:00 UTC). Fallback feeds (AnimePixels
// + Wallhaven) keep the site fully alive meanwhile.
let quotaDeadUntil = 0;
export const nexwallQuotaDead = () => Date.now() < quotaDeadUntil;
function tripIfQuota(status: number, body: string) {
  if (status === 429 || /daily API request limit/i.test(body)) {
    const reset = new Date();
    reset.setUTCHours(24, 0, 0, 0);
    quotaDeadUntil = reset.getTime();
  }
}

async function req(path: string) {
  if (Date.now() < quotaDeadUntil) {
    throw new Error('NexWall quota dead — circuit breaker open until UTC midnight');
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key()}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    tripIfQuota(res.status, body);
    throw new Error(`NexWall HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return {
    json,
    remaining:
      remaining ?? (typeof json?.remaining_requests_today === 'number' ? String(json.remaining_requests_today) : null),
  };
}

export interface NormalizedWall {
  source: 'nexwall' | 'animepixels' | 'wallhaven';
  source_id: string;
  title: string;
  category: string | null;
  image_url: string;
  thumb_url: string;
  width: number;
  height: number;
  resolution: string | null;
  tags: string | null;
  is_premium: boolean;
  source_url: string | null;
  api_views: number;
  api_downloads: number;
}

function pick(o: any, keys: string[]): any {
  for (const k of keys) if (o?.[k]) return o[k];
  return undefined;
}

function trustedNexwallImage(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    const host = url.hostname.toLowerCase();
    const domains = ['kodnextech.com', 'nexwall.app', 'nexwallcdn.com', 'cloudinary.com'];
    return url.protocol === 'https:' && !url.username && !url.password &&
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeAttribution(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().slice(0, 2048) : '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function dimension(value: unknown): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 && number <= 20000 ? number : 0;
}

function metric(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

/** "lord shiva, mahadev, red trishul" → "Lord Shiva · Mahadev" */
export function titleFromTags(tags: string | null, fallback: string): string {
  const safeFallback = String(fallback ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'NexWall Wallpaper';
  if (!tags || typeof tags !== 'string') return safeFallback;
  const parts = tags
    .split(',')
    .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()));
  return parts.length ? parts.join(' · ').slice(0, 140) : safeFallback;
}

function normalize(w: any): NormalizedWall | null {
  if (w?.id == null) return null;
  const sourceId = String(w.id);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) return null;
  if (w?.type && w.type !== 'image') return null; // this catalog renders still images only

  const image = trustedNexwallImage(
    pick(w, ['image_url', 'full_image_url', 'wallpaper_url', 'full_url', 'url', 'image']) ?? w?.images?.full,
  );
  if (!image) return null;
  const thumb = trustedNexwallImage(
    pick(w, ['thumbnail_url', 'thumb_url', 'preview_url', 'thumb']) ?? w?.images?.thumb ?? image,
  ) ?? image;

  let width = dimension(w.width);
  let height = dimension(w.height);
  const rawResolution = typeof w.resolution === 'string' ? w.resolution.trim().slice(0, 40) : '';
  const resolutionMatch = rawResolution.match(/^(\d{3,5})x(\d{3,5})$/i);
  if ((!width || !height) && resolutionMatch) {
    width = dimension(resolutionMatch[1]);
    height = dimension(resolutionMatch[2]);
  }
  const resolution = width && height ? `${width}x${height}` : null;

  const tags: string | null =
    typeof w.tags === 'string' && w.tags.trim() ? w.tags.replace(/\s+/g, ' ').trim().slice(0, 500) : null;
  const rawCategory = w.category?.name ?? w.categories?.[0]?.name ?? w.category_name;
  const primaryCategory = typeof rawCategory === 'string'
    ? rawCategory.replace(/\s+/g, ' ').trim().slice(0, 80) || null
    : null;

  return {
    source: 'nexwall',
    source_id: sourceId,
    title: titleFromTags(tags, w.title || w.name || `NexWall #${w.id}`),
    category: primaryCategory,
    image_url: image,
    thumb_url: thumb,
    width,
    height,
    resolution,
    tags,
    is_premium: Boolean(w.is_premium),
    source_url: safeAttribution(w.source_url),
    api_views: metric(w.views ?? w.view_count),
    api_downloads: metric(w.downloads ?? w.download_count),
  };
}

export interface NexCategory {
  source: 'nexwall';
  source_id: string;
  name: string;
  slug: string;
  cover_url: string | null;
  wallpaper_count: number;
  is_premium: boolean;
}

export interface NexPaged {
  items: NormalizedWall[];
  current: number;
  last: number;
  total: number;
  remaining: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePaged(json: any, fallbackPage: number, remaining: string | null): NexPaged {
  const list = Array.isArray(json?.data) ? json.data.slice(0, 100) : [];
  const current = Math.min(10_000, Math.max(1, Math.floor(Number(json?.current_page) || fallbackPage)));
  const last = Math.min(10_000, Math.max(current, Math.floor(Number(json?.last_page) || current)));
  const rawTotal = Math.floor(Number(json?.total));
  return {
    items: list.map(normalize).filter(Boolean) as NormalizedWall[],
    current,
    last,
    total: Number.isSafeInteger(rawTotal) && rawTotal >= 0 ? rawTotal : list.length,
    remaining,
  };
}

export async function fetchNexwallCategories(): Promise<NexCategory[]> {
  if (!key()) return [];
  const { json } = await req('/categories');
  const list = Array.isArray(json?.data) ? json.data.slice(0, 500) : [];
  return list
    .map((c: any): NexCategory | null => {
      const sourceId = String(c?.id ?? '');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) return null;
      const name = String(c?.name ?? 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
      const rawSlug = String(c?.slug ?? sourceId).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      return {
        source: 'nexwall',
        source_id: sourceId,
        name,
        slug: rawSlug.slice(0, 100) || sourceId.toLowerCase(),
        cover_url: trustedNexwallImage(c?.cover_image_url),
        wallpaper_count: metric(c?.wallpaper_count),
        is_premium: Boolean(c?.is_premium),
      };
    })
    .filter((category: NexCategory | null): category is NexCategory => category !== null);
}

export async function fetchNexwallWallpapers(opts: {
  page?: number;
  perPage?: number;
  sort?: 'newest' | 'popular' | 'oldest' | 'random';
  search?: string;
} = {}): Promise<NexPaged> {
  const page = Math.min(10_000, Math.max(1, Math.floor(Number(opts.page) || 1)));
  const perPage = Math.min(100, Math.max(1, Math.floor(Number(opts.perPage) || 50)));
  const p = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
    sort: opts.sort ?? 'newest',
  });
  if (opts.search && opts.search.trim().length >= 2) p.set('search', opts.search.trim().slice(0, 120));
  const { json, remaining } = await req(`/wallpapers?${p.toString()}`);
  return parsePaged(json, page, remaining);
}

export async function fetchNexwallCategoryWalls(
  categoryId: string | number,
  page = 1,
  perPage = 24,
): Promise<NexPaged> {
  const safeCategoryId = String(categoryId);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(safeCategoryId)) throw new Error('Invalid NexWall category id');
  const safePage = Math.min(10_000, Math.max(1, Math.floor(Number(page) || 1)));
  const safePerPage = Math.min(100, Math.max(1, Math.floor(Number(perPage) || 24)));
  const { json, remaining } = await req(
    `/categories/${encodeURIComponent(safeCategoryId)}/wallpapers?per_page=${safePerPage}&page=${safePage}`,
  );
  return parsePaged(json, safePage, remaining);
}

export async function fetchNexwallWallpaper(id: string): Promise<NormalizedWall | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  const { json } = await req(`/wallpapers/${encodeURIComponent(id)}`);
  const w = json?.data ?? json;
  return w ? normalize(w) : null;
}
