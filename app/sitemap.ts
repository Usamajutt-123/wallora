import type { MetadataRoute } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import { getAnonSupabase } from '@/lib/supabase';
import { getCategories } from '@/lib/db';
import { siteUrl, wallHref } from '@/lib/seo';
import { isExcludedCategory, isExcludedWallpaper } from '@/lib/filters';

export const revalidate = 86400; // cached a day — Next regenerates in the background

const STORED_SOURCES = new Set(['nexwall', 'animepixels', 'wallhaven', 'manual']);
const validSourceId = (value: unknown) => /^[A-Za-z0-9_-]{1,100}$/.test(String(value ?? ''));

/**
 * Stable "deploy date" for URLs that have no better timestamp (static pages,
 * category shelves). Derived from a committed file's mtime (≈ the git
 * checkout time at build), so it is IDENTICAL across requests and only moves
 * on a new deploy. `new Date()` at request time is never used — Google
 * ignores sitemaps whose lastmod changes on every fetch.
 */
let buildDateCache: Date | null = null;
function buildDate(): Date {
  if (!buildDateCache) {
    let date = new Date('2026-09-01T00:00:00.000Z');
    try {
      const mtime = fs.statSync(path.join(process.cwd(), 'package.json')).mtime;
      if (Number.isFinite(mtime.getTime())) date = mtime;
    } catch {
      /* keep the fixed fallback */
    }
    buildDateCache = date;
  }
  return buildDateCache;
}

function validDate(value: string | null | undefined, fallback: Date): Date {
  const date = value ? new Date(value) : fallback;
  return Number.isFinite(date.getTime()) ? date : fallback;
}

/**
 * XML sitemap — static pages, stored categories and stored wallpapers up to
 * the protocol limit. URLs are deduped by <loc> (a Set), so one category can
 * never appear twice even if two sources advertise the same name.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const deployed = buildDate();
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  const push = (entry: MetadataRoute.Sitemap[number]) => {
    if (entries.length >= 50_000 || seen.has(entry.url)) return;
    seen.add(entry.url);
    entries.push(entry);
  };

  push({ url: siteUrl('/'), lastModified: deployed, changeFrequency: 'hourly', priority: 1 });
  push({ url: siteUrl('/categories'), lastModified: deployed, changeFrequency: 'daily', priority: 0.9 });
  // The blog publishes daily, so crawlers are asked back every day.
  push({ url: siteUrl('/blog'), lastModified: deployed, changeFrequency: 'daily', priority: 0.8 });
  push({ url: siteUrl('/about'), lastModified: deployed, changeFrequency: 'yearly', priority: 0.4 });
  push({ url: siteUrl('/contact'), lastModified: deployed, changeFrequency: 'yearly', priority: 0.4 });
  push({ url: siteUrl('/dmca'), lastModified: deployed, changeFrequency: 'yearly', priority: 0.3 });
  push({ url: siteUrl('/privacy'), lastModified: deployed, changeFrequency: 'yearly', priority: 0.3 });
  push({ url: siteUrl('/terms'), lastModified: deployed, changeFrequency: 'yearly', priority: 0.3 });
  push({ url: siteUrl('/disclaimer'), lastModified: deployed, changeFrequency: 'yearly', priority: 0.3 });

  // Published DB posts when configured; bundled demo posts otherwise.
  try {
    const { listPosts } = await import('@/lib/blog');
    for (const p of await listPosts()) {
      if (entries.length >= 50_000) break;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) || p.slug.length > 80) continue;
      push({
        url: siteUrl(`/blog/${p.slug}`),
        lastModified: validDate(p.date, deployed),
        changeFrequency: 'weekly',
        priority: 0.75,
      });
    }
  } catch {
    /* no posts dir yet */
  }

  // Categories come from the SAME aggregation the /categories page renders
  // (getCategories): every listed shelf really has wallpapers, names are the
  // canonical spellings, and page links and sitemap URLs can never drift
  // apart (orphan-category fix — audit §3). A sitemap/build must never spend
  // a wallpaper-source API request; getCategories() is cache-backed.
  try {
    for (const category of await getCategories()) {
      if (entries.length >= 50_000) break;
      const name = String(category.name ?? '').trim();
      if (!name || name.length > 80 || isExcludedCategory(name)) continue;
      push({
        url: siteUrl(`/search?category=${encodeURIComponent(name)}`),
        lastModified: deployed,
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
  } catch {
    /* categories unavailable — wallpapers below still ship */
  }

  // Every stored wallpaper, up to the sitemap protocol's 50,000-URL ceiling.
  // Live-mode URLs remain discoverable through page links without source calls.
  const sb = getAnonSupabase();
  if (sb) {
    try {
      const batchSize = 1000;
      let start = 0;
      while (entries.length < 50_000 && start < 50_000) {
        const take = Math.min(batchSize, 50_000 - entries.length);
        const { data, error } = await sb
          .from('wallpapers')
          .select('source, source_id, title, category, tags, resolution, created_at')
          .in('source', [...STORED_SOURCES])
          .order('created_at', { ascending: false })
          .order('source', { ascending: true })
          .order('source_id', { ascending: true })
          .range(start, start + take - 1);
        if (error) break;
        for (const r of data ?? []) {
          if (entries.length >= 50_000) break;
          if (!STORED_SOURCES.has(String(r.source)) || !validSourceId(r.source_id) || isExcludedWallpaper(r)) continue;
          push({
            url: siteUrl(wallHref({ title: r.title, source: r.source, source_id: r.source_id, resolution: r.resolution })),
            lastModified: validDate(r.created_at, deployed),
            changeFrequency: 'weekly',
            priority: 0.7,
          });
        }
        start += take;
        if (!data || data.length < take) break;
      }
    } catch {
      /* db offline — static + category URLs still ship */
    }
  }
  return entries.slice(0, 50_000);
}
