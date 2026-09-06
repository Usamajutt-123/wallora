/**
 * WALLORA — server-side image mirror helper.
 *
 * Cloudinary is the permanent mirror when it is configured. ImgBB remains a
 * legacy fallback for deployments that have no Cloudinary credentials at all.
 * Auto-mirroring is best-effort: a failed mirror never fails a sync run.
 *
 * Env:
 *   CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY +
 *     CLOUDINARY_API_SECRET → preferred permanent mirror
 *   IMGBB_API_KEY           → legacy fallback when Cloudinary is absent
 *   WALLORA_IMGBB_AUTO_MIRROR=0 → disable auto-mirroring
 *   WALLORA_IMGBB_PER_RUN=n     → max mirrors per run (default 10)
 *
 * Cloudinary's free plan caps each upload at 10 MB. Source images above that
 * size are converted with sharp to a max-2560px JPEG at quality 88 first (with
 * conservative fallback reductions if a particularly detailed image is still
 * over the cap).
 */

import crypto from 'node:crypto';
import sharp from 'sharp';
import { getServiceSupabase } from './supabase';

const imgbbApiKey = () => (process.env.IMGBB_API_KEY || '').trim();
const CLOUDINARY_MAX_BYTES = 10_000_000;
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
const IMGBB_MAX_BYTES = 28 * 1024 * 1024;
const BLOCKED_CLOUD_NAME = 'djfvizjdh';
const SAFE_PUBLIC_ID_PART = /^[A-Za-z0-9_-]{1,100}$/;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const ALLOWED_DOMAINS = [
  'kodnextech.com',
  'nexwall.app',
  'nexwallcdn.com',
  'cloudinary.com',
  'anima-image-api.vercel.app',
  'wallhaven.cc',
];

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Read credentials without a project-specific cloud default. */
function cloudinaryCreds(): { cloudName: string; key: string; secret: string } | null {
  let fromUrl: { cloudName: string; key: string; secret: string } | null = null;
  const raw = (process.env.CLOUDINARY_URL || '').trim();
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'cloudinary:') {
        fromUrl = {
          cloudName: parsed.hostname,
          key: decodeCredential(parsed.username),
          secret: decodeCredential(parsed.password),
        };
      }
    } catch {
      // Explicit CLOUDINARY_* variables can still provide the configuration.
    }
  }

  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloudName || '').trim();
  const key = (process.env.CLOUDINARY_API_KEY || fromUrl?.key || '').trim();
  const secret = (process.env.CLOUDINARY_API_SECRET || fromUrl?.secret || '').trim();
  if (!cloudName || !key || !secret || !/^[A-Za-z0-9_-]{1,64}$/.test(cloudName)) return null;
  // djfvizjdh is a third-party provider cloud, never an upload destination.
  if (cloudName.toLowerCase() === BLOCKED_CLOUD_NAME) return null;
  return { cloudName, key, secret };
}

export const cloudinaryConfigured = () => Boolean(cloudinaryCreds());
export const imgbbConfigured = () => Boolean(imgbbApiKey());
export const mirrorConfigured = () => cloudinaryConfigured() || imgbbConfigured();

const autoMirrorEnabled = () =>
  String(process.env.WALLORA_IMGBB_AUTO_MIRROR ?? '1') !== '0' && mirrorConfigured();
const perRun = () => Math.min(20, Math.max(0, Math.floor(Number(process.env.WALLORA_IMGBB_PER_RUN) || 10)));

function trustedImageUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    const host = url.hostname.toLowerCase();
    if (host === 'i.ibb.co' || host === 'ibb.co') return null; // already a legacy mirror
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
    if (declared > MAX_DOWNLOAD_BYTES) throw new Error('image too large');
    if (!res.body) throw new Error('empty response body');

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('image too large');
      }
      chunks.push(Buffer.from(value));
    }
    return { buffer: Buffer.concat(chunks), type };
  }
  throw new Error('too many redirects');
}

function syncPublicId(source: string, sourceId: string): string {
  if (!SAFE_PUBLIC_ID_PART.test(source) || !SAFE_PUBLIC_ID_PART.test(sourceId)) {
    throw new Error('invalid source or source_id for Cloudinary public_id');
  }
  return `wallora/sync/${source}/${sourceId}`;
}

async function prepareCloudinaryBuffer(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; type: string }> {
  if (buffer.length <= CLOUDINARY_MAX_BYTES) return { buffer, type: contentType };
  const attempts: [number, number][] = [
    [2560, 88],
    [2560, 80],
    [2304, 80],
    [2048, 76],
    [1792, 72],
    [1536, 68],
  ];
  for (const [width, quality] of attempts) {
    const resized = await sharp(buffer)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (resized.length <= CLOUDINARY_MAX_BYTES) return { buffer: resized, type: 'image/jpeg' };
  }
  throw new Error('image remains over Cloudinary’s 10 MB upload cap after resizing');
}

async function uploadToCloudinary(buffer: Buffer, type: string, source: string, sourceId: string): Promise<string> {
  const creds = cloudinaryCreds();
  if (!creds) throw new Error('Cloudinary mirror credentials are not configured');
  const publicId = syncPublicId(source, sourceId);
  const prepared = await prepareCloudinaryBuffer(buffer, type);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${creds.secret}`)
    .digest('hex');
  const form = new URLSearchParams();
  form.set('file', `data:${prepared.type};base64,${prepared.buffer.toString('base64')}`);
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('resource_type', 'image');
  form.set('timestamp', timestamp);
  form.set('api_key', creds.key);
  form.set('signature', signature);

  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error('Cloudinary is unreachable right now');
  }
  const json = (await response.json().catch(() => null)) as { public_id?: string; error?: { message?: string } } | null;
  if (!response.ok || !json?.public_id) {
    throw new Error(`Cloudinary HTTP ${response.status}${json?.error?.message ? `: ${json.error.message}` : ''}`);
  }
  if (String(json.public_id) !== publicId) throw new Error('Cloudinary returned an unexpected public_id');
  return `https://res.cloudinary.com/${creds.cloudName}/image/upload/c_limit,w_900,f_auto,q_auto/${publicId}`;
}

async function uploadToImgBB(buffer: Buffer, name: string): Promise<string> {
  const key = imgbbApiKey();
  if (!key) throw new Error('IMGBB_API_KEY missing');
  if (buffer.length > IMGBB_MAX_BYTES) throw new Error('image too large for ImgBB fallback');
  const form = new FormData();
  form.append('image', buffer.toString('base64'));
  form.append('name', `wallora-${name}`.slice(0, 60));
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as {
    status_code?: number;
    data?: { url?: string };
  } | null;
  if (!res.ok || !json?.data?.url) {
    const code = json?.status_code ?? res.status;
    const msg = code === 103 ? 'ImgBB forbidden this network/IP' : `ImgBB HTTP ${code}`;
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
 * Mirror a bounded list of freshly published wallpaper rows and store the
 * returned URL in mirror_url. Cloudinary is selected whenever configured; it
 * never silently falls through to ImgBB after a Cloudinary failure.
 */
export async function mirrorWallsToImgBB(
  walls: { source?: string; source_id?: string; image_url?: string }[],
): Promise<MirrorSummary> {
  const summary: MirrorSummary = { tried: 0, ok: 0, failed: 0, note: 'mirror_disabled' };
  const sb = getServiceSupabase();
  if (!autoMirrorEnabled() || !sb) return summary;
  const budget = perRun();
  if (!Array.isArray(walls) || !walls.length || budget <= 0) {
    summary.note = 'nothing_to_mirror';
    return summary;
  }

  const useCloudinary = cloudinaryConfigured();
  const backend = useCloudinary ? 'Cloudinary' : 'ImgBB';
  const targets = walls
    .filter(
      (w) =>
        w.source &&
        w.source_id &&
        /^(?:nexwall|animepixels|wallhaven|manual)$/.test(w.source) &&
        SAFE_PUBLIC_ID_PART.test(w.source_id) &&
        trustedImageUrl(w.image_url),
    )
    .slice(0, budget);

  summary.tried = targets.length;
  if (!targets.length) {
    summary.note = 'no_mirrorable_rows';
    return summary;
  }

  const mirrorNotes: string[] = [];
  for (const w of targets) {
    const label = `${w.source}:${w.source_id}`;
    try {
      const sourceUrl = trustedImageUrl(w.image_url)!;
      const { buffer, type } = await downloadImage(sourceUrl);
      const mirror = useCloudinary
        ? await uploadToCloudinary(buffer, type, w.source!, w.source_id!)
        : await uploadToImgBB(buffer, `${w.source}-${w.source_id}`.slice(0, 60));
      const { error } = await sb
        .from('wallpapers')
        .update({ mirror_url: mirror })
        .eq('source', w.source)
        .eq('source_id', w.source_id);
      if (error) throw new Error(`db update: ${error.message}`);
      summary.ok++;
    } catch (e) {
      summary.failed++;
      mirrorNotes.push(`${label}: ${e instanceof Error ? e.message.slice(0, 90) : 'unknown'}`);
    }
  }

  summary.note = mirrorNotes.length
    ? `mirrored ${summary.ok}, ${summary.failed} failed (${mirrorNotes.slice(0, 2).join('; ')})`
    : `mirrored ${summary.ok} wallpaper${summary.ok === 1 ? '' : 's'} to ${backend}`;
  return summary;
}
