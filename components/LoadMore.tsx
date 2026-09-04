'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Wallpaper } from '@/lib/types';
import type { AdSlotConfig } from '@/lib/ads';
import WallCard from './WallCard';
import AdSlot from './ads/AdSlot';

interface Props {
  initialPage: number;
  lastPage: number;
  search?: string;
  category?: string;
  sort?: string;
  ad?: AdSlotConfig;
  initialCount?: number; // exact rendered count before infinite-scroll items
}

const WALLPAPER_ID = /^(nexwall|animepixels|wallhaven|manual|demo):([A-Za-z0-9_-]{1,100})$/;

function validHttps(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validWallpaper(value: unknown): value is Wallpaper {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const match = id.match(WALLPAPER_ID);
  if (!match || item.source !== match[1] || item.source_id !== match[2]) return false;
  if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 140) return false;
  if (!validHttps(item.image_url) || !validHttps(item.thumb_url)) return false;
  if (item.category !== null && item.category !== undefined && (typeof item.category !== 'string' || item.category.length > 80)) return false;
  if (item.resolution !== null && item.resolution !== undefined &&
      (typeof item.resolution !== 'string' || item.resolution.length > 40)) return false;
  for (const key of ['width', 'height', 'views', 'downloads'] as const) {
    if (typeof item[key] !== 'number' || !Number.isSafeInteger(item[key]) || item[key] < 0) return false;
    if ((key === 'width' || key === 'height') && item[key] > 20000) return false;
  }
  if (item.tags !== null && item.tags !== undefined && (typeof item.tags !== 'string' || item.tags.length > 500)) return false;
  if (item.source_url !== null && item.source_url !== undefined && !validHttps(item.source_url)) return false;
  if (typeof item.created_at !== 'string' || item.created_at.length > 40 || !Number.isFinite(Date.parse(item.created_at))) return false;
  return typeof item.is_featured === 'boolean' && typeof item.is_premium === 'boolean';
}

/** IntersectionObserver-driven infinite scroll — appends fetched pages below the SSR grid. */
export default function LoadMore({ initialPage, lastPage, search, category, sort, ad, initialCount = 30 }: Props) {
  const [pages, setPages] = useState<Wallpaper[][]>([]);
  const [page, setPage] = useState(initialPage);
  const [done, setDone] = useState(initialPage >= lastPage);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current || done) return;
    busy.current = true;
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page + 1), perPage: '30' });
      if (search) p.set('search', search);
      if (category) p.set('category', category);
      if (sort) p.set('sort', sort);
      const res = await fetch(`/api/wallpapers?${p.toString()}`);
      if (!res.ok) throw new Error('feed request failed');
      const data = await res.json();
      const items = Array.isArray(data?.data) ? data.data.filter(validWallpaper).slice(0, 50) : [];
      const nextPage = Number.isFinite(Number(data?.page))
        ? Math.min(10_000, Math.max(page + 1, Math.floor(Number(data.page))))
        : page + 1;
      const remoteLastPage = Number.isFinite(Number(data?.lastPage))
        ? Math.min(10_000, Math.max(1, Math.floor(Number(data.lastPage))))
        : nextPage;
      setPages((prev) => [...prev, items]);
      setPage(nextPage);
      if (nextPage >= remoteLastPage || !items.length) setDone(true);
    } catch {
      setDone(true);
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }, [page, done, search, category, sort]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && load(), {
      rootMargin: '700px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  const loaded = pages.flat();
  const chunks: { items: Wallpaper[]; adAfter: boolean }[] = [];
  let cursor = 0;
  let rendered = initialCount;
  while (cursor < loaded.length) {
    const untilAd = rendered % 30 === 0 ? 30 : 30 - (rendered % 30);
    const items = loaded.slice(cursor, cursor + untilAd);
    cursor += items.length;
    rendered += items.length;
    chunks.push({ items, adAfter: rendered % 30 === 0 });
  }

  return (
    <>
      {chunks.map((chunk, index) => (
        <div key={`${index}-${chunk.items[0]?.id ?? 'empty'}`}>
          <div className="masonry columns-2 sm:columns-3 lg:columns-4 2xl:columns-5" style={{ marginTop: 0 }}>
            {chunk.items.map((wallpaper) => (
              <WallCard key={wallpaper.id} w={wallpaper} />
            ))}
          </div>
          {chunk.adAfter && ad && (
            <div className="mt-6 mb-2">
              <AdSlot id="feed-inline" config={ad} />
            </div>
          )}
        </div>
      ))}

      {!done && (
        <div ref={sentinel} className="flex justify-center py-10">
          {loading ? (
            <div className="flex items-center gap-3 text-white/50 text-sm">
              <span className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Loading more walls…
            </div>
          ) : (
            <button
              onClick={load}
              className="glass rounded-full px-6 py-2.5 text-sm text-white/70 hover:text-white hover:border-accent/50 transition"
            >
              Load more
            </button>
          )}
        </div>
      )}

      {done && (pages.length > 0 || initialPage >= lastPage) && (
        <p className="py-10 text-center text-white/30 text-sm font-display tracking-[0.25em]">
          ✦ YOU&apos;VE SEEN IT ALL ✦
        </p>
      )}
    </>
  );
}
