import { clientIp } from '@/lib/ip';
import { createWindowLimiter } from '@/lib/rate';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/**
 * sharp is a native (libvips) module — it needs the Node.js runtime and must
 * never be bundled. This route is deliberately NOT on the edge runtime.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Egress throttles (audit v6.1 — finding M3): one warm instance cannot be
 * turned into an unlimited bandwidth pump through freshly crafted URLs.
 * Same-origin/edge caching already absorbs repeats; these caps stop the
 * worst abuse. Keys come from clientIp() so spoofed XFF gets no free pass.
 */
const imgPerMinute = createWindowLimiter({ windowMs: 60_000, max: 300 });
const imgPerDay = createWindowLimiter({ windowMs: 86_400_000, max: 20_000, maxKeys: 100_000 });

/**
 * Display image proxy.
 * Why: the NexWall CDN rate-limits bursts of hotlinked images (hero + featured +
 * category covers all fire at once → HTTP 444). Serving through our own domain
 * means one cached upstream fetch per image, then the CDN cache carries the load.
 *
 * It is also where page weight is controlled. Sources such as i.ibb.co store the
 * ORIGINAL full-size files (1.3 MB – 6.7 MB each); serving those bytes verbatim
 * made a 25-tile page cost ~20 MB on mobile. Every non-trivial image is now
 * resized to the width the caller actually needs and re-encoded as WebP.
 */
const ALLOWED_HOSTS = ['kodnextech.com', 'nexwall.app', 'nexwallcdn.com', 'wallhaven.cc', 'unsplash.com', 'cloudinary.com', 'anima-image-api.vercel.app', 'i.ibb.co', 'ibb.co'];

function allowedTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  );
}

async function fetchAllowed(url: URL, headers: HeadersInit): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(current, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    const next = new URL(location, current);
    await response.body?.cancel().catch(() => {});
    if (!allowedTarget(next)) return new Response(null, { status: 403 });
    current = next;
  }
  return new Response(null, { status: 508 });
}

async function upstream(url: URL, headers: HeadersInit, tries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetchAllowed(url, headers);
      if (response.status !== 444 && response.status !== 429 && response.status < 500) return response;
      await response.body?.cancel().catch(() => {});
      last = new Response(null, { status: response.status });
    } catch {
      /* retry */
    }
    if (i < tries - 1) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
  }
  return last ?? new Response(null, { status: 502 });
}

const MAX_IMAGE_BYTES = 26_000_000;
const SAFE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

async function readImageLimited(response: Response): Promise<ArrayBuffer> {
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer as ArrayBuffer;
}

/* ------------------------------- transform -------------------------------- */

/** Default display width — grids, tiles and lists all render at or below this. */
const DEFAULT_WIDTH = 900;
const MIN_WIDTH = 1;
const MAX_WIDTH = 2560;
const WEBP_QUALITY = 80;

/**
 * Below this the transform cannot pay for itself: a small source file is
 * already cheap, and re-encoding would only spend CPU (and can even grow it).
 */
const PASSTHROUGH_BYTES = 150 * 1024;

/** Cloudinary URLs arrive pre-optimised (`c_limit,w_900,f_auto,q_auto`). */
const PRE_OPTIMISED_HOST = 'res.cloudinary.com';

/**
 * Animated GIFs must never reach sharp: a resize/re-encode keeps only the FIRST
 * frame, silently turning an animated wallpaper into a still one.
 */
const ANIMATED_TYPE = 'image/gif';

/** `?w=` → an integer inside [MIN_WIDTH, MAX_WIDTH]; anything odd is the default. */
function parseWidth(raw: string | null): number {
  if (raw === null) return DEFAULT_WIDTH;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

/** Successes are cached hard; every failure must never be cached by the CDN. */
// Safe to cache for 30 days at the edge because every proxied URL carries a
// version param (IMG_PROXY_VERSION in lib/img.ts) — any change to how the proxy
// renders an image bumps the version, so a stale copy can never be re-served.
const SUCCESS_CACHE = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400, immutable';
const ERROR_CACHE = 'no-store';

/**
 * BodyInit-safe view of a Buffer. `NextResponse` will not accept Node's
 * `Buffer<ArrayBufferLike>` directly, so hand it the underlying ArrayBuffer —
 * without an extra copy when the Buffer already spans the whole allocation.
 */
function bodyOf(buf: Buffer): ArrayBuffer {
  const ab = buf.buffer as ArrayBuffer;
  return buf.byteOffset === 0 && buf.byteLength === ab.byteLength
    ? ab
    : ab.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Plain-text error reply that no proxy/CDN is allowed to keep. */
function errorResponse(body: string, status: number, extra?: Record<string, string>): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Cache-Control': ERROR_CACHE, ...extra },
  });
}

function imageResponse(bytes: Buffer, contentType: string, host: string): NextResponse {
  return new NextResponse(bodyOf(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': SUCCESS_CACHE,
      'X-Source-Host': host,
    },
  });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u');
  if (!raw) return errorResponse('missing u', 400);
  if (raw.length > 4096) return errorResponse('url too long', 414);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return errorResponse('bad url', 400);
  }
  const host = target.hostname.toLowerCase();
  if (!allowedTarget(target)) return errorResponse('host not allowed', 403);

  // per-client egress throttle
  const ipKey = clientIp(req);
  if (!imgPerMinute.allow(ipKey) || !imgPerDay.allow(ipKey)) {
    return errorResponse('too many image requests — slow down', 429, { 'Retry-After': '60' });
  }

  // look like a first-party request to the source CDN
  const res = await upstream(target, {
    Referer: `https://${host}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
  });

  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    return errorResponse(`upstream ${res.status}`, 502);
  }

  // Egress tripwire — enforce the limit even when upstream omits Content-Length.
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    await res.body.cancel().catch(() => {});
    return errorResponse('too large', 413);
  }

  const type = (res.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!SAFE_IMAGE_TYPES.has(type)) {
    await res.body.cancel().catch(() => {});
    return errorResponse('unsupported image type', 502);
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await readImageLimited(res);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'too_large';
    return errorResponse(tooLarge ? 'too large' : 'upstream read failed', tooLarge ? 413 : 502);
  }

  const source = Buffer.from(bytes);
  const width = parseWidth(req.nextUrl.searchParams.get('w'));
  // `full=1` keeps the original bytes — the download button uses it so saved
  // files are full quality rather than a resized WebP preview.
  const wantOriginal = req.nextUrl.searchParams.get('full') === '1';

  if (
    wantOriginal ||
    host === PRE_OPTIMISED_HOST ||
    type === ANIMATED_TYPE ||
    source.byteLength < PASSTHROUGH_BYTES
  ) {
    return imageResponse(source, type, host);
  }

  try {
    const webp = await sharp(source)
      .rotate() // honour EXIF orientation before resizing
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return imageResponse(webp, 'image/webp', host);
  } catch {
    // Corrupt / unsupported input: send the original bytes through untouched.
    // A bad upstream image must never turn into a 500 for the visitor.
    return imageResponse(source, type, host);
  }
}
