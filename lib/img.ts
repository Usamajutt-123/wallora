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
 * v4 — pages emit responsive `srcset` candidates (380/760/1440), so the URL
 *      shape a browser can request changed; every tile now gets the width its
 *      render box actually needs instead of a blanket 900 px.
 * v5 — Part B (i.ibb.co → Cloudinary migration) rewrites image URLs in the
 *      catalog; bump invalidates all prior cached copies so browsers fetch
 *      the new Cloudinary-backed URLs. Also strips the Cloudinary transform
 *      segment when ?full=1 so the Download button returns original bytes.
 */
export const IMG_PROXY_VERSION = 5;

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

/** Clamp a requested width into the range the proxy accepts. */
function clampWidth(w: number): number {
  const n = Math.round(w);
  if (!Number.isFinite(n)) return IMG_DEFAULT_WIDTH;
  return Math.min(IMG_MAX_WIDTH, Math.max(IMG_MIN_WIDTH, n));
}

type ImgTarget =
  | { kind: 'none' }
  | { kind: 'direct'; url: string }
  | { kind: 'proxy'; url: URL };

/** Classify a stored URL the same way every imgUrl() call has always done. */
function resolveTarget(u: string | null | undefined): ImgTarget {
  if (!u) return { kind: 'none' };
  if (u.startsWith('//')) return { kind: 'none' };
  if (u.startsWith('/')) return { kind: 'direct', url: u };
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password) return { kind: 'none' };
    const host = url.hostname.toLowerCase();
    if (proxySafe(host)) return { kind: 'proxy', url };
    return { kind: 'direct', url: url.toString() };
  } catch {
    return { kind: 'none' };
  }
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
  const target = resolveTarget(u);
  if (target.kind === 'none') return '';
  if (target.kind === 'direct') return target.url;
  return proxyUrl(target.url, opts);
}

export interface ImgSrcSetOptions {
  /**
   * Candidate render widths in CSS px, ascending. Defaults to the site-wide
   * ladder [380, 760, 1440] — phone tile, tablet/desktop tile, detail page.
   */
  widths?: number[];
  /**
   * CSS `sizes` expression: how wide the render box is at each viewport. The
   * browser multiplies it by device-pixel-ratio and picks the closest
   * candidate, so it MUST match the actual layout (see each call site).
   */
  sizes?: string;
}

export interface ImgSrcSet {
  /** Fallback src — the LARGEST candidate, for clients without srcset support. */
  src: string;
  /** `url 380w, url 760w, url 1440w` — undefined for direct (unproxied) hosts. */
  srcSet?: string;
  /** Pass-through of `options.sizes`; only meaningful together with srcSet. */
  sizes?: string;
  /** Exact candidate URLs, ascending width — for <link rel="preload"> of the mobile size. */
  candidates?: string[];
}

export const IMG_SRCSET_WIDTHS = [380, 760, 1440];

/**
 * Responsive URL set for one wallpaper image.
 *
 * Proxied hosts get a srcset ladder (each entry is a distinct /api/img render,
 * so a 390 px phone downloads the 380 px WebP instead of the 900 px one).
 * Direct hosts (already-sized Unsplash CDN URLs) are returned as-is: the proxy
 * cannot re-render them, and they are cheap by definition.
 */
export function imgSrcSet(u: string | null | undefined, opts: ImgSrcSetOptions = {}): ImgSrcSet {
  const target = resolveTarget(u);
  if (target.kind === 'none') return { src: '' };
  if (target.kind === 'direct') return { src: target.url, sizes: opts.sizes };

  const widths = (opts.widths ?? IMG_SRCSET_WIDTHS).map(clampWidth);
  const candidates = widths.map((w) => proxyUrl(target.url, { w }));
  return {
    src: candidates[candidates.length - 1],
    srcSet: candidates.map((c, i) => `${c} ${widths[i]}w`).join(', '),
    sizes: opts.sizes,
    candidates,
  };
}

/**
 * The exact proxied candidate URL at one width — for `<link rel="preload">`
 * tags that must byte-for-byte match a srcset entry. '' when not proxied
 * (nothing to preload; direct hosts are not served by the proxy).
 */
export function imgCandidate(u: string | null | undefined, w: number): string {
  const target = resolveTarget(u);
  if (target.kind !== 'proxy') return '';
  return proxyUrl(target.url, { w });
}
