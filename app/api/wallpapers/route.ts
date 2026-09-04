import { getWallpapers } from '@/lib/db';
import type { SortMode } from '@/lib/types';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const sort = p.get('sort');
  try {
    const feed = await getWallpapers({
      page: Math.min(10_000, Math.max(1, Math.floor(Number(p.get('page')) || 1))),
      perPage: Math.min(50, Math.max(1, Math.floor(Number(p.get('perPage')) || 24))),
      category: p.get('category')?.trim().slice(0, 80) || undefined,
      search: p.get('search')?.trim().slice(0, 120) || undefined,
      sort: (['newest', 'popular', 'random'].includes(sort ?? '') ? sort : 'newest') as SortMode,
    });
    return NextResponse.json(feed, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch {
    // quota / network hiccup — let the client stop gracefully instead of erroring
    return NextResponse.json({ data: [], page: 1, lastPage: 1, total: 0 });
  }
}
