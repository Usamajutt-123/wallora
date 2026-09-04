import { getServiceSupabase } from '@/lib/supabase';
import { fetchNexwallWallpapers, nexwallConfigured } from '@/lib/nexwall';
import { fetchAnimePixels } from '@/lib/animepixels';
import { fetchWallhavenSearch, withShelf, WH_SHELVES } from '@/lib/wallhaven';
import { filterWallpapers } from '@/lib/filters';
import { mirrorWallsToImgBB, imgbbConfigured } from '@/lib/imgbb';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 🌱 DAILY DRIP — runs every 6 hours and pulls one bounded batch of NEW
 * wallpapers per source into Supabase.
 *
 * Schedule: vercel.json → "0 0,6,12,18 * * *" (every 6 hours). The PostgreSQL
 * reservation (claim_daily_job with a 6-hour window) guarantees only ONE run
 * per 6-hour slot even if Vercel retries or two instances fire together.
 *
 * Per 6-hour run the caps are small (NexWall 12 · Wallhaven 10 · AnimePixels
 * 15), so across 4 daily runs the catalog grows steadily (~48/40/60 walls)
 * without any single request hammering a source.
 *
 * Freshness: the AnimePixels page and the Wallhaven shelf rotate every 6-hour
 * slot instead of once a day, so each run brings genuinely new content.
 *
 * Duplicate-proof: anything already in the DB is filtered out before insert.
 *
 * ImgBB mirror: at the end, up to WALLORA_IMGBB_PER_RUN freshly inserted
 * wallpapers are mirrored to ImgBB (best-effort) so images survive source
 * outages. Mirror failures never fail the run.
 */

const CAPS = { nexwall: 12, wallhaven: 10, animepixels: 15 };

/** 0..n 6-hour slot counter since epoch — drives page/shelf rotation. */
const sixHourSlot = () => Math.floor(Date.now() / (6 * 3_600_000));

async function existingIds(sb: ReturnType<typeof getServiceSupabase>, source: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { data, error } = await sb!.from('wallpapers').select('source_id').eq('source', source).in('source_id', ids);
  if (error) throw new Error(`existing-id lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r: { source_id: string }) => r.source_id));
}

export async function GET(req: NextRequest) {
  // auth — same secret as the blog cron
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not set' }, { status: 503 });
  }

  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, skipped: true, reason: 'supabase_not_configured' }, { status: 503 });
  const { data: claimed, error: claimError } = await sb.rpc('claim_daily_job', { p_job: 'daily-drip' });
  if (claimError) {
    return NextResponse.json({ ok: false, error: `daily_reservation: ${claimError.message}` }, { status: 503 });
  }
  if (!claimed) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'daily drip already reserved for this 6-hour slot' });
  }

  const log: string[] = [];
  const inserted = { nexwall: 0, wallhaven: 0, animepixels: 0 };
  const insertedRows: { source: string; source_id: string; image_url: string }[] = [];

  const pushNew = async (source: string, walls: Record<string, unknown>[], cap: number) => {
    const fresh: Record<string, unknown>[] = [];
    const candidateIds = walls
      .map((w) => String(w.source_id ?? ''))
      .filter((id) => /^[A-Za-z0-9_-]{1,100}$/.test(id));
    const seen = await existingIds(sb, source, candidateIds);
    for (const w of walls) {
      if (fresh.length >= cap) break;
      const sourceId = String(w.source_id ?? '');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(sourceId) || w.source !== source || seen.has(sourceId)) continue;
      fresh.push(w);
      seen.add(sourceId);
    }
    if (fresh.length) {
      const { error } = await sb.from('wallpapers').insert(fresh);
      if (error) throw error;
      for (const w of fresh) {
        insertedRows.push({
          source: String(w.source),
          source_id: String(w.source_id),
          image_url: String(w.image_url ?? ''),
        });
      }
    }
    return fresh.length;
  };

  // ── NexWall: newest unseen (only ~1 API call per run) ──
  if (nexwallConfigured()) {
    try {
      const r = await fetchNexwallWallpapers({ page: 1, perPage: 50, sort: 'newest' });
      const kept = filterWallpapers(r.items);
      inserted.nexwall = await pushNew('nexwall', kept as unknown as Record<string, unknown>[], CAPS.nexwall);
      log.push(`✦ NexWall +${inserted.nexwall} new`);
    } catch (e) {
      log.push(`✖ NexWall: ${e instanceof Error ? e.message.slice(0, 80) : 'err'}`);
    }
  }

  // ── Wallhaven: 1 curated shelf rotates every 6 hours (10 unseen tops) ──
  try {
    const shelf = WH_SHELVES[sixHourSlot() % WH_SHELVES.length];
    const r = await fetchWallhavenSearch({ q: shelf.query, page: 1 });
    const kept = filterWallpapers(withShelf(r.items, shelf.name));
    inserted.wallhaven = await pushNew('wallhaven', kept as unknown as Record<string, unknown>[], CAPS.wallhaven);
    log.push(`✦ Wallhaven "${shelf.name}" +${inserted.wallhaven} new`);
  } catch (e) {
    log.push(`✖ Wallhaven: ${e instanceof Error ? e.message.slice(0, 80) : 'err'}`);
  }

  // ── AnimePixels: page rotates every 6-hour slot (15 unseen) ──
  try {
    const page = (sixHourSlot() % 6) + 1;
    const r = await fetchAnimePixels({ page, perPage: 100 });
    const kept = filterWallpapers(r.items);
    inserted.animepixels = await pushNew('animepixels', kept as unknown as Record<string, unknown>[], CAPS.animepixels);
    log.push(`✦ AnimePixels page ${page} +${inserted.animepixels} new`);
  } catch (e) {
    log.push(`✖ AnimePixels: ${e instanceof Error ? e.message.slice(0, 80) : 'err'}`);
  }

  const total = inserted.nexwall + inserted.wallhaven + inserted.animepixels;
  const { error: statsError } = await sb.rpc('refresh_site_stats');
  if (statsError) log.push(`⚠ Stats refresh skipped: ${statsError.message}`);
  await sb.from('sync_runs').insert({ source: 'daily-drip', inserted: total, note: log.join(' | ') }).then(() => {});

  // 🖼 Best-effort ImgBB mirror of the newest walls (never blocks the run)
  if (imgbbConfigured() && insertedRows.length) {
    try {
      const mirror = await mirrorWallsToImgBB(insertedRows);
      log.push(`🖼 ImgBB: ${mirror.note}`);
    } catch (e) {
      log.push(`🖼 ImgBB mirror skipped: ${e instanceof Error ? e.message.slice(0, 80) : 'err'}`);
    }
  }

  // 📌 then auto-pin the newest walls to Pinterest (traffic channel)
  let pins = { pinned: 0, note: 'skipped' };
  try {
    const { dailyPins } = await import('@/lib/pinterest');
    pins = await dailyPins(5);
    log.push(`📌 Pinterest +${pins.pinned} (${pins.note})`);
  } catch (e) {
    log.push(`📌 Pinterest skipped: ${e instanceof Error ? e.message.slice(0, 60) : 'err'}`);
  }
  return NextResponse.json({ ok: true, inserted, pins, note: `${total} fresh walls published this slot`, log });
}
