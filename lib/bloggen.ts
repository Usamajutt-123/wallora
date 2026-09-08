/**
 * Shared AI blog-generation engine — used by:
 *   • app/api/cron/auto-blog/route.ts   (Vercel Cron, Mon/Wed/Fri)
 *   • app/api/admin/blog-generate/route.ts (manual trigger from admin)
 *
 * Writes posts to Supabase `posts` (see lib/blog.ts header for table SQL).
 * Cover image = a catalog wallpaper URL from the post's category. The original
 * source/rights context remains unchanged; no separate image license is implied.
 */

import { getServiceSupabase } from './supabase';
import { canonicalCategoryName } from './categories';
import { isHardBlockedWallpaper } from './filters';

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const CATEGORY_BANK = [
  'Anime & Manga', 'Gaming', 'Space & Cosmos', 'AMOLED & Dark',
  'Cyberpunk City', 'Fantasy Worlds', 'Nature & Landscapes',
];

const TOPIC_BANK = [
  'Choosing AMOLED wallpapers for phones in {year} — how pure black behaves on OLED',
  'A {year} guide to choosing 4K gaming wallpapers for different setups',
  'Space wallpapers for OLED screens — contrast, colour and composition',
  'The ultimate anime wallpaper guide: find your aesthetic',
  'Cyberpunk city wallpapers: neon, rain and dystopian moodboards',
  'Fantasy worlds wallpapers for desktop — castles, dragons, glow',
  'Minimal dark wallpapers that make icons pop',
  'How to pick the right wallpaper resolution for your monitor',
  'Nature wallpapers: choosing open compositions for a focused workspace',
  'Ultrawide monitor wallpaper guide (21:9, 32:9 setups)',
  'Dual-monitor wallpapers: how to pick pairs that flow',
  'Phone wallpaper styles for {year} — practical ways to choose your look',
  'Dark and light wallpapers: practical contrast choices for night setups',
  'How to match a wallpaper style with the look of your desk setup',
  '5 wallpaper styles that can give a desk setup a more polished look',
  'Cosmic wallpapers: building a quiet, spacious visual style',
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

function buildPrompt(topic: string, taken: string[]): string {
  const year = new Date().getFullYear();
  const cats = CATEGORY_BANK.map((c) => `${c} → /search?category=${encodeURIComponent(c)}`).join('\n  ');
  return `You are the editor of WALLORA, a wallpaper discovery website. Write ONE complete, publish-ready blog post as MARKDOWN.

TOPIC: "${topic.replace('{year}', String(year))}"

HARD REQUIREMENTS:
1. Output STRICT JSON only, no markdown fences:
{"title": "≤60 chars, front-load main keyword", "description": "≤160 chars, benefit-led meta description", "keywords": "8-12 comma-separated LONG-TAIL phrases", "category": "<one of: Anime & Manga|Gaming|Space & Cosmos|AMOLED & Dark|Cyberpunk City|Fantasy Worlds|Nature & Landscapes>", "markdown": "…the full post…"}

2. In "markdown":
   - 700–1100 words, friendly expert tone, NO fluff intro like "In today's digital world".
   - Structure: 1 strong intro paragraph (2-3 sentences), then 4-6 H2 sections (##), short paragraphs, bullet/numbered lists where useful.
   - Include 2–3 INTERNAL LINKS in markdown to these real category pages (relative URLs, exactly as written):
  ${cats}
   Example: [browse the AMOLED & Dark collection](/search?category=AMOLED%20%26%20Dark)
   - Include 1 blockquote tip ("> Pro tip: …").
   - End with "## FAQ" containing 3 short Q&A formatted as "### Question?" + one-paragraph answers.
   - Do NOT include the H1 title in markdown (the page renders it).
   - Never fabricate statistics, current trend rankings, source quotas or product capabilities; use careful qualitative wording.
   - Do not embed images or raw HTML. The site supplies a separately moderated cover.
   - Do not claim WALLORA owns an image or grants copyright, license, commercial-use or cost permissions.

3. Title must be unique — avoid anything similar to: ${taken.length ? taken.slice(0, 40).join(', ') : '(none yet)'}
4. Never mention being AI, internal tooling, or anything meta. Write as the site's editorial voice.`;
}

interface GeminiPost {
  title: string;
  description: string;
  keywords: string;
  category: string;
  markdown: string;
}

const OUTPUT_CATEGORIES = new Set(['Anime & Manga', 'Gaming', 'Space & Cosmos', 'AMOLED & Dark', 'Cyberpunk City', 'Fantasy Worlds', 'Nature & Landscapes']);

function validatePost(value: unknown): GeminiPost {
  const post = value as Partial<GeminiPost> | null;
  const title = String(post?.title ?? '').replace(/\s+/g, ' ').trim();
  const description = String(post?.description ?? '').replace(/\s+/g, ' ').trim();
  const keywords = String(post?.keywords ?? '').replace(/\s+/g, ' ').trim();
  // Accept legacy spellings ("Anime", "nature") and store the canonical name.
  const category = canonicalCategoryName(String(post?.category ?? '').trim()) ?? '';
  const markdown = String(post?.markdown ?? '').trim();
  const words = markdown ? markdown.split(/\s+/).filter(Boolean).length : 0;
  const keywordCount = keywords.split(',').map((word) => word.trim()).filter(Boolean).length;
  const h2Count = (markdown.match(/^##\s+\S/gm) ?? []).length;
  if (
    title.length < 5 || title.length > 70 ||
    description.length < 40 || description.length > 170 ||
    keywords.length > 500 || keywordCount < 4 || keywordCount > 15 ||
    markdown.length > 200_000 || words < 600 || words > 1400 || h2Count < 4 ||
    !/^##\s+FAQ\s*$/im.test(markdown) || !/^>\s*Pro tip:/im.test(markdown) ||
    !/\]\(\/search\?category=/.test(markdown) || !OUTPUT_CATEGORIES.has(category)
  ) {
    throw new Error('gemini_invalid_article');
  }
  return { title, description, keywords, category, markdown };
}

async function gemini(prompt: string): Promise<GeminiPost> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.85, maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(38_000),
      },
    );
    if (res.status === 429) throw new Error('gemini_rate_limit');
    if (res.status === 503 || res.status === 529) {
      // Preview models can throttle under load — brief wait, one bounded retry.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 18000));
        continue;
      }
      throw new Error('gemini_overloaded — cron will try again on the next publishing day');
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }
  throw new Error('gemini_empty_response');
}

export interface GenResult {
  ok: boolean;
  slug?: string;
  title?: string;
  words?: number;
  cover?: string | null;
  status?: 'pending';
  note?: string;
  error?: string;
}

export async function generateBlogPost(topicOverride?: string): Promise<GenResult> {
  const sb = getServiceSupabase();
  if (!sb) return { ok: false, error: 'supabase_not_configured' };
  if (!KEY) return { ok: false, error: 'gemini_key_missing' };

  // dedupe against existing slugs
  const { data: rows, error: slugsError } = await sb.from('posts').select('slug').order('published_at', { ascending: false }).limit(1000);
  if (slugsError) return { ok: false, error: `supabase: ${slugsError.message}` };
  const taken = (rows ?? []).map((r: { slug: string }) => r.slug);

  const year = new Date().getFullYear();
  const topic =
    topicOverride?.trim() ||
    TOPIC_BANK.map((t) => t.replace('{year}', String(year)))
      .filter((t) => !taken.some((s) => s.startsWith(slugify(t).slice(0, 28))))
      .sort(() => Math.random() - 0.5)[0];
  if (!topic) return { ok: false, error: 'topic_bank_exhausted — pass a custom topic' };

  try {
    const post = validatePost(await gemini(buildPrompt(topic, taken)));

    const slug = slugify(post.title);
    if (!slug) return { ok: false, error: 'gemini_invalid_title' };
    if (taken.includes(slug)) return { ok: false, error: 'generated_title_already_exists — retry with a different topic' };

    // Cover comes from the existing Supabase library only. This intentionally
    // avoids spending a source-API request just to decorate a blog card.
    let cover_url: string | null = null;
    try {
      const { data: covers } = await sb
        .from('wallpapers')
        .select('source,source_id,title,category,tags,image_url,mirror_url')
        .eq('category', post.category)
        .order('views', { ascending: false })
        .limit(20);
      const safeCover = (covers ?? []).find(
        (candidate) =>
          ['nexwall', 'animepixels', 'wallhaven', 'manual'].includes(String(candidate.source)) &&
          /^[A-Za-z0-9_-]{1,100}$/.test(String(candidate.source_id ?? '')) &&
          !isHardBlockedWallpaper(candidate),
      );
      const candidateUrl = safeCover?.mirror_url || safeCover?.image_url || null;
      if (candidateUrl) {
        const parsed = new URL(candidateUrl);
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) cover_url = parsed.toString();
      }
    } catch {
      /* cover optional */
    }

    const { error } = await sb.from('posts').insert(
      {
        slug,
        title: String(post.title).slice(0, 140),
        description: String(post.description || '').slice(0, 300),
        keywords: String(post.keywords || '').slice(0, 500),
        category: post.category || null,
        content_markdown: post.markdown,
        cover_url,
        // AI output is NEVER auto-published. It lands as "pending" so the site
        // owner can read it, fix any mistake and only then set it Published.
        status: 'pending',
        published_at: new Date().toISOString(),
      },
    );
    if (error) {
      const message = error.code === '23505' ? 'slug_collision — retry to generate a fresh title' : error.message;
      return { ok: false, error: `supabase: ${message}` };
    }

    return {
      ok: true,
      slug,
      title: post.title,
      words: post.markdown.split(/\s+/).length,
      cover: cover_url,
      status: 'pending',
      note: 'AI post saved as PENDING — review it in Admin → Blog, then publish.',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown_error' };
  }
}
