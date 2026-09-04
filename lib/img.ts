/**
 * Wallpaper URL → display URL.
 *
 * Two kinds of hosts:
 *  • DIRECT  — the CDN allows browser hotlinking with no referer check, so we
 *    load straight from it (fast, reliable, no server hop). Unsplash and
 *    Wallhaven (w.wallhaven.cc / th.wallhaven.cc) are hotlink-friendly and
 *    verified to return 200 without headers.
 *  • PROXIED — hosts that rate-limit or block hotlink bursts (e.g. NexWall
 *    CDN returns HTTP 444). Those go through our hardened /api/img proxy so
 *    one cached upstream fetch serves everyone.
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
];

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function proxySafe(host: string): boolean {
  return PROXY_HOSTS.some((domain) => matches(host, domain));
}

/** Hotlink-friendly CDNs that should always load directly in the browser. */
function directSafe(host: string): boolean {
  return matches(host, 'unsplash.com') || matches(host, 'wallhaven.cc');
}

export function imgUrl(u: string | null | undefined): string {
  if (!u) return '';
  if (u.startsWith('//')) return '';
  if (u.startsWith('/')) return u;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (directSafe(host)) return url.toString();
    return proxySafe(host) ? `/api/img?u=${encodeURIComponent(url.toString())}` : url.toString();
  } catch {
    return '';
  }
}
