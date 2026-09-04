import { clientIp } from '@/lib/ip';
import { createWindowLimiter } from '@/lib/rate';
import { NextRequest, NextResponse } from 'next/server';

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

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u');
  if (!raw) return new NextResponse('missing u', { status: 400 });
  if (raw.length > 4096) return new NextResponse('url too long', { status: 414 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse('bad url', { status: 400 });
  }
  const host = target.hostname.toLowerCase();
  if (!allowedTarget(target)) return new NextResponse('host not allowed', { status: 403 });

  // per-client egress throttle
  const ipKey = clientIp(req);
  if (!imgPerMinute.allow(ipKey) || !imgPerDay.allow(ipKey)) {
    return new NextResponse('too many image requests — slow down', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  // look like a first-party request to the source CDN
  const res = await upstream(target, {
    Referer: `https://${host}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
  });

  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    return new NextResponse(`upstream ${res.status}`, { status: 502 });
  }

  // Egress tripwire — enforce the limit even when upstream omits Content-Length.
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    await res.body.cancel().catch(() => {});
    return new NextResponse('too large', { status: 413 });
  }

  const type = (res.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!SAFE_IMAGE_TYPES.has(type)) {
    await res.body.cancel().catch(() => {});
    return new NextResponse('unsupported image type', { status: 502 });
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await readImageLimited(res);
  } catch (error) {
    return new NextResponse(error instanceof Error && error.message === 'too_large' ? 'too large' : 'upstream read failed', {
      status: error instanceof Error && error.message === 'too_large' ? 413 : 502,
    });
  }

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': type,
      // browser 1 day · edge/CDN 30 days · regenerate quietly after
      'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400, immutable',
      'X-Source-Host': host,
    },
  });
}
