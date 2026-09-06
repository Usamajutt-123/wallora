import crypto from 'node:crypto';
import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_BYTES = 12 * 1024 * 1024;

/* Tiny dimension sniffers — enough to auto-fill the wallpaper resolution. */

function pngSize(buf: Buffer): [number, number] | null {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function gifSize(buf: Buffer): [number, number] | null {
  if (buf.length < 10 || !['GIF87a', 'GIF89a'].includes(buf.toString('ascii', 0, 6))) return null;
  return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
}

function jpegSize(buf: Buffer): [number, number] | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return [width, height];
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer): [number, number] | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fmt = buf.toString('ascii', 12, 16);
  if (fmt === 'VP8X' && buf.length >= 30) {
    const w = 1 + buf.readUIntLE(24, 3);
    const h = 1 + buf.readUIntLE(27, 3);
    return [w, h];
  }
  if (fmt === 'VP8 ' && buf.length >= 30) {
    return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  if (fmt === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  return null;
}

function dimensionsOf(type: string, buf: Buffer): { width: number | null; height: number | null } {
  let size: [number, number] | null = null;
  if (type === 'image/png') size = pngSize(buf);
  else if (type === 'image/gif') size = gifSize(buf);
  else if (type === 'image/jpeg') size = jpegSize(buf);
  else if (type === 'image/webp') size = webpSize(buf);
  if (size) {
    const [w, h] = size;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && w <= 20000 && h > 0 && h <= 20000) {
      return { width: w, height: h };
    }
  }
  return { width: null, height: null };
}

// ---- Cloudinary upload (preferred when configured) ------------------------

function cloudinaryCreds(): { cloudName: string; key: string; secret: string } | null {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || 'djfvizjdh').trim();
  let key = (process.env.CLOUDINARY_API_KEY || '').trim();
  let secret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  if (process.env.CLOUDINARY_URL) {
    const m = process.env.CLOUDINARY_URL.match(/^cloudinary:\/\/(\d+):([^@]+)@([\w-]+)/);
    if (m) {
      key ||= m[1];
      secret ||= m[2];
      // favour explicit CLOUDINARY_CLOUD_NAME if user set it, else parse from URL
      if (!process.env.CLOUDINARY_CLOUD_NAME) return { cloudName: m[3], key, secret };
    }
  }
  if (!key || !secret) return null;
  return { cloudName, key, secret };
}

async function uploadToCloudinary(buf: Buffer, type: string): Promise<{ url: string; displayUrl: string } | null> {
  const creds = cloudinaryCreds();
  if (!creds) return null;
  const publicId = `wallora/uploads/wallora-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${creds.secret}`)
    .digest('hex');
  const form = new URLSearchParams();
  form.set('file', `data:${type || 'image/jpeg'};base64,${buf.toString('base64')}`);
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
    throw new Error('Cloudinary is unreachable right now.');
  }
  const json = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    public_id?: string;
  } | null;
  if (!response.ok || !json?.public_id) {
    throw new Error(`Cloudinary upload failed (${response.status} ${json?.error?.message || ''}).`);
  }
  const base = `https://res.cloudinary.com/${creds.cloudName}/image/upload`;
  const displayUrl = `${base}/c_limit,w_900,f_auto,q_auto/${json.public_id}`;
  const fullUrl = `${base}/${json.public_id}`;
  return { url: fullUrl, displayUrl };
}

// ---- ImgBB upload (legacy fallback) ---------------------------------------

async function uploadToImgBB(buf: Buffer): Promise<{ url: string; displayUrl: string } | null> {
  const key = (process.env.IMGBB_API_KEY || '').trim();
  if (!key) return null;
  const form = new FormData();
  form.append('image', buf.toString('base64'));
  form.append('name', `wallora-upload-${Date.now().toString(36)}`.slice(0, 60));
  let response: Response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('ImgBB is unreachable right now.');
  }
  const json = (await response.json().catch(() => null)) as {
    status_code?: number;
    data?: { url?: string; display_url?: string };
    error?: { message?: string };
  } | null;
  if (!response.ok || !json?.data?.url) {
    const code = json?.status_code ?? response.status;
    if (code === 103) throw new Error('ImgBB rejected this network (code 103). Try from the deployed region.');
    throw new Error(`ImgBB upload failed (${code}).`);
  }
  return { url: json.data.url, displayUrl: json.data.display_url || json.data.url };
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const candidate = form.get('file');
    if (!(candidate instanceof File)) return NextResponse.json({ ok: false, error: 'No file field named "file".' }, { status: 400 });
    file = candidate;
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not read upload body.' }, { status: 400 });
  }

  const type = (file.type || '').toLowerCase();
  if (!ALLOWED.has(type)) return NextResponse.json({ ok: false, error: 'Unsupported file type.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'File is larger than 12 MB.' }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { width, height } = dimensionsOf(type, buffer);

  // Prefer Cloudinary when configured — permanent home, no datacenter throttling.
  // Fall back to ImgBB only if Cloudinary is not configured.
  let uploaded: { url: string; displayUrl: string } | null = null;
  let uploadErr: string | null = null;
  const useCloudinary = Boolean(cloudinaryCreds());
  try {
    uploaded = useCloudinary ? await uploadToCloudinary(buffer, type) : await uploadToImgBB(buffer);
  } catch (e) {
    uploadErr = e instanceof Error ? e.message : String(e);
  }

  if (!uploaded && useCloudinary) {
    // Cloudinary was configured but failed — do NOT silently fall through to
    // ImgBB (we don't want to add more i.ibb.co URLs mid-migration).
    return NextResponse.json({ ok: false, error: uploadErr || 'Cloudinary upload failed.' }, { status: 502 });
  }
  if (!uploaded) {
    return NextResponse.json(
      { ok: false, error: 'No upload backend configured. Set CLOUDINARY_URL or IMGBB_API_KEY.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, url: uploaded.url, display_url: uploaded.displayUrl, width, height });
}
