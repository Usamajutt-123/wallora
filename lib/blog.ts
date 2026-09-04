/**
 * WALLORA Blog — Supabase-first storage, markdown.
 *
 * Posts live in the Supabase `posts` table so they persist on Vercel
 * serverless (its filesystem is read-only; files would vanish).
 * Local markdown files in content/posts/ remain as a FALLBACK so the
 * blog still renders before Supabase is connected.
 *
 * One-time SQL for the `posts` table:
 *
 *   create table if not exists posts (
 *     id               uuid primary key default gen_random_uuid(),
 *     slug             text unique not null,
 *     title            text not null,
 *     description      text,
 *     keywords         text,
 *     category         text,
 *     content_markdown text not null,
 *     cover_url        text,
 *     status           text not null default 'published', -- published | draft
 *     published_at     timestamptz not null default now()
 *   );
 *   create index if not exists posts_pub_idx on posts (published_at desc);
 *   alter table posts enable row level security;
 *   create policy "public reads published" on posts
 *     for select using (status = 'published');
 */

import fs from 'node:fs';
import path from 'node:path';
import { marked, type RendererObject } from 'marked';
import { getAnonSupabase, isSupabaseConfigured } from './supabase';
import { isHardBlockedWallpaper } from './filters';

const POSTS_DIR = path.join(process.cwd(), 'content', 'posts');
const validPostSlug = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  category: string | null;
  date: string; // ISO
  readTime: number; // minutes
  excerpt: string;
  cover_url: string | null;
  /** Extra images shown as a gallery (and available to insert inline). */
  images: string[];
}

export interface Post extends PostMeta {
  html: string;
}

/* ------------------------------ markdown -------------------------------- */

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeContentUrl(value: string, image = false): string | null {
  const href = value.trim();
  if (href.startsWith('//') || href.includes('\\')) return null;
  if (href.startsWith('/') || (!image && href.startsWith('#'))) return href;
  try {
    const url = new URL(href);
    if (url.username || url.password) return null;
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Hosts that carry WALLORA's own images (ImgBB mirrors + catalog CDNs). */
const TRUSTED_IMAGE_HOSTS = ['i.ibb.co', 'ibb.co', 'wallhaven.cc', 'kodnextech.com', 'nexwall.app', 'nexwallcdn.com', 'res.cloudinary.com', 'anima-image-api.vercel.app'];

export function isTrustedImageHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return TRUSTED_IMAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const renderer: RendererObject = {
  // Raw HTML is unnecessary in generated/manual posts and unsafe in public output.
  html() {
    return '';
  },
  link({ href, text }) {
    const safe = safeContentUrl(href);
    if (!safe) return text;
    const external = /^https?:\/\//.test(safe);
    const attrs = external ? ' target="_blank" rel="nofollow noopener noreferrer"' : '';
    return `<a href="${attr(safe)}"${attrs}>${text}</a>`;
  },
  // Inline images are allowed ONLY from hosts that host WALLORA's own mirror /
  // catalog images (ImgBB, Wallhaven CDN, NexWall CDN, Cloudinary). This keeps
  // remote content limited to already-curated sources; the uploaded blog media
  // goes through the same ImgBB uploader as wallpapers.
  image({ href, text }) {
    const safe = safeContentUrl(String(href ?? ''), true);
    if (!safe || !isTrustedImageHost(safe)) return text || '';
    const alt = attr((text || '').replace(/[*_]/g, '').trim().slice(0, 160));
    return `<img src="${attr(safe)}" alt="${alt}" loading="lazy" decoding="async" />`;
  },
  heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const id = text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  },
};

marked.use({ renderer, gfm: true, breaks: false });

function mdToHtml(md: string): string {
  const html = marked.parse(md || '', { async: false }) as string;
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on\w+="[^"]*"/gi, '');
}

function safeCoverUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/* ------------------------------ helpers ---------------------------------- */

/** Map a stored images column (array or comma string) to safe trusted-host URLs. */
function listImageUrls(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',').map((s) => s.trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const url = safeCoverUrl(String(item ?? '').trim());
    if (!url || !isTrustedImageHost(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 40) break;
  }
  return out;
}

function metaOf(slug: string, m: { title?: string; description?: string; keywords?: string; category?: string; date?: string; cover_url?: string | null; images?: unknown }, body: string): PostMeta {
  const words = body.replace(/[#>*`[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;
  const firstPara = body.split(/\n\n+/).find((p) => p.trim() && !p.trim().startsWith('#')) ?? '';
  return {
    slug,
    title: m.title || slug.replace(/-/g, ' '),
    description: (m.description || '').slice(0, 170),
    keywords: (m.keywords || '').split(',').map((k) => k.trim()).filter(Boolean),
    category: m.category || null,
    date: m.date || new Date().toISOString(),
    readTime: Math.max(1, Math.round(words / 200)),
    excerpt: firstPara.replace(/[*_`[\]()]/g, '').trim().slice(0, 160),
    cover_url: safeCoverUrl(m.cover_url),
    images: listImageUrls(m.images),
  };
}

/* ------------------------------ files (fallback) ------------------------- */

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta, body: raw };
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: m[2] };
}

function listFilePosts(): PostMeta[] {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      return { post: metaOf(f.replace(/\.md$/, ''), meta, body), draft: meta.draft === 'true' };
    })
    .filter((p) => !p.draft)
    .map((p) => p.post);
}

function getFilePost(slug: string): Post | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const file = path.join(POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (meta.draft === 'true') return null;
  return { ...metaOf(slug, meta, body), html: mdToHtml(body) };
}

/* -------------------------------- Supabase -------------------------------- */

interface PostRow {
  slug: string;
  title: string;
  description: string | null;
  keywords: string | null;
  category: string | null;
  content_markdown: string;
  cover_url: string | null;
  published_at: string;
  images?: unknown;
}

function rowMeta(r: PostRow): PostMeta {
  const blockedCover = isHardBlockedWallpaper({ title: r.title, category: r.category, tags: r.keywords });
  return metaOf(
    r.slug,
    {
      title: r.title,
      description: r.description ?? '',
      keywords: r.keywords ?? '',
      category: r.category ?? undefined,
      date: r.published_at,
      cover_url: blockedCover ? null : r.cover_url,
      images: r.images,
    },
    r.content_markdown,
  );
}

async function sbListPublished(): Promise<PostMeta[]> {
  const sb = getAnonSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('posts')
      .select('slug,title,description,keywords,category,content_markdown,cover_url,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(100);
    if (error) return [];
    return (data ?? [])
      .filter((r) => validPostSlug(r.slug) && typeof r.title === 'string' && typeof r.content_markdown === 'string')
      .map((r) => rowMeta(r as PostRow));
  } catch {
    return [];
  }
}

async function sbGetPost(slug: string): Promise<Post | null> {
  if (!validPostSlug(slug)) return null;
  const sb = getAnonSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('posts')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    if (error || !data) return null;
    const r = data as PostRow;
    return { ...rowMeta(r), html: mdToHtml(r.content_markdown) };
  } catch {
    return null;
  }
}

/* --------------------------------- API ------------------------------------ */

/** Supabase is authoritative once configured; bundled files are demo-only. */
export async function listPosts(): Promise<PostMeta[]> {
  if (isSupabaseConfigured()) return sbListPublished();
  return listFilePosts().sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Single post — never revive a deleted/draft DB post from a bundled file. */
export async function getPost(slug: string): Promise<Post | null> {
  return isSupabaseConfigured() ? sbGetPost(slug) : getFilePost(slug);
}

/** Sync, files-only list — for generateStaticParams (build-time fallback). */
export function listFsPosts(): PostMeta[] {
  return listFilePosts().sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ------------------- related-guide lookup (SEO internal links) ---------------- */

export interface GuidePost {
  slug: string;
  title: string;
  description: string;
  cover_url: string | null;
  date: string;
}

/** Latest PUBLISHED guide whose category matches the wallpaper's category.
 *  Wallpaper pages use it to link to the relevant blog (contextual internal
 *  link → helps the guide rank and reinforces the page's topical relevance).
 *  Only exact stored-category matches are returned; nothing is ever forced. */
async function sbGuidePost(category: string): Promise<GuidePost | null> {
  const sb = getAnonSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('posts')
      .select('slug,title,description,cover_url,published_at')
      .eq('status', 'published')
      .eq('category', category)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as { slug: string; title: string; description: string | null; cover_url: string | null; published_at: string };
    if (!validPostSlug(r.slug) || !r.title || !r.title.trim()) return null;
    return {
      slug: r.slug,
      title: r.title.trim().slice(0, 140),
      description: (r.description ?? '').trim().slice(0, 170),
      cover_url: safeCoverUrl(r.cover_url),
      date: r.published_at,
    };
  } catch {
    return null;
  }
}

/** File fallback (demo/local): newest non-draft post of that category. */
function fileGuidePost(category: string): GuidePost | null {
  const match = listFilePosts()
    .filter((p) => p.category && p.category.trim().toLowerCase() === category.trim().toLowerCase())
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!match) return null;
  return {
    slug: match.slug,
    title: match.title,
    description: match.description,
    cover_url: match.cover_url,
    date: match.date,
  };
}

export async function getGuidePost(category: string | null | undefined): Promise<GuidePost | null> {
  const cat = String(category ?? '').trim().slice(0, 80);
  if (!cat) return null;
  return isSupabaseConfigured() ? sbGuidePost(cat) : fileGuidePost(cat);
}
