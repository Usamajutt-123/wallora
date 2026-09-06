#!/usr/bin/env node
/**
 * WALLORA MIRROR — existing Supabase NexWall rows → permanent copies.
 *
 * This does NOT call the NexWall API. It reads already-saved image URLs from
 * Supabase, downloads those CDN files, uploads them to Cloudinary when
 * configured (legacy ImgBB only when it is not), then fills the same wallpaper
 * row's mirror_url. Run only from a home PC/internet connection.
 *
 * Usage:
 *   node scripts/nexwall-imgbb-mirror.js --limit 20
 *   node scripts/nexwall-imgbb-mirror.js --dry --limit 20
 *   node scripts/nexwall-imgbb-mirror.js --selftest
 */

import { config } from 'dotenv';
import { mirrorBackend, uploadMirror } from './mirror-upload.mjs';
config({ path: '.env.local', quiet: true });
config({ quiet: true });

const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const rawLimit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 50;
const LIMIT = Math.min(100, Math.max(1, Math.floor(rawLimit)));
const DRY = process.argv.includes('--dry');
const TEST = process.argv.includes('--selftest');
const PACE_MS = 2500;
const MAX_BYTES = 40 * 1024 * 1024;
const SOURCE_DOMAINS = ['kodnextech.com', 'nexwall.app', 'nexwallcdn.com', 'cloudinary.com'];
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const STRONG_BLOCK = /\b(cosplay|selfie|photoshoot|actress|celebrity|supermodel|bridal|bikini|lingerie|swimsuit|sexy|sensual|erotic|nsfw|ecchi|hentai|nude|glamour photography|portrait photography|fashion photography|beauty photography)\b/i;
const PERSON_BLOCK = /\b(woman|women|girl|girls|lady|ladies|female|model|models|portrait|fashion|beauty|bride|blonde)\b/i;
const ILLUSTRATED = /\b(anime|manga|illustration|illustrated|digital art|concept art|cartoon|2d art|3d render|cgi|comic|character art|fantasy art|vector art|drawing|painting)\b/i;
const blockedMetadata = (wallpaper) => {
  const text = `${wallpaper.title || ''} ${wallpaper.category || ''} ${wallpaper.tags || ''}`;
  return STRONG_BLOCK.test(text) || (PERSON_BLOCK.test(text) && !ILLUSTRATED.test(text));
};

function trustedSource(value) {
  const url = value instanceof URL ? value : new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' || url.username || url.password ||
    !SOURCE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ) throw new Error(`untrusted source image host: ${host || 'unknown'}`);
  return url;
}

async function fetchTrustedImage(value) {
  let current = trustedSource(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WALLORA home mirror)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    current = trustedSource(new URL(location, current));
  }
  throw new Error('too many source redirects');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...values) => console.log(...values);

async function sbFetch(path, options = {}) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 180)}`);
  }
  return response;
}

async function readImageLimited(response) {
  if (!response.body) throw new Error('source returned an empty body');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`image too large (over ${Math.round(MAX_BYTES / 1e6)}MB)`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function mirrorOne(wallpaper) {
  if (DRY) return { url: '(dry-run)', size: '?' };
  const response = await fetchTrustedImage(wallpaper.image_url);
  if (!response.ok) throw new Error(`source CDN HTTP ${response.status}`);
  const type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) throw new Error(`source returned unsupported ${type || 'non-image content'}`);
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > MAX_BYTES) throw new Error(`image too large (${Math.round(announced / 1e6)}MB)`);
  const buffer = await readImageLimited(response);
  if (!buffer.length) throw new Error('source returned an empty image');

  const uploaded = await uploadMirror({
    buffer,
    contentType: type,
    source: 'nexwall',
    sourceId: String(wallpaper.source_id),
    name: `wallora-nx-${wallpaper.source_id}`,
  });
  const saved = await sbFetch(`wallpapers?id=eq.${encodeURIComponent(wallpaper.id)}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ mirror_url: uploaded.url }),
  });
  const updated = await saved.json();
  if (!Array.isArray(updated) || updated.length !== 1) throw new Error('wallpaper row disappeared before mirror save');
  return { url: uploaded.url, size: `${(buffer.length / 1e6).toFixed(1)}MB` };
}

async function main() {
  const backend = mirrorBackend();
  if (TEST && DRY) throw new Error('--selftest performs a real mirror upload and cannot be combined with --dry.');
  if (!backend && (!DRY || TEST)) throw new Error('Cloudinary credentials or IMGBB_API_KEY missing in .env.local.');

  // Self-test intentionally needs no Supabase credentials, but does upload once.
  if (TEST) {
    const tiny = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploaded = await uploadMirror({
      buffer: tiny,
      contentType: 'image/png',
      source: 'nexwall',
      sourceId: 'selftest',
      name: 'wallora-selftest',
    });
    log(`✅ ${backend} self-test passed on this PC\n   ${uploaded.url}`);
    return;
  }

  if (!SB_URL || !SB_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
  try {
    const endpoint = new URL(SB_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error();
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS URL.');
  }
  const response = await sbFetch(
    `wallpapers?select=id,source_id,title,category,tags,image_url&source=eq.nexwall&mirror_url=is.null&order=id.asc&limit=${Math.min(300, LIMIT * 3)}`, 
  );
  const fetched = await response.json();
  const fetchedRows = Array.isArray(fetched) ? fetched : [];
  const eligible = fetchedRows.filter((wallpaper) => !blockedMetadata(wallpaper));
  const rows = eligible.slice(0, LIMIT);
  const blocked = fetchedRows.length - eligible.length;
  log(`⟦ NexWall mirror batch: ${rows.length} eligible (limit ${LIMIT})${blocked ? ` · ${blocked} blocked by metadata policy` : ''} ⟧`);
  if (!rows.length) return log('✨ No pending NexWall mirrors.');

  let ok = 0;
  let failed = 0;
  for (const [index, wallpaper] of rows.entries()) {
    try {
      const result = await mirrorOne(wallpaper);
      ok++;
      log(`✓ [${index + 1}/${rows.length}] ${String(wallpaper.title).slice(0, 42)} → ${result.url.slice(0, 70)} (${result.size})`);
    } catch (error) {
      failed++;
      log(`✗ [${index + 1}/${rows.length}] ${String(wallpaper.title).slice(0, 42)}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    if (index < rows.length - 1) await sleep(PACE_MS);
  }
  log(`\n╔═ complete: ${ok} mirrored · ${failed} failed ═╗`);
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : 'Mirror failed.'}`);
  process.exit(1);
});
