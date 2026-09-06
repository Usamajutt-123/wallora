import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import { fetchNexwallCategories, fetchNexwallWallpapers, nexwallConfigured } from '@/lib/nexwall';
import { fetchAnimePixels } from '@/lib/animepixels';
import { fetchWallhavenSearch, withShelf, WH_SHELVES } from '@/lib/wallhaven';
import { filterCategories, filterWallpapers } from '@/lib/filters';
import { mirrorWallsToImgBB, mirrorConfigured } from '@/lib/imgbb';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel hobby ceiling

// A manual sync is still a publish operation. PostgreSQL atomically reserves
// at most 15 new rows per source / 45 total for each Pakistan-local day, so
// repeated clicks or concurrent requests cannot turn it into a bulk dump.
const SOURCE_CAP = 15;

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const sb = getServiceSupabase();
  if (!sb) {
    return NextResponse.json(
      { ok: false, error: 'Supabase is not configured yet — add your keys to .env.local first.' },
      { status: 400 },
    );
  }

  const log: string[] = [];
  const inserted = { nexwall: 0, animepixels: 0, wallhaven: 0 };
  const insertedRows: { source: string; source_id: string; image_url: string }[] = [];
  const pkt = new Date(Date.now() + 5 * 3_600_000);
  const pktDate = pkt.toISOString().slice(0, 10);
  const nextPktDate = new Date(pkt.getTime() + 86_400_000).toISOString().slice(0, 10);
  const { data: reservations, error: reservationReadError } = await sb
    .from('sync_runs')
    .select('source,inserted')
    .like('source', 'manual-sync:%')
    .gte('created_at', `${pktDate}T00:00:00+05:00`)
    .lt('created_at', `${nextPktDate}T00:00:00+05:00`);
  if (reservationReadError) {
    return NextResponse.json({ ok: false, error: `Sync-cap check failed: ${reservationReadError.message}` }, { status: 503 });
  }
  const used = { nexwall: 0, animepixels: 0, wallhaven: 0 };
  for (const row of reservations ?? []) {
    const source = String(row.source).replace('manual-sync:', '') as keyof typeof used;
    if (source in used) used[source] += Math.max(0, Number(row.inserted) || 0);
  }
  const remaining = {
    nexwall: Math.max(0, SOURCE_CAP - used.nexwall),
    animepixels: Math.max(0, SOURCE_CAP - used.animepixels),
    wallhaven: Math.max(0, SOURCE_CAP - used.wallhaven),
  };

  const reserveFresh = async (source: keyof typeof inserted, rows: Record<string, unknown>[]) => {
    if (!rows.length || remaining[source] <= 0) return [];
    const seen = new Set<string>();
    const uniqueRows = rows.filter((row) => {
      const id = String(row.source_id ?? '');
      if (row.source !== source || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const ids = [...seen];
    if (!ids.length) return [];
    const { data: existing, error: existingError } = await sb
      .from('wallpapers')
      .select('source_id')
      .eq('source', source)
      .in('source_id', ids);
    if (existingError) throw new Error(`existing-ID check failed: ${existingError.message}`);
    const taken = new Set((existing ?? []).map((row) => String(row.source_id)));
    const fresh = uniqueRows.filter((row) => !taken.has(String(row.source_id))).slice(0, remaining[source]);
    if (!fresh.length) return [];
    const { data: granted, error: claimError } = await sb.rpc('claim_manual_sync_slots', {
      p_source: source,
      p_requested: fresh.length,
    });
    if (claimError) throw new Error(`daily-cap reservation failed (run the audited v6 SQL): ${claimError.message}`);
    const count = Math.max(0, Math.min(fresh.length, Number(granted) || 0));
    remaining[source] = Math.max(0, remaining[source] - count);
    return fresh.slice(0, count);
  };

  const upsertWalls = async (rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await sb.from('wallpapers').upsert(chunk, { onConflict: 'source,source_id' });
      if (error) throw new Error(`DB upsert failed: ${error.message}`);
    }
  };

  const recordRun = (source: string, count: number, note: string) =>
    sb.from('sync_runs').insert({ source: `manual-result:${source}`, inserted: count, note }).then(() => {});

  /* ------------------------------ NexWall ------------------------------ */
  if (nexwallConfigured() && remaining.nexwall > 0) {
    try {
      const cats = await fetchNexwallCategories();
      const visibleCats = filterCategories(cats);
      const hiddenCats = cats.length - visibleCats.length;
      if (visibleCats.length) {
        const { error } = await sb.from('categories').upsert(visibleCats, { onConflict: 'source,source_id' });
        if (error) throw new Error(`categories upsert: ${error.message}`);
        log.push(
          `✦ NexWall: ${visibleCats.length} categories synced${hiddenCats ? ` (${hiddenCats} hidden by content filter)` : ''}`,
        );
      }

      const r = await fetchNexwallWallpapers({ page: 1, perPage: 50, sort: 'newest' });
      const filtered = filterWallpapers(r.items);
      const kept = await reserveFresh('nexwall', filtered as unknown as Record<string, unknown>[]);
      const skipped = r.items.length - filtered.length;
      if (kept.length) {
        await upsertWalls(kept);
        for (const w of kept) insertedRows.push({ source: String(w.source), source_id: String(w.source_id), image_url: String((w as { image_url?: string }).image_url ?? '') });
      }
      inserted.nexwall = kept.length;
      log.push(
        `✦ NexWall page 1/${r.last} → ${kept.length} saved${skipped ? `, ${skipped} filtered out` : ''} (quota left today: ${r.remaining ?? '?'})`,
      );
      const rem = r.remaining != null ? Number(r.remaining) : null;
      if (rem !== null && rem <= 5) log.push('⏸ NexWall reports few requests remaining; keep further syncs paused.');
      await recordRun('nexwall', inserted.nexwall, `${inserted.nexwall} walls from one bounded page`);
    } catch (e) {
      log.push(`✖ NexWall sync stopped: ${e instanceof Error ? e.message : 'unknown error'}`);
      await recordRun('nexwall', inserted.nexwall, `error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  } else {
    log.push(
      nexwallConfigured()
        ? '… NexWall skipped — today’s 15-row manual-sync allowance is already reserved'
        : '… NexWall skipped — NEXWALL_API_KEY not set',
    );
  }

  /* ---------------------------- AnimePixels ------------------------------ */
  if (remaining.animepixels > 0) try {
    const catCounts = new Map<string, { count: number; cover: string }>();
    const animePage = (new Date().getUTCDate() % 6) + 1;
    const r = await fetchAnimePixels({ page: animePage, perPage: 100 });
    const candidates = filterWallpapers(r.items);
    const kept = (await reserveFresh(
      'animepixels',
      candidates as unknown as Record<string, unknown>[],
    )) as unknown as typeof candidates;
    for (const w of kept) {
      if (!w.category) continue;
      const cur = catCounts.get(w.category);
      if (cur) cur.count++;
      else catCounts.set(w.category, { count: 1, cover: w.thumb_url });
    }
    if (kept.length) {
      await upsertWalls(kept as unknown as Record<string, unknown>[]);
      for (const w of kept) insertedRows.push({ source: String(w.source), source_id: String(w.source_id), image_url: String((w as { image_url?: string }).image_url ?? '') });
    }
    inserted.animepixels = kept.length;
    log.push(`✦ AnimePixels page ${animePage} → ${kept.length} anime wallpapers`);
    if (catCounts.size) {
      const firstCover = catCounts.values().next().value?.cover ?? null;
      await sb.from('categories').upsert(
        [
          // umbrella "Anime" row so synced libraries expose the whole anime shelf
          { source: 'animepixels', source_id: '__all', name: 'Anime', slug: 'anime', cover_url: firstCover, wallpaper_count: inserted.animepixels },
          ...[...catCounts.entries()].map(([name, v]) => ({
            source: 'animepixels',
            source_id: name,
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            cover_url: v.cover,
            wallpaper_count: v.count,
          })),
        ],
        { onConflict: 'source,source_id' },
      );
    }
    await recordRun('animepixels', inserted.animepixels, `${inserted.animepixels} anime walls, ${catCounts.size} franchises`);
  } catch (e) {
    log.push(`✖ AnimePixels sync stopped: ${e instanceof Error ? e.message : 'unknown error'}`);
    await recordRun('animepixels', inserted.animepixels, `error: ${e instanceof Error ? e.message : 'unknown'}`);
  } else {
    log.push('… AnimePixels skipped — today’s 15-row manual-sync allowance is already reserved');
  }

  /* ---------------- Wallhaven curated shelves (SFW toplist) ---------------- */
  if (remaining.wallhaven > 0) try {
    const start = new Date().getUTCDate() % WH_SHELVES.length;
    for (let offset = 0; offset < WH_SHELVES.length && remaining.wallhaven > 0; offset++) {
      const shelf = WH_SHELVES[(start + offset) % WH_SHELVES.length];
      const r = await fetchWallhavenSearch({ q: shelf.query, page: 1 });
      if (!r.items.length) continue;
      const candidates = filterWallpapers(withShelf(r.items, shelf.name));
      const kept = await reserveFresh('wallhaven', candidates as unknown as Record<string, unknown>[]);
      if (kept.length) {
        await upsertWalls(kept);
        for (const w of kept) insertedRows.push({ source: String(w.source), source_id: String(w.source_id), image_url: String((w as { image_url?: string }).image_url ?? '') });
      }
      inserted.wallhaven += kept.length;
      log.push(`✦ Wallhaven "${shelf.name}" page 1 → ${kept.length} walls (attribution links kept)`);
    }
    // shelf categories
    await sb.from('categories').upsert(
      WH_SHELVES.map((s) => ({
        source: 'wallhaven',
        source_id: s.slug,
        name: s.name,
        slug: s.slug,
        cover_url: null,
        wallpaper_count: 0,
      })),
      { onConflict: 'source,source_id' },
    );
    await recordRun('wallhaven', inserted.wallhaven, `${inserted.wallhaven} walls across ${WH_SHELVES.length} shelves`);
  } catch (e) {
    log.push(`✖ Wallhaven sync stopped: ${e instanceof Error ? e.message : 'unknown error'}`);
    await recordRun('wallhaven', inserted.wallhaven, `error: ${e instanceof Error ? e.message : 'unknown'}`);
  } else {
    log.push('… Wallhaven skipped — today’s 15-row manual-sync allowance is already reserved');
  }

  // NOTE: Wallhaven runs in SAFE MODE — SFW purity, toplist only, curated queries,
  // and every row keeps a source_url attribution link back to the original post.

  const { error: statsError } = await sb.rpc('refresh_site_stats');
  if (statsError) log.push(`⚠ Stats refresh skipped: ${statsError.message}`);

  // 🖼 Best-effort permanent mirror of the rows this sync just published.
  // Cloudinary is preferred; ImgBB is used only when Cloudinary is absent.
  // Mirror problems are logged, never fatal — the catalog is already saved.
  if (mirrorConfigured() && insertedRows.length) {
    try {
      const mirror = await mirrorWallsToImgBB(insertedRows);
      log.push(`🖼 Image mirror: ${mirror.note}`);
    } catch (e) {
      log.push(`🖼 Image mirror skipped: ${e instanceof Error ? e.message.slice(0, 90) : 'err'}`);
    }
  }

  log.push(`✔ Done — ${inserted.nexwall + inserted.animepixels + inserted.wallhaven} new wallpaper slots saved to Supabase`);
  return NextResponse.json({ ok: true, log, inserted });
}
