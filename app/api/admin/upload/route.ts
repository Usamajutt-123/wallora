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
    // standalone markers have no length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    // SOF markers (baseline + progressive) carry dimensions
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
  if (size && Number.isFinite(size[0]) && Number.isFinite(size[1]) && size[0] > 0 && size[0] <= 20000 && size[1] > 0 && size[1] <= 20000) {
    return { width: size[0], height: size[1] };
  }
  return { width: null, height: null };
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const key = (process.env.IMGBB_API_KEY || '').trim();
  if (!key) return NextResponse.json({ ok: false, error: 'IMGBB_API_KEY is not configured.' }, { status: 503 });

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

  const imgbbForm = new FormData();
  imgbbForm.append('image', buffer.toString('base64'));
  imgbbForm.append('name', `wallora-upload-${Date.now().toString(36)}`.slice(0, 60));
  let response: Response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      body: imgbbForm,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'ImgBB is unreachable right now.' }, { status: 502 });
  }
  const json = (await response.json().catch(() => null)) as {
    status_code?: number;
    data?: { url?: string; display_url?: string };
    error?: { message?: string };
  } | null;
  if (!response.ok || !json?.data?.url) {
    const code = json?.status_code ?? response.status;
    if (code === 103) return NextResponse.json({ ok: false, error: 'ImgBB rejected this network (code 103). Try from the deployed region.' }, { status: 502 });
    return NextResponse.json({ ok: false, error: `ImgBB upload failed (${code}).` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, url: json.data.url, width, height });
}
