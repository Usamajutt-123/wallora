/**
 * WALLORA SEO engine — slugs, meta templates, JSON-LD.
 *
 * Slug format:  /wallpaper/{keyword-slug}-{src}-{source_id}
 *   e.g. /wallpaper/amoled-dark-6000x3383-wh-dg2lw1
 *
 * The source+id is EMBEDDED at the end of the slug, so any wallpaper
 * resolves in BOTH live and Supabase modes without a database lookup.
 * Legacy URLs  /wallpaper/{source}:{id}  301-redirect to the slug.
 */

import type { Wallpaper } from './types';
import { isLegacyWallpaperDescription, uniqueWallpaperDescription } from './wallpaper-copy';

const SHORT: Record<string, string> = { nexwall: 'nx', wallhaven: 'wh', animepixels: 'ap', manual: 'mn', demo: 'dm' };
const UNSHORT: Record<string, string> = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 52)
    .replace(/-+$/g, '');
}

type SlugInput = Pick<Wallpaper, 'title' | 'source_id' | 'resolution'> & { source: string };

/** Full SEO slug for a wallpaper (self-resolving, no DB needed). */
export function wallSlug(w: SlugInput): string {
  const base = slugify(w.title) || 'wallpaper';
  return `${base}-${SHORT[w.source] ?? 'dm'}-${w.source_id}`;
}

export function wallHref(w: SlugInput): string {
  return `/wallpaper/${wallSlug(w)}`;
}

/**
 * Parse a route param into { source, id, legacy }.
 * Accepts:  "nexwall:abc123" (legacy)  OR  "fantasy-worlds-4k-wh-lydkg2" (slug)
 */
export function parseWallParam(raw: string): { source: string; id: string; legacy: boolean } | null {
  let p: string;
  try {
    p = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  const legacy = p.match(/^([a-z]+):([A-Za-z0-9_-]{1,100})$/);
  if (legacy && UNSHORT[SHORT[legacy[1]] ?? ''] !== undefined) {
    return { source: legacy[1], id: legacy[2], legacy: true };
  }
  const m = p.match(/^.+-(nx|ap|wh|mn|dm)-([A-Za-z0-9_-]{1,100})$/);
  if (m) return { source: UNSHORT[m[1]], id: m[2], legacy: false };
  return null;
}

/* ------------------------------------------------------------------ */
/*  META TEMPLATES — used as fallback until Gemini-written copy exists */
/* ------------------------------------------------------------------ */

const DEVICE_KWS: Record<string, string[]> = {
  Gaming: ['gaming setup', 'pc desktop', 'ultrawide monitor'],
  'Space & Cosmos': ['galaxy lovers', 'desktop background', 'starry sky themes'],
  'AMOLED & Dark': ['amoled display', 'OLED phone', 'dark screen aesthetic'],
  'Cyberpunk City': ['neon aesthetic', 'futuristic vibe', 'sci-fi fans'],
  'Fantasy Worlds': ['fantasy art fans', 'dnd inspiration', 'mythical themes'],
  Anime: ['anime fans', 'otaku aesthetic', 'manga lovers'],
  Nature: ['nature scenery', 'desktop refresh', 'travel inspiration'],
};

function kwList(words: (string | null | undefined)[]): string[] {
  return [...new Set(words.filter((x): x is string => !!x && x.length > 1))];
}

/** Trim to a clean word boundary so meta titles never end mid-word. */
function cutAt(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s—–-]+$/, '');
}

export interface SeoCopy {
  title: string; // ≤ ~60 chars
  description: string; // ≤ ~160 chars
  keywords: string[]; // long-tail phrases
  alt: string;
}

/** Metadata-aware SEO copy. Custom/AI fields win; old boilerplate is replaced live. */
export function seoFor(w: Wallpaper): SeoCopy {
  const res = w.resolution ?? (w.width && w.height ? `${w.width}x${w.height}` : null);
  const longSide = Math.max(w.width ?? 0, w.height ?? 0);
  const shortSide = Math.min(w.width ?? 0, w.height ?? 0);
  const is4kPlus = longSide >= 3840 && shortSide >= 2160;
  const isHd = longSide >= 1280 && shortSide >= 720;
  const quality = is4kPlus ? '4K UHD' : isHd ? 'HD' : '';
  const cat = w.category ?? 'Aesthetic';
  const tags = (w.tags ?? '').split(/[,|]/).map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const customDescription = w.seo_description?.trim();

  const title = cutAt(w.seo_title?.trim() || `${w.title} - ${quality ? `${quality} ` : ''}${cat} Wallpaper`, 60);
  const description = cutAt(
    customDescription && !isLegacyWallpaperDescription(customDescription)
      ? customDescription
      : uniqueWallpaperDescription(w),
    160,
  );

  const base = w.title.toLowerCase();
  const generatedKeywords = kwList([
    `${base} wallpaper`,
    ...(quality ? [`${base} wallpaper ${is4kPlus ? '4k' : 'hd'}`] : []),
    ...(res ? [`${cat.toLowerCase()} wallpaper ${res}`] : []),
    `${cat.toLowerCase()} wallpaper image download`,
    `${cat.toLowerCase()} wallpaper for desktop`,
    `${cat.toLowerCase()} wallpaper for mobile`,
    ...tags.map((t) => `${t.toLowerCase()} wallpaper`),
    ...(DEVICE_KWS[cat] ?? []),
    'wallora wallpaper',
  ]).slice(0, 14);
  const customKeywords = (w.seo_keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean);

  return {
    title,
    description,
    keywords: customKeywords.length ? customKeywords : generatedKeywords,
    alt: w.seo_alt?.trim() || `${w.title} — ${quality ? `${quality} ` : ''}${cat} wallpaper${res ? ` in ${res}` : ''}`,
  };
}

/* ------------------------------------------------------------------ */

/** JSON-LD ImageObject — gives search engines structured image metadata. */
export function imageJsonLd(w: Wallpaper, pageUrl: string, thumbAbs: string, origAbs: string) {
  const seo = seoFor(w);
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name: seo.title,
    description: seo.description,
    url: pageUrl,
    contentUrl: origAbs,
    thumbnailUrl: thumbAbs,
    width: w.width ?? undefined,
    height: w.height ?? undefined,
    keywords: seo.keywords.join(', '),
    creditText: `Catalog source: ${w.source}`,
    ...(w.source_url ? { sameAs: w.source_url } : {}),
  };
}

export function siteOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.length > 2048) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.origin;
    } catch {
      /* try the next deployment-provided origin */
    }
  }
  return 'http://localhost:3000';
}

export function siteUrl(path = ''): string {
  const base = siteOrigin();
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
