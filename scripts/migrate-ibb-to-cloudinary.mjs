#!/usr/bin/env node
/**
 * migrate-ibb-to-cloudinary.mjs
 *
 * One-shot migration: move every i.ibb.co / ibb.co URL referenced by the
 * WALLORA Supabase catalog (wallpapers, categories, blog posts) into the
 * user's Cloudinary account (cloud=djfvizjdh).
 *
 * After running:
 *   1. Zero i.ibb.co references remain in rendered HTML.
 *   2. IMG_PROXY_VERSION should be bumped to 5 (lib/img.ts) so the CDN
 *      cache invalidates and browsers refetch the new (Cloudinary) URLs.
 *   3. The 302 fallback added in Part A stays in place as a safety net.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@djfvizjdh
 *     — or — CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *
 * Usage:
 *   node scripts/migrate-ibb-to-cloudinary.mjs            # dry-run, logs plan
 *   node scripts/migrate-ibb-to-cloudinary.mjs --apply    # actually migrate
 *   node scripts/migrate-ibb-to-cloudinary.mjs --apply --verify=5   # + sha256 check N samples
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ----------------------------- config ---------------------------------------

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'djfvizjdh';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

// If CLOUDINARY_URL is set (cloudinary://key:secret@cloud), parse it.
if (process.env.CLOUDINARY_URL) {
  const m = process.env.CLOUDINARY_URL.match(/^cloudinary:\/\/(\d+):([^@]+)@([\w-]+)/);
  if (m) {
    CLOUDINARY_API_KEY ||= m[1];
    CLOUDINARY_API_SECRET ||= m[2];
    CLOUD_NAME ||= m[3];
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY_RUN = !process.argv.includes('--apply');
const verifyArg = process.argv.find((a) => a.startsWith('--verify='));
const VERIFY_SAMPLES = verifyArg ? Number.parseInt(verifyArg.slice(9), 10) : 0;

const FOLDER_PREFIX = 'wallora/migrated'; // subfolder inside Cloudinary
const MAX_BYTES = 26 * 1024 * 1024; // match proxy cap
const CONCURRENCY = 4;
const MAX_RETRIES = 3;

const IBB_HOST_RE = /^https?:\/\/(i\.ibb\.co|ibb\.co|[\w-]+\.ibb\.co)\//i;

// ----------------------------- helpers --------------------------------------

function die(msg) {
  console.error('✗', msg);
  process.exit(1);
}

function log(...args) {
  console.log('[migrate]', ...args);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function extFromUrl(url, contentType) {
  // Prefer the original file extension from the URL path; fall back to content-type.
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (m) return m[1].toLowerCase();
  } catch {}
  const ct = (contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/avif') return 'avif';
  return 'jpg';
}

function safePublicId(url, category) {
  // Produce a stable public_id from the URL path to avoid re-upload dupes.
  // e.g. https://i.ibb.co/AbCdEf/My-Wall.jpg → wallora/migrated/<cat>/AbCdEf-My-Wall
  let pathname;
  try {
    pathname = new URL(url).pathname.replace(/^\/+/, '');
  } catch {
    pathname = `unknown-${Date.now()}`;
  }
  const parts = pathname.split('/').filter(Boolean);
  // i.ibb.co paths are usually /<id>/<filename>; preserve id for uniqueness.
  const joined = parts.slice(-2).join('-');
  const slug = joined
    .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  const catPart = (category || 'misc')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'misc';
  return `${FOLDER_PREFIX}/${catPart}/${slug}`;
}

async function fetchWithRetry(url, n = MAX_RETRIES) {
  let lastErr;
  for (let i = 0; i < n; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WalloraMigration/1.0)',
          Accept: 'image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok && res.body) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw lastErr;
}

async function downloadBytes(url) {
  const res = await fetchWithRetry(url);
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) throw new Error(`too large (${total} bytes) for ${url}`);
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  return { buf, contentType: res.headers.get('content-type') || '' };
}

async function uploadToCloudinary(buf, publicId, contentType) {
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    die('Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET (or CLOUDINARY_URL).');
  }
  const b64 = buf.toString('base64');
  const form = new URLSearchParams();
  form.set('file', `data:${contentType || 'image/jpeg'};base64,${b64}`);
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('resource_type', 'image');
  form.set('type', 'upload');
  form.set('api_key', CLOUDINARY_API_KEY);
  form.set('timestamp', String(Math.floor(Date.now() / 1000)));
  // Use the unsigned? No — server-side with secret, sign it.
  const paramsToSign = `public_id=${publicId}&timestamp=${form.get('timestamp')}${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');
  form.set('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.public_id) {
    throw new Error(`Cloudinary upload failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  // Return the final optimised URL (mirror existing pattern c_limit,w_900,f_auto,q_auto)
  const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;
  return {
    public_id: json.public_id,
    url: `${base}/c_limit,w_900,f_auto,q_auto/${json.public_id}`,
    secure_url: json.secure_url,
    bytes: json.bytes,
  };
}

function cloudinaryOptimisedUrl(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_900,f_auto,q_auto/${publicId}`;
}

async function poolMap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ----------------------------- collection -----------------------------------

const IBB_RE = /https?:\/\/(?:i\.ibb\.co|ibb\.co|[\w-]+\.ibb\.co)\/[^\s)\]"'>]+/gi;

function findIbbUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const found = new Set();
  for (const m of text.matchAll(IBB_RE)) found.add(m[0].replace(/[.,;:!?)\]"']+$/g, ''));
  return [...found];
}

function isIbb(url) {
  return IBB_HOST_RE.test(url || '');
}

// ----------------------------- main -----------------------------------------

async function main() {
  if (!SUPA_URL || !SUPA_KEY) die('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    die('Missing Cloudinary credentials. Set CLOUDINARY_URL=cloudinary://<key>:<secret>@djfvizjdh OR CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.');
  }

  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

  log(DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY mode (will rewrite DB rows)');
  log(`Cloudinary cloud: ${CLOUD_NAME}`);

  // 1. Collect every row that might carry an i.ibb.co URL.
  log('Fetching wallpapers…');
  const { data: walls, error: we } = await supa
    .from('wallpapers')
    .select('id, category, image_url, thumb_url, mirror_url, title, source, source_id');
  if (we) die(`wallpapers fetch: ${we.message}`);

  log('Fetching categories…');
  const { data: cats, error: ce } = await supa
    .from('categories')
    .select('id, name, cover_url');
  if (ce) die(`categories fetch: ${ce.message}`);

  log('Fetching posts…');
  const { data: posts, error: pe } = await supa
    .from('posts')
    .select('id, slug, cover_url, content_markdown');
  if (pe) die(`posts fetch: ${pe.message}`);

  // Legacy wallhaven→ImgBB mirror table (still populated by wallhaven-imgbb-pipeline.js)
  log('Fetching wallpapers_imgbb mirror table…');
  const { data: imgbbRows, error: ie } = await supa
    .from('wallpapers_imgbb')
    .select('id, wallhaven_id, wallpaper_url, display_url, category, title');
  if (ie) {
    // Table may not exist on older installs; non-fatal.
    log(`(wallpapers_imgbb not queried: ${ie.message} — skipping that table)`);
  }

  // Build a map of oldUrl -> { firstCategory, context[] }
  const urlMap = new Map();
  function addUrl(url, ctx, category) {
    if (!isIbb(url)) return;
    const norm = url.replace(/^http:\/\//i, 'https://');
    let entry = urlMap.get(norm);
    if (!entry) {
      entry = { url: norm, category: category || 'misc', contexts: [] };
      urlMap.set(norm, entry);
    }
    if (category && entry.category === 'misc') entry.category = category;
    entry.contexts.push(ctx);
  }

  for (const w of walls) {
    addUrl(w.image_url, `wallpapers[${w.id}].image_url`, w.category);
    addUrl(w.thumb_url, `wallpapers[${w.id}].thumb_url`, w.category);
    addUrl(w.mirror_url, `wallpapers[${w.id}].mirror_url`, w.category);
  }
  for (const c of cats) addUrl(c.cover_url, `categories[${c.id}].cover_url`, c.name);
  for (const p of posts) {
    addUrl(p.cover_url, `posts[${p.slug}].cover_url`, p.category || 'blog');
    for (const u of findIbbUrls(p.content_markdown || '')) {
      addUrl(u, `posts[${p.slug}].content_markdown`, p.category || 'blog');
    }
  }
  if (imgbbRows) {
    for (const r of imgbbRows) {
      addUrl(r.wallpaper_url, `wallpapers_imgbb[${r.id}].wallpaper_url`, r.category || r.title || 'wallhaven');
      addUrl(r.display_url, `wallpapers_imgbb[${r.id}].display_url`, r.category || r.title || 'wallhaven');
    }
  }

  const urls = [...urlMap.values()];
  log(`Found ${urls.length} distinct i.ibb.co URLs across ${walls.length} wallpapers, ${cats.length} categories, ${posts.length} posts.`);
  if (urls.length === 0) {
    log('Nothing to migrate. Exiting.');
    return;
  }

  // 2. Download + upload each unique URL.
  const manifest = new Map(); // oldUrl -> { public_id, newUrl, sha256, bytes }
  let totalBytes = 0;
  let ok = 0;
  let fail = 0;

  async function migrateOne(entry) {
    const { url, category } = entry;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { buf, contentType } = await downloadBytes(url);
        const hash = sha256(buf);
        const publicId = safePublicId(url, category);
        const up = await uploadToCloudinary(buf, publicId, contentType);
        const newUrl = cloudinaryOptimisedUrl(up.public_id);
        manifest.set(url, { public_id: up.public_id, newUrl, sha256: hash, bytes: buf.length, contentType });
        totalBytes += buf.length;
        ok++;
        if (ok % 25 === 0) log(`  progress: ${ok}/${urls.length} uploaded (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
        return;
      } catch (e) {
        if (attempt === MAX_RETRIES - 1) {
          console.error(`  ✗ FAILED ${url}: ${e.message}`);
          fail++;
          return;
        }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }

  if (DRY_RUN) {
    log('DRY RUN — would upload these URLs:');
    for (const u of urls.slice(0, 20)) log(' ', u.url, '->', safePublicId(u.url, u.category));
    if (urls.length > 20) log(`  … and ${urls.length - 20} more.`);
    log(`Total: ${urls.length} files. Re-run with --apply to migrate.`);
    return;
  }

  log(`Uploading to Cloudinary (concurrency=${CONCURRENCY})…`);
  await poolMap(urls, CONCURRENCY, migrateOne);
  log(`Upload done. OK=${ok} FAIL=${fail} totalBytes=${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (fail > 0) {
    die(`${fail} files failed to upload — aborting DB writes. Fix network/credentials and re-run (already-uploaded public_ids are deterministic so no dupes).`);
  }

  // 3. Rewrite rows.
  function rewrite(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(IBB_RE, (match) => {
      const norm = match.replace(/^http:\/\//i, 'https://');
      const trimmed = norm.replace(/[.,;:!?)\]"']+$/g, '');
      const trailing = norm.slice(trimmed.length);
      const m = manifest.get(trimmed);
      return m ? m.newUrl + trailing : match;
    });
  }

  log('Rewriting wallpapers…');
  let wallsChanged = 0;
  for (const w of walls) {
    const ni = rewrite(w.image_url);
    const nt = rewrite(w.thumb_url);
    const nm = rewrite(w.mirror_url);
    if (ni === w.image_url && nt === w.thumb_url && nm === w.mirror_url) continue;
    const { error } = await supa
      .from('wallpapers')
      .update({ image_url: ni, thumb_url: nt, mirror_url: nm })
      .eq('id', w.id);
    if (error) { console.error(`  wallpaper ${w.id} update failed:`, error.message); continue; }
    wallsChanged++;
  }
  log(`  updated ${wallsChanged} wallpaper rows`);

  log('Rewriting categories…');
  let catsChanged = 0;
  for (const c of cats) {
    const n = rewrite(c.cover_url);
    if (n === c.cover_url) continue;
    const { error } = await supa.from('categories').update({ cover_url: n }).eq('id', c.id);
    if (error) { console.error(`  category ${c.id} update failed:`, error.message); continue; }
    catsChanged++;
  }
  log(`  updated ${catsChanged} category rows`);

  log('Rewriting posts…');
  let postsChanged = 0;
  for (const p of posts) {
    const nc = rewrite(p.cover_url);
    const nm = rewrite(p.content_markdown);
    if (nc === p.cover_url && nm === p.content_markdown) continue;
    const { error } = await supa.from('posts').update({ cover_url: nc, content_markdown: nm }).eq('id', p.id);
    if (error) { console.error(`  post ${p.slug} update failed:`, error.message); continue; }
    postsChanged++;
  }
  log(`  updated ${postsChanged} post rows`);

  let imgbbChanged = 0;
  if (imgbbRows) {
    log('Rewriting wallpapers_imgbb mirror table…');
    for (const r of imgbbRows) {
      const nw = rewrite(r.wallpaper_url);
      const nd = rewrite(r.display_url);
      if (nw === r.wallpaper_url && nd === r.display_url) continue;
      const { error } = await supa
        .from('wallpapers_imgbb')
        .update({ wallpaper_url: nw, display_url: nd })
        .eq('id', r.id);
      if (error) { console.error(`  wallpapers_imgbb ${r.id} update failed:`, error.message); continue; }
      imgbbChanged++;
    }
    log(`  updated ${imgbbChanged} wallpapers_imgbb rows`);
  }

  // 4. Optional sha256 verification on a random sample — re-download new URL
  //    and confirm hash matches what we originally fetched from ImgBB.
  if (VERIFY_SAMPLES > 0) {
    log(`Verifying sha256 on ${VERIFY_SAMPLES} random samples…`);
    const entries = [...manifest.entries()];
    const sample = entries.sort(() => Math.random() - 0.5).slice(0, VERIFY_SAMPLES);
    let good = 0;
    for (const [oldUrl, v] of sample) {
      try {
        const { buf } = await downloadBytes(v.newUrl);
        const got = sha256(buf);
        if (got === v.sha256) { good++; log(`  ✓ ${oldUrl.slice(0, 70)}… match (${v.bytes} bytes)`); }
        else { log(`  ✗ MISMATCH ${oldUrl}`); }
      } catch (e) {
        log(`  ✗ verify failed for ${oldUrl}: ${e.message}`);
      }
    }
    log(`Verification: ${good}/${sample.length} match.`);
  }

  // 5. Print the summary manifest.
  const summaryPath = 'cloudinary-migration-manifest.json';
  const fs = await import('node:fs/promises');
  const serialisable = {};
  for (const [oldUrl, v] of manifest) serialisable[oldUrl] = v;
  await fs.writeFile(summaryPath, JSON.stringify(serialisable, null, 2));
  log(`Manifest written to ${summaryPath}`);

  log('');
  log('================ MIGRATION SUMMARY ================');
  log(`  Distinct URLs migrated : ${ok}`);
  log(`  Total bytes uploaded   : ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  log(`  Wallpapers updated     : ${wallsChanged}`);
  log(`  Categories updated     : ${catsChanged}`);
  log(`  Posts updated          : ${postsChanged}`);
  log(`  wallpapers_imgbb rows  : ${imgbbChanged}`);
  log('');
  log('NEXT STEP: bump IMG_PROXY_VERSION in lib/img.ts from 4 to 5 to bust the CDN cache.');
}

main().catch((e) => { console.error(e); process.exit(1); });
