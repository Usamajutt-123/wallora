import { trackEvent } from '@/lib/db';
import { clientIp } from '@/lib/ip';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ── anti-spoof: 1 event per (id+type) per IP per 10 min, and max 60 events/min/IP ──
// Keyed by clientIp() (audit v6.1 — finding M1): a spoofed X-Forwarded-For
// header no longer creates a fresh identity for every request.
const seen = new Map<string, number>();
const burst = new Map<string, { count: number; windowStart: number }>();
const IP = (req: NextRequest) => clientIp(req);
function trimOldest<T>(map: Map<string, T>, max: number) {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

async function readJsonLimited(req: NextRequest, maxBytes = 4096): Promise<any> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('payload_too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

export async function POST(req: NextRequest) {
  try {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > 4096) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    const body = await readJsonLimited(req);
    const id = String(body?.id ?? '');
    const type = body?.type;
    // strict shape check — blocks garbage/spoofed ids
    if (!/^(?:nexwall|animepixels|wallhaven|manual|demo):[A-Za-z0-9_-]{1,100}$/.test(id) || (type !== 'view' && type !== 'download')) {
      return NextResponse.json({ ok: false, error: 'bad payload' }, { status: 400 });
    }

    const ip = IP(req);
    const now = Date.now();
    const b = burst.get(ip);
    if (b && now - b.windowStart < 60_000 && b.count >= 60) {
      return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
    }
    burst.set(ip, b && now - b.windowStart < 60_000 ? { count: b.count + 1, windowStart: b.windowStart } : { count: 1, windowStart: now });
    trimOldest(burst, 20_000);

    const k = `${ip}|${id}|${type}`;
    if (seen.has(k) && now - seen.get(k)! < 600_000) {
      return NextResponse.json({ ok: true, deduped: true }); // silent no-op
    }
    const tracked = await trackEvent(id, type);
    if (!tracked) return NextResponse.json({ ok: false, error: 'wallpaper_not_found' }, { status: 404 });
    seen.set(k, now);
    trimOldest(seen, 20_000); // memory guard without resetting every visitor's dedupe state
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'payload_too_large') {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
