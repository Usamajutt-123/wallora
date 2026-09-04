#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WALLORA — AI BLOG WRITER (Gemini → content/posts/*.md)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Each run asks Gemini for one to three SEO-focused wallpaper articles and
 *  saves them to the Supabase `posts` table as PENDING (never auto-published).
 *  On Vercel serverless the filesystem is read-only, so posts MUST live in
 *  Supabase to persist. `--local` writes markdown files instead (dev only).
 *
 *  Auto-drafting: vercel.json schedules /api/cron/auto-blog for Mon/Wed/Fri —
 *  this script is the LOCAL/manual version of the same engine. Everything AI
 *  writes is saved PENDING for the owner's review; publish from Admin → Blog.
 *
 *  ── Environment ───────────────────────────────────────────────────────────
 *    GEMINI_API_KEY             key → https://aistudio.google.com/apikey
 *    NEXT_PUBLIC_SUPABASE_URL   +  SUPABASE_SERVICE_ROLE_KEY  (persistence)
 *
 *  ── Usage ─────────────────────────────────────────────────────────────────
 *    node scripts/generate-blog.js                 # 1 post → Supabase
 *    node scripts/generate-blog.js --count 3       # up to 3 posts
 *    node scripts/generate-blog.js --topic "Best 4K Anime Wallpapers for PC"
 *    node scripts/generate-blog.js --local --dry   # markdown preview, no save
 *
 *  Each post includes (enforced by prompt):
 *    • long-tail SEO title + meta description + keyword list (frontmatter)
 *    • 700–1100 words, H2/H3 structure, numbered/bullet lists
 *    • INTERNAL LINKS to real WALLORA category pages  (/search?category=…)
 *    • a short FAQ section at the bottom (great for Google FAQ snippets)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true }); // .env fills only vars .env.local didn't set
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const POSTS_DIR = path.join(process.cwd(), 'content', 'posts');
const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LOCAL = args.includes('--local');
const countIndex = args.indexOf('--count');
const countValue = countIndex >= 0 ? Number(args[countIndex + 1]) : 1;
const COUNT = Math.min(3, Math.max(1, Number.isFinite(countValue) ? Math.floor(countValue) : 1));
const topicIndex = args.indexOf('--topic');
const CUSTOM_TOPIC = topicIndex >= 0 ? String(args[topicIndex + 1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The real shelves on the site — posts must link to THESE pages. */
const CATEGORY_BANK = [
  { name: 'Anime', slug: 'Anime' },
  { name: 'Gaming', slug: 'Gaming' },
  { name: 'Space & Cosmos', slug: 'Space & Cosmos' },
  { name: 'AMOLED & Dark', slug: 'AMOLED & Dark' },
  { name: 'Cyberpunk City', slug: 'Cyberpunk City' },
  { name: 'Fantasy Worlds', slug: 'Fantasy Worlds' },
  { name: 'Nature & Landscapes', slug: 'Nature' },
  { name: 'Cars & Machines / Abstract', slug: 'Cars' },
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
  'iPhone and Android wallpaper styles for {year}: how to choose',
  'Dark and light wallpapers: practical contrast choices for night setups',
  'How to match a wallpaper style with the look of your desk setup',
  '5 wallpaper styles that can give a desk setup a more polished look',
];

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

async function sbFetch(pathname, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${pathname}`, {
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

async function existingSlugs() {
  if (!LOCAL && SB_URL && SB_KEY) {
    const rows = await sbFetch('/posts?select=slug&order=published_at.desc&limit=1000');
    return rows.map((r) => r.slug);
  }
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
}

function buildPrompt(topic, taken) {
  const year = new Date().getFullYear();
  const categories = CATEGORY_BANK.map(
    (c) => `${c.name} → /search?category=${encodeURIComponent(c.slug)}`,
  ).join('\n  ');
  return `You are the editor of WALLORA, a wallpaper discovery website. Write ONE complete, publish-ready blog post as MARKDOWN.

TOPIC: "${topic.replace('{year}', year)}"

HARD REQUIREMENTS:
1. Output STRICT JSON only, no markdown fences:
{"title": "…≤60 chars, front-load main keyword", "description": "…≤160 chars, benefit-led meta description", "keywords": "8-12 comma-separated LONG-TAIL phrases", "category": "<one of: Anime|Gaming|Space & Cosmos|AMOLED & Dark|Cyberpunk City|Fantasy Worlds|Nature>", "markdown": "…the full post…"}

2. In "markdown":
   - 700–1100 words, friendly expert tone, NO fluff intro like "In today's digital world".
   - Structure: 1 strong intro paragraph (2-3 sentences), then 4-6 H2 sections (##), short paragraphs, bullet/numbered lists where useful.
   - Include 2–3 INTERNAL LINKS written in markdown, pointing to these real category pages (relative URLs, exactly as written):
  ${categories}
   Example: [browse the AMOLED & Dark collection](/search?category=AMOLED%20%26%20Dark)
   - Include 1 blockquote tip ("> Pro tip: …").
   - End with "## FAQ" containing 3 short Q&A formatted as "### Question?" + one-paragraph answers.
   - Do NOT include the H1 title in markdown (the page renders it).
   - Never fabricate statistics, current trend rankings, source quotas or product capabilities; use careful qualitative wording.
   - Do not claim image ownership, cost permissions, a license, copyright permission or commercial-use rights.
   - Do not embed remote images or raw HTML; the page supplies a reviewed cover separately.

3. Title must be unique — avoid slugs similar to: ${taken.length ? taken.slice(0, 40).join(', ') : '(none yet)'}
4. Never mention being AI, WALLORA-internal tooling, or anything meta. Write as the site's editorial voice.`;
}

async function gemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0.85, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (res.status === 503 || res.status === 529) throw new Error('TRANSIENT');
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

const OUTPUT_CATEGORIES = new Set(['Anime', 'Gaming', 'Space & Cosmos', 'AMOLED & Dark', 'Cyberpunk City', 'Fantasy Worlds', 'Nature']);
function cleanPost(value) {
  const title = String(value?.title ?? '').replace(/\s+/g, ' ').trim();
  const description = String(value?.description ?? '').replace(/\s+/g, ' ').trim();
  const keywords = String(value?.keywords ?? '').replace(/\s+/g, ' ').trim();
  const category = String(value?.category ?? '').trim();
  const markdown = String(value?.markdown ?? '').trim();
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
    throw new Error('Gemini returned an invalid/incomplete article. Nothing was saved.');
  }
  return { title, description, keywords, category, markdown };
}

(async () => {
  console.log(`✍️  WALLORA · AI Blog Writer (Gemini → ${LOCAL ? 'local demo markdown' : 'Supabase posts'})`);
  console.log('──────────────────────────────────────────────────────');
  if (!KEY) {
    console.error('❌ GEMINI_API_KEY missing — create a key at https://aistudio.google.com/apikey');
    process.exit(1);
  }
  if (!LOCAL && (!SB_URL || !SB_KEY)) {
    console.error('❌ Supabase env missing (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    console.error('   Posts MUST persist in Supabase on Vercel. For local file testing use --local.');
    process.exit(1);
  }
  if (!LOCAL) {
    try {
      const endpoint = new URL(SB_URL);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error();
    } catch {
      console.error('❌ NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS URL.');
      process.exit(1);
    }
  }
  if (LOCAL) fs.mkdirSync(POSTS_DIR, { recursive: true });

  const taken = await existingSlugs();
  const shuffled = TOPIC_BANK.sort(() => Math.random() - 0.5);
  const topics = CUSTOM_TOPIC
    ? [CUSTOM_TOPIC]
    : shuffled.filter((t) => !taken.some((s) => s.startsWith(slugify(t.replace('{year}', '')) .slice(0, 30)))).slice(0, COUNT);

  let saved = 0;
  const retries = new Map();
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    try {
      console.log(`\n📝 [${i + 1}/${topics.length}] "${topic.replace('{year}', new Date().getFullYear())}"`);
      const post = cleanPost(await gemini(buildPrompt(topic, taken)));
      const slug = slugify(post.title);
      if (!slug) throw new Error('Gemini returned an unusable title. Nothing was saved.');
      if (taken.includes(slug)) throw new Error('Gemini repeated an existing title. Nothing was overwritten.');

      const words = (post.markdown || '').split(/\s+/).length;
      console.log('   📰', post.title);
      console.log(`   📊 ~${words} words | category: ${post.category} | kw: ${(post.keywords || '').split(',').length} phrases`);

      if (!DRY) {
        if (LOCAL) {
          const md =
            `---\ntitle: "${post.title.replace(/"/g, '\\"')}"\ndescription: "${String(post.description).replace(/"/g, '\\"')}"\n` +
            `keywords: ${post.keywords}\ncategory: "${post.category || ''}"\ndate: ${new Date().toISOString().slice(0, 10)}\n` +
            `---\n\n${post.markdown.trim()}\n`;
          fs.writeFileSync(path.join(POSTS_DIR, `${slug}.md`), md);
          console.log(`   ✅ saved locally → content/posts/${slug}.md`);
        } else {
          await sbFetch('/posts', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              slug,
              title: String(post.title).slice(0, 140),
              description: String(post.description || '').slice(0, 300),
              keywords: String(post.keywords || '').slice(0, 500),
              category: post.category || null,
              content_markdown: post.markdown,
              status: 'pending',
              published_at: new Date().toISOString(),
            }),
          });
          console.log(`   ✅ saved to Supabase as PENDING → review & publish in Admin → Blog → /blog/${slug}`);
        }
        taken.push(slug);
        saved++;
      } else {
        console.log('   (dry — not saved)\n\n' + post.markdown.slice(0, 400) + '\n   …');
      }
      if (i + 1 < topics.length) await sleep(4500); // conservative pacing between calls
    } catch (e) {
      if (e.message === 'RATE_LIMIT' || e.message === 'TRANSIENT') {
        const attempts = retries.get(i) || 0;
        if (attempts < 2) {
          retries.set(i, attempts + 1);
          const wait = e.message === 'RATE_LIMIT' ? 65000 : 20000 + Math.random() * 10000;
          console.log(`   ⏳ gemini ${e.message.toLowerCase()} — bounded retry in ${Math.round(wait / 1000)}s…`);
          await sleep(wait);
          i--; // retry same topic
          continue;
        }
      }
      console.log(`   ✖ failed: ${e.message}`);
    }
  }
  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`✅ ${saved} new post(s) saved. Supabase posts are visible at /blog immediately; local files are demo/dev content.`);
})();
