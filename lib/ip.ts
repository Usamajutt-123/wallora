import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * WALLORA hardening (audit v6.1, finding M1): CLIENT IP for rate limiting,
 * chosen so a spoofed `x-forwarded-for` cannot silently grant a fresh bucket
 * per request.
 *
 * Resolution order:
 * 1. `x-vercel-forwarded-for` — Vercel sets this to the true client IP and
 *    it cannot be spoofed through the platform edge. (Next.js 16 removed the
 *    old `NextRequest.ip` helper, so we read the canonical header directly.)
 * 2. `x-forwarded-for`:
 *    – default mode (Vercel / dev): the platform replaces this header with
 *      the client address, so the value is trusted as-is.
 *    – self-hosted behind a real reverse proxy (nginx, caddy, …) that
 *      APPENDS entries: the proxy adds the true client on the RIGHT, so set
 *      WALLORA_TRUST_PROXY=1 to take the right-most value (the left-most is
 *      user-controllable and must never be trusted in this topology).
 * 3. `x-real-ip` (nginx-style) as a last fallback.
 * 4. Nothing available → "unknown", so such clients share ONE aggregate
 *    bucket instead of getting unlimited identities.
 *
 * Deployment note: a bare origin with NO proxy in front cannot distinguish a
 * real client IP from header noise — put it behind a proxy (which also
 * enables HSTS/compression) or rely on this guard only as defense-in-depth.
 */
export function clientIp(req: NextRequest): string {
  const platformIp = req.headers.get('x-vercel-forwarded-for');
  if (platformIp) {
    const first = platformIp.split(',')[0].trim();
    if (first) return first.slice(0, 100);
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) {
      const pick = process.env.WALLORA_TRUST_PROXY === '1' ? parts[parts.length - 1] : parts[0];
      if (pick) return pick.slice(0, 100);
    }
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim().slice(0, 100);
  return 'unknown';
}
