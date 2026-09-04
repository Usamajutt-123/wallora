import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { isLegacyWallpaperDescription, uniqueWallpaperDescription, type WallpaperCopyInput } from '@/lib/wallpaper-copy';
import { getServiceSupabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fill missing/old boilerplate descriptions from existing DB metadata.
 * This only talks to Supabase; it never calls NexWall, AnimePixels, Wallhaven or AI.
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { limit?: number; overwrite?: boolean };
  const limit = Math.min(5000, Math.max(1, Math.floor(Number(body.limit) || 2000)));
  const overwrite = body.overwrite === true;
  const pageSize = 400;
  let scanned = 0;
  let updated = 0;

  while (scanned < limit) {
    const take = Math.min(pageSize, limit - scanned);
    const { data, error } = await sb
      .from('wallpapers')
      .select('*')
      .in('source', ['nexwall', 'animepixels', 'wallhaven'])
      .order('id', { ascending: true })
      .range(scanned, scanned + take - 1);
    if (error) return NextResponse.json({ ok: false, error: error.message, scanned, updated }, { status: 500 });
    const rows = data ?? [];
    if (!rows.length) break;

    const changed = rows
      .filter((row: Record<string, unknown>) => {
        const current = String(row.seo_description ?? '').trim();
        return overwrite || !current || isLegacyWallpaperDescription(current);
      })
      .map((row: Record<string, unknown>) => ({
        source: String(row.source ?? ''),
        source_id: String(row.source_id ?? ''),
        seo_description: uniqueWallpaperDescription(row as WallpaperCopyInput),
      }));

    for (let i = 0; i < changed.length; i += 100) {
      const chunk = changed.slice(i, i + 100);
      const { data: applied, error: writeError } = await sb.rpc('apply_wallpaper_descriptions', { p_updates: chunk });
      if (writeError) {
        const message = writeError.code === '23505'
          ? 'Generated descriptions collided with existing copy; no rows in this chunk were changed.'
          : writeError.message;
        return NextResponse.json({ ok: false, error: message, scanned, updated }, { status: 500 });
      }
      updated += Number(applied) || 0;
    }

    scanned += rows.length;
    if (rows.length < take) break;
  }

  revalidatePath('/');
  revalidatePath('/search');
  revalidatePath('/sitemap.xml');
  return NextResponse.json({ ok: true, scanned, updated, preserved: scanned - updated });
}
