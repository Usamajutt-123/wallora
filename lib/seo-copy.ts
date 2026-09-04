/**
 * WALLORA — slow-drip AI SEO copy enrichment.
 *
 * Fills the per-wallpaper SEO columns (seo_title, seo_description,
 * seo_keywords, seo_alt) which wallpaper pages already render when present.
 * Runs in small batches (WALLORA_SEO_PER_RUN, default 10) so search engines
 * keep seeing gradually improving pages instead of a big overnight dump.
 *
 * Two passes per run:
 *   A) Wallhaven rows missing tags are enriched with REAL tags from
 *      wallhaven.cc/api/v1/w/{id} (the list API never ships tags). Factual,
 *      never fabricated — this is also the fix for every tag-less wall.
 *   B) Rows that have tags but no SEO copy get unique AI-written copy. Gemini
 *      is told to use ONLY the given facts; rows without any tags are skipped
 *      for AI copy (template copy stays) so nothing is ever invented.
 *
 * Never fatal: reservations, rate limits and single-row errors are logged and
 * the leftovers simply wait for the next run.
 *
 * Env:
 *   GEMINI_API_KEY                  (required for pass B)
 *   WALLORA_SEO_PER_RUN=n           (default 10, cap 40)
 *   WALLORA_SEO_TAG_BUDGET=n        (default min(6, half the run budget))
 */

import { getServiceSupabase } from './supabase';

export const seoEnrichmentConfigured = () => Boolean((process.env.GEMINI_API_KEY || '').trim());

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const budgetOf = () => Math.min(40, Math.max(1, Math.floor(Number(process.env.WALLORA_SEO_PER_RUN) || 10)));
const tagBudgetOf = (runBudget: number) =>
  Math.min(Math.max(1, Math.floor(Number(process.env.WALLORA_SEO_TAG_BUDGET) || 6)), Math.max(1, Math.ceil(runBudget * 0.5)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export interface SeoEnrichmentSummary {
  tagged: number;
  copied: number;
  skipped_no_tags: number;
  failed: number;
  budget: number;
  note: string;
  log: string[];
}

/* ---------------------------------- tags ---------------------------------- */

/** Real tags for one Wallhaven wallpaper from its per-wall endpoint. */
export async function wallhavenTagsFor(wallId: string, timeoutMs = 15_000): Promise<string[]> {
  const res = await fetch(`https://wallhaven.cc/api/v1/w/${encodeURIComponent(wallId)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (WALLORA enrichment)', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`wallhaven per-wall HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { tags?: { name: string; type?: string }[] } };
  const tags = (json.data?.tags ?? [])
    .filter((t) => t.type !== 'meta') // drop "original-resolution" style meta tags
    .map((t) => t.name.replace(/\s+/g, ' ').trim())
    .filter((n) => n.length >= 2 && n.length <= 60);
  return [...new Set(tags)].slice(0, 24);
}

/* ---------------------------------- gemini ---------------------------------- */

interface CopyFacts {
  title: string;
  category: string;
  tags: string;
  resolution: string;
  orientation: string;
  screen: string;
  source: string;
  source_id: string;
}

function orientationOf(width: unknown, height: unknown, resolution: string): string {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return h > w ? 'portrait' : w > h ? 'landscape' : 'square';
  const m = clean(resolution).match(/^(\d{3,5})x(\d{3,5})$/i);
  if (m) {
    const mw = Number(m[1]);
    const mh = Number(m[2]);
    if (mw > 0 && mh > 0) return mh > mw ? 'portrait' : mw > mh ? 'landscape' : 'square';
  }
  return 'screen-adapted';
}

const SCREEN_OF: Record<string, string> = { portrait: 'phone lock screen', landscape: 'desktop or laptop', square: 'phone, tablet or desktop' };
const screenFor = (o: string) => SCREEN_OF[o] ?? 'phone, tablet or desktop';

function buildPrompt(f: CopyFacts): string {
  return `You write unique on-page SEO copy for one WALLPAPER page on the WALLORA site.

FACTS I KNOW about this image (ONLY these are guaranteed true):
- Title: ${f.title}
- Category/tag label: ${f.category}
- Tags: ${f.tags || '(none)'}
- Resolution: ${f.resolution} (${f.orientation}; best on a ${f.screen})
- Wall id: ${f.source}:${f.source_id}

MANDATORY RULES:
- Describe ONLY the subject named in the Title and Tags above. If Tags are "(none)" you must NOT name any object, character, scene, colour or setting — stay general about the category and the resolution/screen use.
- seo_title: a natural phrase a person types into Google, <=55 characters, lead with the strongest real keyword, do not just repeat boilerplate such as "Wallpaper 3840x2160".
- seo_description: ONE natural human sentence of 145-158 characters, unique to this wallpaper, subject + resolution + which screen it suits. Never start with "Explore", never write "Catalog ref", no template phrases.
- seo_keywords: 6-10 comma-separated long-tail phrases people actually search, mixing the real subject, the category label, the resolution and the screen use.
- seo_alt: <=110 characters of plain visual alt text (visual only when tags give facts).
- Never claim WALLORA owns the image, grants a licence or offers commercial/cost permissions. Never mention AI.

Reply with STRICT JSON only, no markdown fences:
{"seo_title":"...","seo_description":"...","seo_keywords":"...","seo_alt":"..."}`;
}

function parseCopy(text: string): Record<string, string> | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(cleaned.slice(s, e + 1)) as Record<string, string>;
  } catch {
    return null;
  }
}

function validCopy(raw: Record<string, string>): { seo_title: string; seo_description: string; seo_keywords: string; seo_alt: string } | null {
  const title = clean(raw.seo_title).slice(0, 80);
  const description = clean(raw.seo_description).slice(0, 190);
  const alt = clean(raw.seo_alt).slice(0, 140);
  const keywordPhrases = String(raw.seo_keywords ?? '')
    .split(',')
    .map((k) => clean(k))
    .filter(Boolean);
  const keywords = keywordPhrases.slice(0, 12).join(', ').slice(0, 500);
  if (title.length < 8 || title.length > 70) return null;
  if (description.length < 60 || description.length > 180) return null;
  if (keywordPhrases.length < 4) return null;
  if (alt.length < 5) return null;
  return { seo_title: title, seo_description: description, seo_keywords: keywords, seo_alt: alt };
}

export async function geminiSeoCopy(facts: CopyFacts): Promise<Record<string, string>> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(facts) }] }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0.7, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
  const json = await res.json();
  const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as string;
  const parsed = parseCopy(text);
  if (!parsed) throw new Error('invalid_json');
  return parsed;
}

/* ------------------------------ orchestration ------------------------------ */

export interface EnrichmentRow {
  source: string;
  source_id: string;
  title: string;
  category: string | null;
  tags: string | null;
  width: number | null;
  height: number | null;
  resolution: string | null;
}

interface QueriedRow extends EnrichmentRow {
  source_id: string;
}

export async function runSeoEnrichment(overrideBudget?: number): Promise<SeoEnrichmentSummary> {
  const summary: SeoEnrichmentSummary = { tagged: 0, copied: 0, skipped_no_tags: 0, failed: 0, budget: 0, note: 'disabled', log: [] };
  const sb = getServiceSupabase();
  const keyConfigured = Boolean((process.env.GEMINI_API_KEY || '').trim());
  if (!sb) {
    summary.note = 'supabase_not_configured';
    return summary;
  }
  if (!keyConfigured) {
    summary.note = 'gemini_key_missing (SEO copy pass skipped; tag backfill would still need key)';
    return summary;
  }
  const budget = Math.max(1, Math.min(40, overrideBudget ?? budgetOf()));
  summary.budget = budget;
  summary.note = '';

  // 6-hour reservation (mirrors claim_daily_job for the drip, inline here so no SQL change).
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const { data: prior, error: priorErr } = await sb
    .from('sync_runs')
    .select('source')
    .eq('source', 'job-reservation:seo-copy')
    .gte('created_at', since)
    .limit(1);
  if (priorErr) {
    summary.note = `reservation_read_failed: ${priorErr.message}`;
    return summary;
  }
  if (prior && prior.length) {
    summary.note = 'already reserved this 6-hour window';
    return summary;
  }
  await sb.from('sync_runs').insert({ source: 'job-reservation:seo-copy', inserted: 0, note: 'SEO enrichment reservation' });

  const started = Date.now();
  const deadline = started + 240_000;
  const tagN = tagBudgetOf(budget);
  // WALLORA_SEO_PER_RUN = AI copy per run. The tag pass has its own smaller
  // budget (Wallhaven API calls, not Gemini) so it never eats the copy budget.
  const copyBudget = budget;

  // Pass A — real tags for tag-less Wallhaven rows.
  try {
    const { data: tagless } = await sb
      .from('wallpapers')
      .select('source_id')
      .eq('source', 'wallhaven')
      .or('tags.is.null,tags.eq.')
      .order('created_at', { ascending: true })
      .limit(tagN);
    for (const row of tagless ?? []) {
      if (Date.now() > deadline) break;
      const id = String(row.source_id ?? '');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
      try {
        const tags = await wallhavenTagsFor(id);
        if (tags.length) {
          const tagsText = tags.join(', ').slice(0, 500);
          const { error } = await sb.from('wallpapers').update({ tags: tagsText }).eq('source', 'wallhaven').eq('source_id', id);
          if (error) summary.failed++;
          else {
            summary.tagged++;
            summary.log.push(`🏷 wallhaven:${id} +${tags.length} tags`);
          }
        } else {
          summary.skipped_no_tags++;
        }
      } catch (e) {
        summary.failed++;
        summary.log.push(`🏷 wallhaven:${id} → ${e instanceof Error ? e.message.slice(0, 60) : 'err'}`);
      }
      await sleep(350);
    }
  } catch (e) {
    summary.log.push(`tag pass query failed: ${e instanceof Error ? e.message.slice(0, 80) : 'err'}`);
  }

  // Pass B — AI copy for rows that HAVE tags but lack SEO copy.
  if (Date.now() < deadline) {
    try {
      const { data: needCopy } = await sb
        .from('wallpapers')
        .select('source,source_id,title,category,tags,width,height,resolution')
        .or('seo_description.is.null,seo_description.eq.')
        .not('tags', 'is', null)
        .neq('tags', '')
        .in('source', ['nexwall', 'animepixels', 'wallhaven', 'manual'])
        .order('created_at', { ascending: true })
        .limit(copyBudget);
      for (const row of needCopy ?? []) {
        if (Date.now() > deadline) break;
        const w = row as QueriedRow;
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(w.source_id)) continue;
        const tags = clean(w.tags);
        const orientation = orientationOf(w.width, w.height, clean(w.resolution));
        const facts: CopyFacts = {
          title: clean(w.title).slice(0, 160) || 'Wallpaper',
          category: clean(w.category).slice(0, 80) || 'Aesthetic',
          tags,
          resolution: clean(w.resolution).slice(0, 40) || 'high resolution',
          orientation,
          screen: screenFor(orientation),
          source: w.source,
          source_id: w.source_id,
        };
        try {
          const raw = await geminiSeoCopy(facts);
          const copy = validCopy(raw);
          if (!copy) {
            summary.failed++;
            summary.log.push(`✍ ${w.source}:${w.source_id} → invalid copy`);
            continue;
          }
          const { error } = await sb
            .from('wallpapers')
            .update(copy)
            .eq('source', w.source)
            .eq('source_id', w.source_id);
          if (error) {
            summary.failed++;
            summary.log.push(`✍ ${w.source}:${w.source_id} → ${error.message.slice(0, 60)}`);
          } else {
            summary.copied++;
            summary.log.push(`✍ ${w.source}:${w.source_id} SEO copy saved`);
          }
          await sleep(1200);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'err';
          summary.failed++;
          summary.log.push(`✍ ${w.source}:${w.source_id} → ${msg.slice(0, 60)}`);
          if (msg === 'rate_limited') {
            summary.log.push('⏸ Gemini rate limit — remaining rows wait for the next run');
            break; // stop the run; don't hammer the free key
          }
        }
      }
    } catch (e) {
      summary.log.push(`copy pass query failed: ${e instanceof Error ? e.message.slice(0, 80) : 'err'}`);
    }
  }

  summary.note =
    summary.tagged + summary.copied === 0 && summary.failed === 0
      ? 'nothing_pending (all tagged + all copy written)'
      : `tagged ${summary.tagged}, copy ${summary.copied}, failed ${summary.failed}, skipped ${summary.skipped_no_tags}`;
  await sb.from('sync_runs').insert({ source: 'seo-copy', inserted: summary.tagged + summary.copied, note: summary.note });
  return summary;
}
