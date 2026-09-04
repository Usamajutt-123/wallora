#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WALLORA — AI SEO GENERATOR (Gemini → Supabase)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Reads wallpapers from Supabase that have no SEO copy yet, sends them to
 *  Google Gemini in small BATCHES, and writes back a unique, keyword-rich
 *  seo_title / seo_description / seo_keywords / seo_alt for every wallpaper.
 *  Public pages prefer the resulting contextual metadata when available.
 *
 *  ── Environment ───────────────────────────────────────────────────────────
 *
 *    GEMINI_API_KEY             key from https://aistudio.google.com/apikey
 *    NEXT_PUBLIC_SUPABASE_URL   your project URL
 *    SUPABASE_SERVICE_ROLE_KEY  service role key (write access)
 *    GEMINI_PACE_MS             optional delay between calls (default 4500)
 *
 *  ── Usage ─────────────────────────────────────────────────────────────────
 *
 *    node scripts/generate-seo.js                # first 500 rows missing SEO copy
 *    node scripts/generate-seo.js --limit 300    # cap this run at 300 walls
 *    node scripts/generate-seo.js --batch 10     # 10 walls per Gemini call
 *    node scripts/generate-seo.js --dry          # preview 1 batch, write nothing
 *
 *  What Gemini writes for each wallpaper (JSON, enforced):
 *    seo_title       ≤ 60 chars, natural and subject-specific
 *    seo_description ≤ 155 chars, contextual and specific to the image metadata
 *    seo_keywords    10–14 comma-separated LONG-TAIL phrases ("dark amoled
 *                    fantasy castle wallpaper 4k desktop"), no duplicates
 *    seo_alt         natural alt text for the <img> (accessibility + Images)
 * ═══════════════════════════════════════════════════════════════════════════
 */


import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true }); // .env fills only vars .env.local didn't set

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const args = process.argv.slice(2);
const numberArg = (flag, fallback, min, max) => {
  const index = args.indexOf(flag);
  const value = index >= 0 ? Number(args[index + 1]) : fallback;
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.floor(value) : fallback));
};
const DRY = args.includes('--dry');
const LIMIT = numberArg('--limit', 500, 1, 1000);
const BATCH = numberArg('--batch', 15, 1, 20);
const PACE_MS = Math.min(60_000, Math.max(0, Number(process.env.GEMINI_PACE_MS) || 4500));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Supabase REST helpers (no SDK needed) ---------------- */

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...opts,
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function fetchMissingSeo(limit) {
  return sbFetch(
    `/wallpapers?seo_description=is.null&select=id,title,category,resolution,width,height,tags,source` +
      `&order=id.asc&limit=${limit}`,
  );
}

async function fetchExistingDescriptions() {
  const descriptions = new Set();
  for (let offset = 0; ; offset += 1000) {
    const rows = await sbFetch(
      `/wallpapers?seo_description=not.is.null&select=seo_description&order=id.asc&offset=${offset}&limit=1000`,
    );
    for (const row of rows) {
      const description = String(row?.seo_description ?? '').trim().toLowerCase();
      if (description) descriptions.add(description);
    }
    if (rows.length < 1000) break;
  }
  return descriptions;
}

async function saveSeo(id, seo) {
  const rows = await sbFetch(`/wallpapers?id=eq.${encodeURIComponent(id)}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(seo),
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('wallpaper no longer exists');
}

/* ------------------------------ Gemini ---------------------------------- */

function buildPrompt(walls) {
  return `You are an SEO copywriter for WALLORA, a wallpaper discovery website.

Write Google-ready metadata for EACH wallpaper below. Rules:
- seo_title: max 60 chars. Use a natural, subject-specific title with truthful resolution/category context. Do not reuse one fixed template.
- seo_description: 60-155 chars of natural English specific to this image metadata: subject, mood/details, resolution/orientation and suitable screen fit. No clickbait.
- seo_keywords: 10 to 14 relevant long-tail phrases, comma-separated in ONE string. Use the actual resolution instead of claiming 4K when it is unknown or smaller. Lowercase.
- seo_alt: max 110 chars, describe the scene naturally for screen readers.
- Keep both titles and descriptions unique/contextual across the batch; do not name-swap a repeated sentence.
- Do not claim image ownership, copyright permission, a license, or commercial-use rights.

Return STRICT JSON (no markdown fences), an array in the SAME order:
[{"i":<index>,"seo_title":"...","seo_description":"...","seo_keywords":"...","seo_alt":"..."},...]

Wallpapers:
${JSON.stringify(
  walls.map((w, i) => ({
    i,
    title: w.title,
    category: w.category,
    resolution: w.resolution,
    tags: (w.tags || '').slice(0, 80),
  })),
)}`;
}

async function geminiBatch(walls) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(walls) }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  let text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  text = text.replace(/```json|```/g, '').trim();
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('Gemini returned non-array JSON');
  return arr;
}

function cleanSeoItem(item, chunkLength) {
  const index = Number(item?.i);
  const seo_title = String(item?.seo_title ?? '').replace(/\s+/g, ' ').trim();
  const seo_description = String(item?.seo_description ?? '').replace(/\s+/g, ' ').trim();
  const seo_keywords = String(item?.seo_keywords ?? '').replace(/\s+/g, ' ').trim();
  const seo_alt = String(item?.seo_alt ?? '').replace(/\s+/g, ' ').trim();
  const keywordCount = seo_keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean).length;
  if (!Number.isInteger(index) || index < 0 || index >= chunkLength) return null;
  if (
    seo_title.length < 5 || seo_title.length > 60 ||
    seo_description.length < 60 || seo_description.length > 155 ||
    seo_keywords.length > 500 || keywordCount < 8 || keywordCount > 16 ||
    seo_alt.length < 5 || seo_alt.length > 110
  ) return null;
  return { i: index, seo_title, seo_description, seo_keywords, seo_alt };
}

/* --------------------------------- main ---------------------------------- */

(async () => {
  console.log('🤖 WALLORA · AI SEO Generator (Gemini → Supabase)');
  console.log('─────────────────────────────────────────────────');

  if (!GEMINI_KEY || !SB_URL || !SB_KEY) {
    console.error('❌ Missing env. Set: GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  try {
    const endpoint = new URL(SB_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error();
  } catch {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS URL.');
    process.exit(1);
  }

  const walls = await fetchMissingSeo(LIMIT);
  console.log(`📋 ${walls.length} wallpapers need SEO copy (batch=${BATCH}, limit=${LIMIT})`);
  if (!walls.length) {
    console.log('✅ Everything already optimized — nothing to do!');
    return;
  }

  let done = 0, failed = 0, calls = 0;
  const usedDescriptions = await fetchExistingDescriptions();
  console.log(`🔒 ${usedDescriptions.size} existing descriptions loaded for cross-run deduplication`);
  const rateRetries = new Map();
  for (let i = 0; i < walls.length; i += BATCH) {
    const chunk = walls.slice(i, i + BATCH);
    const t0 = Date.now();
    try {
      const raw = await geminiBatch(chunk);
      calls++;
      const byIndex = new Map();
      for (const candidate of raw) {
        const item = cleanSeoItem(candidate, chunk.length);
        const descriptionKey = item?.seo_description.toLowerCase();
        if (!item || byIndex.has(item.i) || usedDescriptions.has(descriptionKey)) continue;
        byIndex.set(item.i, item);
        usedDescriptions.add(descriptionKey);
      }
      const out = [...byIndex.values()].sort((a, b) => a.i - b.i);
      failed += chunk.length - out.length;
      if (DRY) {
        console.log('\n— DRY RUN sample —');
        for (const item of out.slice(0, 3)) {
          console.log(` • ${item.seo_title}\n   ${item.seo_description}\n   KW: ${item.seo_keywords}\n`);
        }
        console.log('(dry mode — nothing written, stopping)');
        return;
      }
      for (const item of out) {
        const w = chunk[item.i];
        if (!w || !item.seo_title || !item.seo_description) continue;
        try {
          await saveSeo(w.id, {
            seo_title: String(item.seo_title).slice(0, 90),
            seo_description: String(item.seo_description).slice(0, 180),
            seo_keywords: String(item.seo_keywords || '').slice(0, 500),
            seo_alt: String(item.seo_alt || '').slice(0, 140),
          });
          done++;
        } catch (e) {
          failed++;
          console.log(`  ✖ save ${w.id}: ${e.message}`);
        }
      }
      console.log(`✦ batch ${Math.floor(i / BATCH) + 1}: ${out.length} walls optimized (${done} saved so far)`);
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        const attempts = rateRetries.get(i) || 0;
        if (attempts < 2) {
          rateRetries.set(i, attempts + 1);
          console.log('⏳ Gemini rate limit — cooling down 65s before a bounded retry…');
          await sleep(65000);
          i -= BATCH; // for-loop increment returns to the same chunk
          continue;
        }
      }
      failed += chunk.length;
      console.log(`✖ batch failed: ${e.message} — chunk skipped`);
    }
    // pace requests: keep ≥ PACE_MS between Gemini calls
    const dt = Date.now() - t0;
    if (dt < PACE_MS && i + BATCH < walls.length) await sleep(PACE_MS - dt + Math.random() * 400);
  }

  console.log('─────────────────────────────────────────────────');
  console.log(`✅ Done: ${done} wallpapers got AI SEO copy · Gemini calls: ${calls} · failed: ${failed}`);
  console.log('→ Saved seo_* fields are used on the next page render or cache refresh.');
})().catch((e) => {
  console.error('💥 Fatal:', e.message);
  process.exit(1);
});
