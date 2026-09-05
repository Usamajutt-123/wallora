/**
 * Wallpaper URL → display URL.
 *
 * Two kinds of hosts:
 *  • DIRECT  — the CDN allows browser hotlinking with no referer check AND the
 *    files are already small, so we load straight from it (fast, reliable, no
 *    server hop). Unsplash (demo data, already sized by query string) is the
 *    only host left in this bucket.
 *  • PROXIED — everything else, for two reasons:
 *      – reliability: hosts that rate-limit or block hotlink bursts (the NexWall
 *        CDN returns HTTP 444) are served through our hardened /api/img proxy,
 *        so one cached upstream fetch serves everyone;
 *      – weight: Wallhaven is perfectly hotlink-friendly, but `path` points at
 *        the FULL original (multi-MB) and even `thumbs.large` is 1920 px wide.
 *        Proxied, both get resized to the width the page actually needs.
 *
 * A manually entered HTTPS CDN that is not on the server allowlist stays
 * direct instead of being sent to a guaranteed 403. This keeps the proxy
 * SSRF-safe.
 */
const PROXY_HOSTS = [
  'kodnextech.com',
  'nexwall.app',
  'nexwallcdn.com',
  'cloudinary.com',
  'anima-image-api.vercel.app',
  'i.ibb.co',
  'ibb.co',
  'wallhaven.cc',
];

/**
 * Cache-busting version for every proxied URL.
 *
 * /api/img answers with `Cache-Control: public, max-age=86400, immutable`, so
 * the CDN keeps whatever it cached for a whole day. Bumping this number changes
 * every /api/img URL at once (it is the ONLY place those URLs are built), which
 * is what actually invalidates stale copies after a deploy.
 *
 * v2 — the proxy started resizing/re-encoding to WebP; old cached entries hold
 *      the original multi-megabyte files.
 * v3 — animated GIFs pass through untouched, and wallhaven.cc moved from DIRECT
 *      to PROXIED. Bumped because success responses are now edge-cached for
 *      30 days (s-maxage), so a transform change must not be masked by an
 *      older cached copy.
 */
export const IMG_PROXY_VERSION = 3;

/** Width (CSS px) the proxy resizes to when a caller does not ask for one. */
export const IMG_DEFAULT_WIDTH = 900;

/** Proxy-side clamp — kept here so callers never emit an out-of-range `w`. */
export const IMG_MIN_WIDTH = 1;
export const IMG_MAX_WIDTH = 2560;

export interface ImgUrlOptions {
  /**
   * Display width in CSS px. Omit for the 900 px default used by every grid,
   * tile and list. Pass a larger value only where the image is shown large
   * (the wallpaper detail preview uses 1440).
   */
  w?: number;
  /**
   * Serve the ORIGINAL upstream bytes — no resize, no re-encode. Used by the
   * download button so a saved file keeps its full source quality instead of
   * becoming a 900 px WebP preview.
   */
  full?: boolean;
}

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function proxySafe(host: string): boolean {
  return PROXY_HOSTS.some((domain) => matches(host, domain));
}

/**
 * Hosts that should always load directly in the browser.
 *
 * Wallhaven used to live here (it hotlinks fine), but its `path` is the full
 * multi-MB original and `thumbs.large` is 1920 px — both far heavier than the
 * box they render into. It now goes through /api/img like every other source.
 */
function directSafe(host: string): boolean {
  return matches(host, 'unsplash.com');
}

/** Clamp a requested width into the range the proxy accepts. */
function clampWidth(w: number): number {
  const n = Math.round(w);
  if (!Number.isFinite(n)) return IMG_DEFAULT_WIDTH;
  return Math.min(IMG_MAX_WIDTH, Math.max(IMG_MIN_WIDTH, n));
}

/**
 * Build the proxied URL. The default width is deliberately NOT written into the
 * query string, so "no width" and "w=900" resolve to one identical (and
 * therefore one cached) URL.
 */
function proxyUrl(target: URL, opts?: ImgUrlOptions): string {
  const params = new URLSearchParams({ u: target.toString(), v: String(IMG_PROXY_VERSION) });
  if (opts?.full) {
    params.set('full', '1');
  } else if (opts?.w !== undefined) {
    const width = clampWidth(opts.w);
    if (width !== IMG_DEFAULT_WIDTH) params.set('w', String(width));
  }
  return `/api/img?${params.toString()}`;
}

export function imgUrl(u: string | null | undefined, opts?: ImgUrlOptions): string {
  if (!u) return '';
  if (u.startsWith('//')) return '';
  if (u.startsWith('/')) return u;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (directSafe(host)) return url.toString();
    return proxySafe(host) ? proxyUrl(url, opts) : url.toString();
  } catch {
    return '';
  }
}
