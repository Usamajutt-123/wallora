#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  WALLORA PIPELINE — Wallhaven → ImgBB → Supabase
 * ═══════════════════════════════════════════════════════════════════
 *
 *  What it does, per category run:
 *    1. Searches Wallhaven (toplist) for the given query
 *    2. Skips wallpapers already in Supabase (saves ImgBB quota!)
 *    3. Downloads the image binary from Wallhaven CDN
 *    4. Uploads it to ImgBB (independent mirror + direct URL)
 *    5. Stores the final ImgBB link + category + title in Supabase
 *
 *  USAGE:
 *    node scripts/wallhaven-imgbb-pipeline.js "anime"            → top 15
 *    node scripts/wallhaven-imgbb-pipeline.js "cyberpunk" 10     → top 10
 *    node scripts/wallhaven-imgbb-pipeline.js "nature" 2 --dry   → test run (no upload/DB)
 *
 *  REQUIRED .env:
 *    IMGBB_API_KEY=...            → https://api.imgbb.com
 *    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *    SUPABASE_SERVICE_ROLE_KEY=eyJ...     (service key — server only)
 *  OPTIONAL:
 *    WALLHAVEN_API_KEY=...        → optional authenticated Wallhaven requests
 *    SUPABASE_TABLE=wallpapers_imgbb
 *
 *  DATABASE:
 *    Run scripts/supabase-setup.sql first. The audit table and main catalog
 *    are service-role-only for writes; this script updates both.
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true }); // .env fills only vars .env.local didn't set
import { createClient } from '@supabase/supabase-js';

/* ────────────────────────── 1. CONFIG ────────────────────────── */

const CONFIG = {
  // CLI args:  node script.js <query> [limit] [--dry]
  query: String(process.argv[2] || 'anime').replace(/\s+/g, ' ').trim().slice(0, 80),
  limit: Math.min(Math.max(parseInt(process.argv[3] || '15', 10) || 15, 1), 15),
  dryRun: process.argv.includes('--dry'),

  wallhaven: {
    base: 'https://wallhaven.cc/api/v1/search',
    apiKey: process.env.WALLHAVEN_API_KEY || '', // optional
    purity: '100',      // SFW only  (sketchy/nsfw OFF)
    categories: '110',  // general + anime; people category permanently OFF
    sorting: 'toplist', // established uploads
  },

  imgbb: {
    base: 'https://api.imgbb.com/1/upload',
    apiKey: process.env.IMGBB_API_KEY || '',
    maxBytes: 30 * 1024 * 1024, // conservative local transfer guard
  },

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    table: process.env.SUPABASE_TABLE || 'wallpapers_imgbb',
  },

  // Conservative pacing between image downloads/uploads.
  delayBetweenWallsMs: 1800,
  httpTimeoutMs: 25000,
};

/* ────────────────────────── 2. GUARDS ────────────────────────── */

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const sexualTerms = /\b(bikini|lingerie|swimsuit|sexy|sensual|erotic|nsfw|ecchi|hentai|nude|nudity)\b/i;
const strongPhotoTerms = /\b(real girl|cosplay|selfie|photoshoot|photo shoot|actress|celebrity|supermodel|fashion model|bride|bridal|vogue|glamour photography|portrait photography|fashion photography|beauty photography|wedding photography)\b/i;
const personTerms = /\b(woman|women|girl|girls|lady|ladies|female|model|models|portrait|fashion|beauty|blonde)\b/i;
const illustrationTerms = /\b(anime|manga|illustration|illustrated|digital art|concept art|cartoon|2d art|3d render|cgi|comic|character art|fantasy art|vector art|drawing|painting)\b/i;
const blockedContent = (text) => sexualTerms.test(text) || strongPhotoTerms.test(text) || (personTerms.test(text) && !illustrationTerms.test(text));
if (!CONFIG.query || blockedContent(CONFIG.query)) {
  fail('Query blocked by WALLORA content policy. Anime/illustrated characters are allowed; real-person/glamour or sexualized queries are not.');
}
if (process.argv.includes('--selftest') && CONFIG.dryRun) fail('--selftest is a real ImgBB upload and cannot be combined with --dry.');

if (!CONFIG.dryRun) {
  if (!CONFIG.imgbb.apiKey) fail('IMGBB_API_KEY missing — configure a valid key from https://api.imgbb.com');
  // --selftest only needs ImgBB; the full pipeline needs Supabase too
  if (!process.argv.includes('--selftest') && (!CONFIG.supabase.url || !CONFIG.supabase.key)) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  }
  if (!process.argv.includes('--selftest')) {
    try {
      const endpoint = new URL(CONFIG.supabase.url);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error();
    } catch {
      fail('NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS URL');
    }
  }
}
const supabase =
  !CONFIG.dryRun && CONFIG.supabase.url
    ? createClient(CONFIG.supabase.url, CONFIG.supabase.key, { auth: { persistSession: false } })
    : null;

/* ─────────────────────── 3. TINY HELPERS ─────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.round(ms + Math.random() * 400); // don't fire at perfect intervals
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ⚠️ ', ...a);

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
  throw new Error(msg); // for TS linters
}

/** fetch with timeout + basic retry for 429/5xx (exponential-ish backoff) */
async function http(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(CONFIG.httpTimeoutMs) });
      if (res.status === 429 || res.status === 444 || res.status >= 500) {
        warn(`${url.slice(0, 70)}… → HTTP ${res.status}, retry ${i + 1}/${tries}`);
        await res.body?.cancel().catch(() => {});
        await sleep(2000 * (i + 1));
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('network error');
}

function trustedUrl(value, domains) {
  const url = value instanceof URL ? value : new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' || url.username || url.password ||
    !domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ) throw new Error(`unexpected remote host: ${host || 'unknown'}`);
  return url;
}

async function trustedHttp(value, domains, opts = {}) {
  let current = trustedUrl(value, domains);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const res = await http(current.toString(), { ...opts, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    current = trustedUrl(new URL(location, current), domains);
  }
  throw new Error('too many redirects');
}

/* ─────────────────── 4. STEP 1 — WALLHAVEN SEARCH ─────────────── */

async function searchWallhaven(query, limit) {
  const p = new URLSearchParams({
    q: `${query} -people -person -models -actress -celebrity -cosplay -bikini -lingerie -selfie -photograph -photoshoot -glamour`,
    categories: CONFIG.wallhaven.categories,
    purity: CONFIG.wallhaven.purity,
    sorting: CONFIG.wallhaven.sorting,
    page: '1',
  });
  if (CONFIG.wallhaven.apiKey) p.set('apikey', CONFIG.wallhaven.apiKey);

  const res = await http(`${CONFIG.wallhaven.base}?${p.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Wallhaven search failed: HTTP ${res.status}`);

  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : [];
  const safe = list.filter((w) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(w?.id ?? ''))) return false;
    if (String(w?.category || '').toLowerCase() === 'people') return false;
    if (w?.purity && String(w.purity).toLowerCase() !== 'sfw') return false;
    try {
      trustedUrl(w?.path, ['wallhaven.cc']);
      trustedUrl(w?.url || `https://wallhaven.cc/w/${w.id}`, ['wallhaven.cc']);
    } catch {
      return false;
    }
    const metadata = `${w?.title || ''} ${Array.isArray(w?.tags) ? w.tags.map((tag) => tag?.name || '').join(' ') : ''}`;
    return !blockedContent(metadata);
  });
  return safe.slice(0, limit).map((w) => {
    const resolutionMatch = String(w.resolution ?? '').match(/^(\d{3,5})x(\d{3,5})$/);
    const rawWidth = resolutionMatch ? Number(resolutionMatch[1]) : 0;
    const rawHeight = resolutionMatch ? Number(resolutionMatch[2]) : 0;
    const width = rawWidth > 0 && rawWidth <= 20000 ? rawWidth : 0;
    const height = rawHeight > 0 && rawHeight <= 20000 ? rawHeight : 0;
    const resolution = width && height ? `${width}x${height}` : null;
    const rawFileSize = Number(w.file_size);
    const fileSize = Number.isSafeInteger(rawFileSize) && rawFileSize > 0 ? rawFileSize : null;
    return {
      wallhaven_id: String(w.id),
      title: (
        (Array.isArray(w.tags) ? w.tags.slice(0, 3).map((t) => t?.name).filter(Boolean).join(' · ') : '') ||
        `${query.replace(/\b\w/g, (char) => char.toUpperCase())} HD Wallpaper · ${resolution || w.id}`
      ).replace(/\s+/g, ' ').trim().slice(0, 140),
      path: trustedUrl(w.path, ['wallhaven.cc']).toString(), // direct CDN image (we download this)
      resolution,
      width,
      height,
      file_size: fileSize,
      source_url: trustedUrl(w.url || `https://wallhaven.cc/w/${w.id}`, ['wallhaven.cc']).toString(),
    };
  });
}

/* ─────────────── 5. STEP 1.5 — DEDUPE AGAINST SUPABASE ───────── */

async function existingMirror(wallhavenId) {
  const [audit, catalog] = await Promise.all([
    supabase
      .from(CONFIG.supabase.table)
      .select('wallpaper_url,display_url')
      .eq('wallhaven_id', wallhavenId)
      .maybeSingle(),
    supabase
      .from('wallpapers')
      .select('source_id,mirror_url,thumb_url')
      .eq('source', 'wallhaven')
      .eq('source_id', wallhavenId)
      .maybeSingle(),
  ]);
  if (audit.error) throw new Error(`audit dedupe lookup: ${audit.error.message}`);
  if (catalog.error) throw new Error(`catalog dedupe lookup: ${catalog.error.message}`);
  const rawWallpaperUrl = catalog.data?.mirror_url || audit.data?.wallpaper_url || null;
  if (!rawWallpaperUrl) return null;
  let wallpaperUrl;
  try {
    wallpaperUrl = trustedUrl(rawWallpaperUrl, ['i.ibb.co']).toString();
  } catch {
    return null; // never reconnect an untrusted legacy mirror
  }
  const rawDisplayUrl = audit.data?.display_url || catalog.data?.thumb_url || wallpaperUrl;
  let displayUrl = wallpaperUrl;
  try {
    displayUrl = trustedUrl(rawDisplayUrl, ['i.ibb.co']).toString();
  } catch {
    /* full trusted mirror is a safe display fallback */
  }
  return {
    wallpaper_url: wallpaperUrl,
    display_url: displayUrl,
    catalog_exists: Boolean(catalog.data?.source_id),
  };
}

async function claimCatalogSlot() {
  const { data, error } = await supabase.rpc('claim_manual_sync_slots', {
    p_source: 'wallhaven',
    p_requested: 1,
  });
  if (error) throw new Error(`daily-cap reservation failed (run the audited v6 SQL): ${error.message}`);
  return Number(data) === 1;
}

/* ───────────────── 6. STEP 2 — DOWNLOAD IMAGE BINARY ─────────── */

async function readLimited(response) {
  if (!response.body) throw new Error('empty response body');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CONFIG.imgbb.maxBytes) {
      await reader.cancel();
      throw new Error(`too large for ImgBB (over ${Math.round(CONFIG.imgbb.maxBytes / 1e6)}MB)`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function downloadImage(w) {
  const res = await trustedHttp(w.path, ['wallhaven.cc'], {
    headers: {
      'User-Agent': 'Mozilla/5.0 (WALLORA pipeline; personal wallpaper archiver)',
      Referer: 'https://wallhaven.cc/',
      Accept: 'image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`image download HTTP ${res.status}`);

  const type = (res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) throw new Error(`unsupported image type: ${type || 'missing'}`);

  const len = Number(res.headers.get('content-length') || 0);
  if (len > CONFIG.imgbb.maxBytes) throw new Error(`too large for ImgBB: ${Math.round(len / 1e6)}MB`);

  const buf = await readLimited(res);
  if (!buf.length) throw new Error('empty download');
  return buf;
}

/* ────────────────── 7. STEP 3 — UPLOAD TO IMGBB ──────────────── */

async function uploadToImgBB(buffer, w) {
  const form = new FormData();
  form.append('image', buffer.toString('base64')); // ImgBB accepts base64 in the "image" field
  form.append('name', `wallora-${CONFIG.query}-${w.wallhaven_id}`);

  // Do not automatically retry this non-idempotent upload; an ambiguous 5xx
  // response could otherwise create duplicate orphan mirrors.
  const res = await http(`${CONFIG.imgbb.base}?key=${CONFIG.imgbb.apiKey}`, {
    method: 'POST',
    body: form,
  }, 1);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ImgBB upload HTTP ${res.status} — ${body.slice(0, 160)}`);
  }

  const json = await res.json();
  if (!json?.success || !json?.data?.url) throw new Error('ImgBB responded without data.url');
  const direct = new URL(json.data.url);
  if (direct.protocol !== 'https:' || !(direct.hostname === 'i.ibb.co' || direct.hostname.endsWith('.i.ibb.co'))) {
    throw new Error('ImgBB returned an unexpected image host');
  }
  let display = null;
  if (json.data.display_url) {
    const candidate = new URL(json.data.display_url);
    if (candidate.protocol === 'https:' && (candidate.hostname === 'i.ibb.co' || candidate.hostname.endsWith('.i.ibb.co'))) {
      display = candidate.toString();
    }
  }
  return { wallpaper_url: direct.toString(), display_url: display };
}

/* ─────────────── 8. STEP 4 — SAVE LINK TO SUPABASE ───────────── */

async function saveToSupabase(w, links) {
  const auditRow = {
    wallpaper_url: links.wallpaper_url,
    display_url: links.display_url,
    category: CONFIG.query,
    title: w.title,
    width: w.width,
    height: w.height,
    file_size: w.file_size,
    wallhaven_id: w.wallhaven_id,
    source_url: w.source_url,
  };
  const { error: auditError } = await supabase
    .from(CONFIG.supabase.table)
    .upsert(auditRow, { onConflict: 'wallhaven_id' });
  if (auditError) throw new Error(`ImgBB audit insert: ${auditError.message}`);

  // Also connect the upload to the site's actual catalog. If this Wallhaven id
  // already arrived through API Sync, only its mirror/metadata are refreshed.
  const catalogRow = {
    source: 'wallhaven',
    source_id: w.wallhaven_id,
    title: w.title,
    category: CONFIG.query,
    image_url: w.path,
    mirror_url: links.wallpaper_url,
    thumb_url: links.display_url || links.wallpaper_url,
    width: w.width || 0,
    height: w.height || 0,
    resolution: w.resolution,
    tags: CONFIG.query,
    source_url: w.source_url,
    is_premium: false,
    api_views: 0,
    api_downloads: 0,
  };
  const { error: catalogError } = await supabase
    .from('wallpapers')
    .upsert(catalogRow, { onConflict: 'source,source_id' });
  if (catalogError) throw new Error(`Main catalog upsert: ${catalogError.message}`);
}

/* ────────────────────────── 9. MAIN LOOP ─────────────────────── */

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
  WALLORA pipeline  ·  Wallhaven → ImgBB → Supabase
╚═══════════════════════════════════════════════╝`);

  // ── --selftest: prove the ImgBB key works from THIS machine (1×1 px upload)
  if (process.argv.includes('--selftest')) {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    try {
      const up = await uploadToImgBB(png, { wallhaven_id: 'selftest' });
      console.log(`✅ ImgBB key VALID on this machine!\n   direct: ${up.wallpaper_url}\n   display: ${up.display_url || '(same as direct)'}`);
      process.exit(0);
    } catch (e) {
      console.log(`❌ ImgBB upload failed from here: ${e.message}\n   (if "forbidden" → this network/IP is blocked; run from your home PC)`);
      process.exit(1);
    }
  }

  log(`🔎 Category/query : "${CONFIG.query}"`);
  log(`🔢 Limit          : top ${CONFIG.limit} (toplist, SFW)`);
  log(`🧪 Mode           : ${CONFIG.dryRun ? 'DRY RUN (no ImgBB upload, no DB writes)' : 'LIVE'}\n`);

  // ── search ──
  let walls;
  try {
    walls = await searchWallhaven(CONFIG.query, CONFIG.limit);
    log(`✓ Wallhaven returned ${walls.length} candidates\n`);
  } catch (e) {
    return fail(`search failed: ${e.message}`);
  }
  if (!walls.length) return fail('no results for this query');

  const stats = { ok: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const tag = `[${String(i + 1).padStart(2, '0')}/${walls.length}] ${w.wallhaven_id}`;

    try {
      // Dedupe before downloading. Also repair either table if an older run
      // saved the mirror to only the audit table or only the main catalog.
      if (!CONFIG.dryRun) {
        const existing = await existingMirror(w.wallhaven_id);
        if (existing) {
          if (!existing.catalog_exists && !(await claimCatalogSlot())) {
            log(`${tag} ⏸  existing mirror kept in audit table; today's Wallhaven publish cap is full`);
            stats.skipped++;
            continue;
          }
          await saveToSupabase(w, existing);
          log(`${tag} ⏭  existing ImgBB mirror reconnected — no upload`);
          stats.skipped++;
          continue;
        }
        if (!(await claimCatalogSlot())) {
          log(`${tag} ⏸  skipped — today's Wallhaven publish cap is full`);
          stats.skipped++;
          continue;
        }
      }

      // download binary from the 'path' URL
      const buffer = await downloadImage(w);
      log(`${tag} ⬇  ${Math.round(buffer.length / 1024)}KB (${w.resolution || 'unknown res'}) — "${w.title.slice(0, 42)}"`);

      if (CONFIG.dryRun) {
        log(`${tag} 🧪 dry-run complete for this image`);
        stats.ok++;
      } else {
        // upload to ImgBB → independent mirror link
        const links = await uploadToImgBB(buffer, w);
        log(`${tag} ☁  ImgBB → ${links.wallpaper_url}`);

        // save row
        await saveToSupabase(w, links);
        log(`${tag} ✅ saved to Supabase`);
        stats.ok++;
      }
    } catch (e) {
      // one bad apple never stops the batch
      warn(`${tag} FAILED: ${e.message} — moving on`);
      stats.failed++;
    }

    // Pace requests conservatively; provider limits can vary by account/time.
    if (i < walls.length - 1) await sleep(jitter(CONFIG.delayBetweenWallsMs));
  }

  if (!CONFIG.dryRun && (stats.ok || stats.skipped)) {
    const { error } = await supabase.rpc('refresh_site_stats');
    if (error) warn(`stats refresh skipped: ${error.message}`);
  }

  console.log(`
──────────── RUN SUMMARY ────────────
  Category : "${CONFIG.query}"
  ✅ Saved  : ${stats.ok}
  ⏭  Skipped: ${stats.skipped} (existing mirror or daily cap)
  ❌ Failed : ${stats.failed}
${CONFIG.dryRun ? '  (dry run — nothing was uploaded or written)\n' : ''}`);
}

main().catch((e) => fail(e.message));

