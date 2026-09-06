import crypto from 'node:crypto';
import sharp from 'sharp';

/** Cloudinary's free image upload cap is 10 MB (use a little headroom). */
export const CLOUDINARY_MAX_BYTES = 10_000_000;
const BLOCKED_CLOUD_NAME = 'djfvizjdh';
const SAFE_PART = /^[A-Za-z0-9_-]{1,100}$/;

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Read Cloudinary credentials without ever providing a project-specific
 * default. In particular, do not accidentally write to a provider's cloud.
 */
export function cloudinaryCredentials(env = process.env) {
  let fromUrl = null;
  const rawUrl = String(env.CLOUDINARY_URL || '').trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'cloudinary:') {
        fromUrl = {
          cloudName: parsed.hostname,
          key: decoded(parsed.username),
          secret: decoded(parsed.password),
        };
      }
    } catch {
      // Explicit CLOUDINARY_* variables may still provide a valid configuration.
    }
  }

  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloudName || '').trim();
  const key = String(env.CLOUDINARY_API_KEY || fromUrl?.key || '').trim();
  const secret = String(env.CLOUDINARY_API_SECRET || fromUrl?.secret || '').trim();
  if (!cloudName || !key || !secret || !/^[A-Za-z0-9_-]{1,64}$/.test(cloudName)) return null;
  // This is a third-party provider cloud. Never make it a destination.
  if (cloudName.toLowerCase() === BLOCKED_CLOUD_NAME) return null;
  return { cloudName, key, secret };
}

export function cloudinaryConfigured(env = process.env) {
  return Boolean(cloudinaryCredentials(env));
}

export function imgbbConfigured(env = process.env) {
  return Boolean(String(env.IMGBB_API_KEY || '').trim());
}

export function mirrorBackend(env = process.env) {
  if (cloudinaryConfigured(env)) return 'cloudinary';
  if (imgbbConfigured(env)) return 'imgbb';
  return null;
}

export function syncPublicId(source, sourceId) {
  if (!SAFE_PART.test(String(source)) || !SAFE_PART.test(String(sourceId))) {
    throw new Error('invalid source or source_id for Cloudinary public_id');
  }
  // Deliberately no filename extension: Cloudinary treats this as a stable
  // public ID and the delivery transform is added only to the stored URL.
  return `wallora/sync/${source}/${sourceId}`;
}

async function cloudinaryBuffer(buffer, contentType) {
  if (buffer.length <= CLOUDINARY_MAX_BYTES) return { buffer, contentType };

  // Try the requested target first. If an unusually detailed 2560px image is
  // still over the plan cap, reduce quality/width until the cap is guaranteed.
  const attempts = [
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
    if (resized.length <= CLOUDINARY_MAX_BYTES) {
      return { buffer: resized, contentType: 'image/jpeg' };
    }
  }
  throw new Error('image remains over Cloudinary’s 10 MB upload cap after resizing');
}

async function uploadToCloudinary(buffer, { source, sourceId, contentType }) {
  const creds = cloudinaryCredentials();
  if (!creds) throw new Error('Cloudinary mirror credentials are not configured');
  const publicId = syncPublicId(source, sourceId);
  const prepared = await cloudinaryBuffer(buffer, contentType || 'image/jpeg');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${creds.secret}`)
    .digest('hex');
  const form = new URLSearchParams();
  form.set('file', `data:${prepared.contentType};base64,${prepared.buffer.toString('base64')}`);
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('resource_type', 'image');
  form.set('timestamp', timestamp);
  form.set('api_key', creds.key);
  form.set('signature', signature);

  let response;
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
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.public_id) {
    throw new Error(`Cloudinary HTTP ${response.status}${json?.error?.message ? `: ${json.error.message}` : ''}`);
  }

  const returnedPublicId = String(json.public_id);
  if (returnedPublicId !== publicId) throw new Error('Cloudinary returned an unexpected public_id');
  return {
    url: `https://res.cloudinary.com/${creds.cloudName}/image/upload/c_limit,w_900,f_auto,q_auto/${returnedPublicId}`,
    backend: 'cloudinary',
    bytes: prepared.buffer.length,
  };
}

async function uploadToImgBB(buffer, name) {
  const apiKey = String(process.env.IMGBB_API_KEY || '').trim();
  if (!apiKey) throw new Error('IMGBB_API_KEY missing');
  const form = new FormData();
  form.append('image', buffer.toString('base64'));
  form.append('name', String(name).slice(0, 60));
  let response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error('ImgBB is unreachable right now');
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json?.data?.url) {
    const code = json?.status_code ?? response.status;
    throw new Error(`ImgBB HTTP ${code}`);
  }
  const url = new URL(json.data.url);
  if (url.protocol !== 'https:' || !(url.hostname === 'i.ibb.co' || url.hostname.endsWith('.i.ibb.co'))) {
    throw new Error('ImgBB returned an unexpected image host');
  }
  return { url: url.toString(), backend: 'imgbb', bytes: buffer.length };
}

/** Cloudinary is preferred; ImgBB is selected only when Cloudinary is absent. */
export async function uploadMirror({ buffer, source, sourceId, contentType, name }) {
  const backend = mirrorBackend();
  if (backend === 'cloudinary') {
    return uploadToCloudinary(buffer, { source, sourceId, contentType });
  }
  if (backend === 'imgbb') return uploadToImgBB(buffer, name || `wallora-${source}-${sourceId}`);
  throw new Error('No mirror backend configured (set CLOUDINARY_URL or ImgBB credentials)');
}

/** Used by the Wallhaven pipeline to recognize a previously saved mirror. */
export function isCloudinaryMirror(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      url.hostname === 'res.cloudinary.com' &&
      !url.username &&
      !url.password &&
      /^\/[^/]+\/image\/upload\//.test(url.pathname);
  } catch {
    return false;
  }
}
