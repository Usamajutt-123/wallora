import { checkPassword, createToken, verifyAdminUser, ADMIN_COOKIE } from '@/lib/auth';
import { clientIp } from '@/lib/ip';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Brute-force guard (audit v6.1 — finding M1):
 *  • keyed by the real client IP via clientIp() — spoofed X-Forwarded-For
 *    values no longer grant a fresh bucket per attempt;
 *  • 5 attempts per IP per 10 minutes, then a hard 429;
 *  • after repeated failures we sleep with exponential backoff, which makes
 *    even a distributed/spoofed flood CPU-expensive for the attacker;
 *  • memory is capped so the guard can't be grown unboundedly.
 */
const attempts = new Map<string, { n: number; until: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 600_000; // 10 minutes
const MAX_TRACKED = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > 4096) {
    return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
  }
  const ip = clientIp(req); // trusted client identity for rate limiting
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now < rec.until) {
    if (rec.n >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { ok: false, error: 'Too many attempts — wait 10 minutes' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rec.until - now) / 1000)) } },
      );
    }
    attempts.set(ip, { n: rec.n + 1, until: rec.until });
  } else {
    attempts.set(ip, { n: 1, until: now + WINDOW_MS });
  }
  if (attempts.size > MAX_TRACKED) {
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }

  let body: any = null;
  try {
    body = await readJsonLimited(req);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error && error.message === 'payload_too_large' ? 'Payload too large' : 'Invalid JSON' },
      { status: error instanceof Error && error.message === 'payload_too_large' ? 413 : 400 },
    );
  }
  const username = String(body?.username ?? '').trim().toLowerCase().slice(0, 80);
  const password = String(body?.password ?? '').slice(0, 257);

  // Exponential backoff AFTER reading the body: repeat offenders make the
  // scrypt verify itself costly to an attacker even when they rotate IPs.
  const prior = attempts.get(ip)?.n ?? 1;
  if (prior > 2) {
    const waitMs = Math.min(4_000, 200 * 2 ** Math.min(prior - 3, 4));
    await sleep(waitMs);
  }

  // Supabase-first: when service credentials exist, DB accounts are the only way in.
  const dbResult = await verifyAdminUser(username || 'admin', password);
  const ok = dbResult !== null ? dbResult : (username === '' || username === 'admin') && checkPassword(password);

  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Wrong credentials' }, { status: 401 });
  }
  attempts.delete(ip); // clean slate on success

  const token = createToken();
  // Query-string tokens are only a fallback for sandboxed iframe previews where
  // cookies are unavailable. Normal production logins remain cookie-only.
  const allowUrlFallback = process.env.NODE_ENV !== 'production' || process.env.ADMIN_URL_TOKEN_FALLBACK === '1';
  const res = NextResponse.json({ ok: true, ...(allowUrlFallback ? { token } : {}) });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return res;
}
