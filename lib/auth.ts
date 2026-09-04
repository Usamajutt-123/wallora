import 'server-only';
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'crypto';

export const ADMIN_COOKIE = 'wallora_admin';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Supabase deployments sign sessions with the high-entropy service key even if
// a legacy ADMIN_PASSWORD is still present. The known development fallback is
// never accepted in production.
const configuredAdminPassword = () => {
  const value = process.env.ADMIN_PASSWORD || '';
  return value && (process.env.NODE_ENV !== 'production' || value.length >= 12) ? value : '';
};
const configuredServiceKey = () => {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return value && (process.env.NODE_ENV !== 'production' || value.length >= 32) ? value : '';
};
const configuredSecret = () => configuredServiceKey() || configuredAdminPassword();
const secret = () => configuredSecret() || 'wallora-admin';
const secureAuthConfigured = () => Boolean(configuredSecret()) || process.env.NODE_ENV !== 'production';
export const usingDefaultPassword = () => !configuredSecret();
const urlTokenFallbackAllowed = () =>
  process.env.NODE_ENV !== 'production' || process.env.ADMIN_URL_TOKEN_FALLBACK === '1';
/** True when the ?sk= token-in-URL mode is switched on (see M2). */
export const urlTokenFallbackActive = () => urlTokenFallbackAllowed() && process.env.ADMIN_URL_TOKEN_FALLBACK === '1';

export function checkPassword(pw: string): boolean {
  const expected = configuredAdminPassword() || (process.env.NODE_ENV !== 'production' ? 'wallora-admin' : '');
  if (!expected || !pw || pw.length > 256) return false;
  const a = Buffer.from(pw);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── Supabase-backed admin accounts ─────────────────────────────
   pass_hash format: "<salt_hex>:<scrypt_hex>" — same in scripts/create-admin.js */
export function hashPassword(pw: string, salt?: string): string {
  if (pw.length < 12 || pw.length > 256) throw new Error('Password must contain 12-256 characters.');
  const s = salt ?? randomBytes(16).toString('hex');
  if (!/^[0-9a-f]{32}$/.test(s)) throw new Error('Invalid password salt.');
  return `${s}:${scryptSync(pw, s, 32).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  if (!pw || pw.length > 256 || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(String(stored))) return false;
  const [s, h] = String(stored).split(':');
  const cand = scryptSync(pw, s, 32);
  const ref = Buffer.from(h, 'hex');
  return cand.length === ref.length && timingSafeEqual(cand, ref);
}

/** Check username+password against service-only admin_users.
 *  Once Supabase service credentials exist, DB admins are authoritative: a
 *  missing table, unknown user or network error never falls back to env login. */
export async function verifyAdminUser(username: string, pw: string): Promise<boolean | null> {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = configuredServiceKey();
  if (!rawUrl || !key) return null;
  if (!username || username.length > 80 || !pw || pw.length > 256) return false;
  try {
    const endpoint = new URL(rawUrl);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return false;
    const restUrl = new URL('/rest/v1/admin_users', endpoint);
    restUrl.searchParams.set('select', 'pass_hash');
    restUrl.searchParams.set('username', `eq.${username}`);
    restUrl.searchParams.set('limit', '1');
    const res = await fetch(
      restUrl,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as { pass_hash?: string }[];
    return Boolean(rows[0]?.pass_hash && verifyPassword(pw, rows[0].pass_hash));
  } catch {
    return false;
  }
}

export function createToken(): string {
  if (!secureAuthConfigured()) throw new Error('Admin authentication is not configured.');
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret()).update(ts).digest('hex');
  return `${ts}.${sig}`;
}

export function verifyToken(token?: string | null): boolean {
  if (!secureAuthConfigured() || !token || !/^\d{13}\.[0-9a-f]{64}$/.test(token)) return false;
  const [ts, sig] = token.split('.');
  const expect = createHmac('sha256', secret()).update(ts).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age < TOKEN_TTL_MS;
}

/**
 * Admin gate with COOKIE-LESS fallback — the embedded preview iframe can drop
 * cookies; in that case pages authenticate via ?sk=<token> instead.
 * Call at the top of every admin page:  requireAdmin(searchParams)
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function requireAdmin(searchParams?: { sk?: string }): Promise<{ sk: string | null }> {
  const cookieToken = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (verifyToken(cookieToken)) return { sk: null }; // normal path — cookie session
  const sk = searchParams?.sk ?? null;
  if (urlTokenFallbackAllowed() && sk && verifyToken(sk)) return { sk }; // explicit iframe fallback
  redirect('/admin/login');
}

/** Same dual-check for admin API routes. */
export function adminApiOk(cookieToken: string | undefined | null, url: string): boolean {
  if (verifyToken(cookieToken)) return true;
  try {
    if (!urlTokenFallbackAllowed()) return false;
    const sk = new URL(url).searchParams.get('sk');
    return Boolean(sk && verifyToken(sk));
  } catch {
    return false;
  }
}
