/**
 * WALLORA — server-side ImgBB mirror helper.
 *
 * Why: source CDNs (NexWall/Wallhaven/…) sometimes rate-limit or drop a
 * wallpaper image, which makes that image blank on the site. Once a wallpaper
 * has a mirror_url on ImgBB the whole app prefers the mirror, so the site
 * keeps showing wallpapers even when the original source is down.
 *
 * Auto-mirroring runs at the END of each bounded publish pass (daily-drip
 * cron + manual admin sync). It is strictly best-effort:
 *   • needs IMGBB_API_KEY (skip silently without it),
 *   • small per-run budget so it never blows a function time limit,
 *   • never throws — any failure is logged in the run log and the run still
 *     succeeds, so a mirror problem can never take the site down.
 *
 * Env:
 *   IMGBB_API_KEY                (required to mirror)
 *   WALLORA_IMGBB_AUTO_MIRROR=0  → disable auto-mirroring
 *   WALLORA_IMGBB_PER_RUN=n      → max mirrors per run (default 4)
 *
 * NOTE ON BLOCKED NETWORKS: ImgBB returns code 103 "forbidden" from some
 * home/ISP networks and blocks VPN/datacenter ranges inconsistently. The
 * mirror call therefore succeeds most reliably from the region the site is
 * DEPLOYED in (e.g. Vercel US). A blocked local run just logs "skipped" —
 * it never breaks the wallpaper sync itself.
 */

import { getServiceSupabase } from './supabase';

const apiKey = () => (process.env.IMGBB_API_KEY || '').trim();
export const imgbbConfigured = () => Boolean(apiKey());
const autoMirrorEnabled = () =>
  imgbbConfigured() && String(process.env.WALLORA_IMGBB_AUTO_MIRROR ?? '1') !== '0';
const perRun = () => Math.min(20, Math.max(0, Math.floor(Number(process.env.WALLORA_IMGBB_PER_RUN) || 10)));

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const MAX_BYTES = 28 * 1024 * 1024; // ImgBB free limit is ~32 MB; stay safe
const ALLOWED_DOMAINS = [
  'kodnextech.com',
  'nexwall.app',
  'nexwallcdn.com',
  'cloudinary.com',
  'anima-image-api.vercel.app',
  'wallhaven.cc',
];

function trustedImageUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    const host = url.hostname.toLowerCase();
    if (host === 'i.ibb.co' || host === 'ibb.co') return null; // already a mirror
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; type: string }> {
  let current: URL = new URL(url);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const res = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WALLORA mirror)', Accept: 'image/*,*/*;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect without target (${res.status})`);
      await res.body?.cancel().catch(() => {});
      const next = new URL(location, current);
      const allowed = trustedImageUrl(next.toString());
      if (!allowed) throw new Error('untrusted redirect target');
      current = next;
      continue;
    }
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw new Error(`unsupported type: ${type || 'missing'}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error('image too large');
    const reader = res.body!.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('image too large');
      }
      chunks.push(Buffer.from(value));
    }
    return { buffer: Buffer.concat(chunks), type };
  }
  throw new Error('too many redirects');
}

async function uploadToImgBB(buffer: Buffer, name: string): Promise<string> {
  const form = new FormData();
  form.append('image', buffer.toString('base64'));
  form.append('name', `wallora-${name}`);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey()!)}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as {
    status_code?: number;
    data?: { url?: string; display_url?: string };
  } | null;
  if (!res.ok || !json?.data?.url) {
    const code = json?.status_code ?? res.status;
    const msg = code === 103 ? 'ImgBB forbidden this network/IP (run from deployment region)' : `ImgBB HTTP ${code ?? res.status}`;
    throw new Error(msg);
  }
  return json.data.url;
}

export interface MirrorSummary {
  tried: number;
  ok: number;
  failed: number;
  note: string;
}

/**
 * Mirror a bounded list of freshly published wallpaper rows to ImgBB and store
 * the returned URL in the row's mirror_url (the app already prefers mirrors).
 * Best-effort: throws only when the input is unusable; per-image errors are
 * counted and skipped.
 */
export async function mirrorWallsToImgBB(
  walls: { source?: string; source_id?: string; image_url?: string }[],
): Promise<MirrorSummary> {
  const summary: MirrorSummary = { tried: 0, ok: 0, failed: 0, note: 'imgbb_disabled' };
  const sb = getServiceSupabase();
  if (!autoMirrorEnabled() || !sb) return summary;
  const budget = perRun();
  if (!Array.isArray(walls) || !walls.length || budget <= 0) {
    summary.note = 'nothing_to_mirror';
    return summary;
  }

  const targets = walls
    .filter(
      (w) =>
        w.source &&
        w.source_id &&
        /^(?:nexwall|animepixels|wallhaven|manual)$/.test(w.source) &&
        /^[A-Za-z0-9_-]{1,100}$/.test(w.source_id) &&
        trustedImageUrl(w.image_url),
    )
    .slice(0, budget);

  summary.tried = targets.length;
  if (!targets.length) {
    summary.note = 'no_mirrorable_rows';
    return summary;
  }

  let mirrorNotes: string[] = [];
  for (const w of targets) {
    const label = `${w.source}:${w.source_id}`;
    try {
      const url = trustedImageUrl(w.image_url)!;
      const { buffer } = await downloadImage(url);
      const mirror = await uploadToImgBB(buffer, `${w.source}-${w.source_id}`.slice(0, 60));
      const { error } = await sb.from('wallpapers').update({ mirror_url: mirror }).eq('source', w.source).eq('source_id', w.source_id);
      if (error) {
        throw new Error(`db update: ${error.message}`);
      }
      summary.ok++;
    } catch (e) {
      summary.failed++;
      mirrorNotes.push(`${label}: ${e instanceof Error ? e.message.slice(0, 90) : 'unknown'}`);
    }
  }

  summary.note = mirrorNotes.length
    ? `mirrored ${summary.ok}, ${summary.failed} failed (${mirrorNotes.slice(0, 2).join('; ')})`
    : `mirrored ${summary.ok} wallpaper${summary.ok === 1 ? '' : 's'} to ImgBB`;
  return summary;
}
