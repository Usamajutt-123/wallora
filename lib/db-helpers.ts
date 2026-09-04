import type { Wallpaper } from './types';

/** Loose row → minimal Wallpaper (enough for slugs/SEO/pins) without touching db.ts internals. */
export function rowToSearchable(r: {
  source: string; source_id: string; title: string; image_url: string;
  category?: string | null; tags?: string | null; resolution?: string | null;
  width?: number | null; height?: number | null;
}): Wallpaper {
  return {
    id: `${r.source}:${r.source_id}`,
    source: r.source as Wallpaper['source'],
    source_id: r.source_id,
    title: r.title,
    image_url: r.image_url,
    thumb_url: r.image_url,
    category: r.category ?? null,
    tags: r.tags ?? null,
    is_premium: false,
    is_featured: false,
    views: 0,
    downloads: 0,
    created_at: new Date().toISOString(),
    width: r.width ?? 0,
    height: r.height ?? 0,
    resolution: r.resolution ?? null,
  };
}
