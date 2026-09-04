import type { MetadataRoute } from 'next';
import { getAnonSupabase } from '@/lib/supabase';
import { siteUrl, wallHref } from '@/lib/seo';
import { isExcludedCategory, isExcludedWallpaper } from '@/lib/filters';

export const revalidate = 86400; // cached a day — Next regenerates in the background

const STORED_SOURCES = new Set(['nexwall', 'animepixels', 'wallhaven', 'manual']);
const validSourceId = (value: unknown) => /^[A-Za-z0-9_-]{1,100}$/.test(String(value ?? ''));

function validDate(value: string | null | undefined, fallback: Date): Date {
  const date = value ? new Date(value) : fallback;
  return Number.isFinite(date.getTime()) ? date : fallback;
}

/** XML sitemap — static pages, stored categories and stored wallpapers up to the protocol limit. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl('/'), lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: siteUrl('/categories'), lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: siteUrl('/blog'), lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: siteUrl('/about'), lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: siteUrl('/contact'), lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: siteUrl('/dmca'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: siteUrl('/privacy'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: siteUrl('/terms'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: siteUrl('/disclaimer'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Published DB posts when configured; bundled demo posts otherwise.
  try {
    const { listPosts } = await import('@/lib/blog');
    for (const p of await listPosts()) {
      if (entries.length >= 50_000) break;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) || p.slug.length > 80) continue;
      entries.push({
        url: siteUrl(`/blog/${p.slug}`),
        lastModified: validDate(p.date, now),
        changeFrequency: 'weekly',
        priority: 0.75,
      });
    }
  } catch {
    /* no posts dir yet */
  }

  // Categories come from the stored catalog only. A sitemap/build should never
  // spend a wallpaper-source API request.
  const sb = getAnonSupabase();
  if (sb) {
    try {
      const { data: categories } = await sb
        .from('categories')
        .select('source,name')
        .in('source', [...STORED_SOURCES])
        .order('wallpaper_count', { ascending: false });
      for (const category of categories ?? []) {
        if (entries.length >= 50_000) break;
        if (
          !STORED_SOURCES.has(String(category.source)) ||
          typeof category.name !== 'string' ||
          !category.name.trim() ||
          category.name.length > 80 ||
          isExcludedCategory(category.name)
        ) continue;
        entries.push({
          url: siteUrl(`/search?category=${encodeURIComponent(category.name)}`),
          lastModified: now,
          changeFrequency: 'daily',
          priority: 0.8,
        });
      }
    } catch {
      /* categories unavailable — skip */
    }
  }

  // Every stored wallpaper, up to the sitemap protocol's 50,000-URL ceiling.
  // Live-mode URLs remain discoverable through page links without source calls.
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
          entries.push({
            url: siteUrl(wallHref({ title: r.title, source: r.source, source_id: r.source_id, resolution: r.resolution })),
            lastModified: validDate(r.created_at, now),
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
