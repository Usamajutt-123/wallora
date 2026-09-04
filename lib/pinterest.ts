/**
 * 📌 WALLORA → Pinterest auto-pinner (drive referral traffic).
 *
 * Each Pin carries a direct link back to the matching wallpaper page.
 * Runs as part of the daily-drip cron with a conservative five-Pin batch.
 *
 * State (access token, board, already-pinned ids) lives in the service-only
 * Supabase private_settings table — never exposed by public RLS.
 *
 * Env:
 *   PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET  (developers.pinterest.com app)
 *   PINTEREST_REFRESH_TOKEN                        (run scripts/pinterest-auth.js once)
 *   PINTEREST_BOARD                                (optional — defaults to first board)
 */

import { getServiceSupabase } from './supabase';
import { seoFor, siteUrl, wallHref } from './seo';
import { rowToSearchable } from './db-helpers';
import type { Wallpaper } from './types';
import { isExcludedWallpaper } from './filters';

const API = 'https://api.pinterest.com/v5';
const PIN_LIMIT_PER_RUN = 5;
const PIN_SOURCES = new Set(['nexwall', 'animepixels', 'wallhaven', 'manual']);

function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

interface PinState {
  access_token: string;
  expires_at: number; // epoch ms
  refresh_token: string;
  board_id: string | null;
  pinned: string[]; // wallpaper `${source}:${source_id}` ids already pinned
}

async function loadState(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): Promise<PinState> {
  const { data, error } = await sb.from('private_settings').select('value').eq('key', 'pinterest').maybeSingle();
  if (error) throw new Error(`pinterest_state_read: ${error.message}`);
  const v = (data?.value ?? {}) as Partial<PinState>;
  return {
    access_token: typeof v.access_token === 'string' ? v.access_token : '',
    expires_at: Number(v.expires_at) || 0,
    refresh_token: typeof v.refresh_token === 'string' ? v.refresh_token : process.env.PINTEREST_REFRESH_TOKEN ?? '',
    board_id: typeof v.board_id === 'string' ? v.board_id : null,
    pinned: Array.isArray(v.pinned) ? v.pinned.filter((id): id is string => typeof id === 'string').slice(-2000) : [],
  };
}

async function saveState(sb: NonNullable<ReturnType<typeof getServiceSupabase>>, st: PinState) {
  st.pinned = st.pinned.slice(-2000); // cap the memory
  const { error } = await sb.from('private_settings').upsert({ key: 'pinterest', value: st }, { onConflict: 'key' });
  if (error) throw new Error(`pinterest_state_write: ${error.message}`);
}

const basic = () => Buffer.from(`${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`).toString('base64');

async function ensureToken(sb: NonNullable<ReturnType<typeof getServiceSupabase>>, st: PinState): Promise<string | null> {
  if (st.access_token && Date.now() < st.expires_at - 5 * 60_000) return st.access_token;
  if (!st.refresh_token) return null;
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic()}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: st.refresh_token }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  if (typeof j.access_token !== 'string' || !j.access_token) return null;
  st.access_token = j.access_token;
  if (typeof j.refresh_token === 'string' && j.refresh_token) st.refresh_token = j.refresh_token;
  st.expires_at = Date.now() + (Number(j.expires_in) || 2_592_000) * 1000; // ~30d
  await saveState(sb, st);
  return st.access_token;
}

async function ensureBoard(token: string, st: PinState): Promise<string | null> {
  if (st.board_id) return st.board_id;
  const res = await fetch(`${API}/boards?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const boards = (j?.items ?? []) as { id: string; name: string }[];
  const want = (process.env.PINTEREST_BOARD || '').trim().toLowerCase();
  const pick = want ? boards.find((b) => b.name.toLowerCase() === want) : boards[0];
  if (!pick) return null;
  st.board_id = pick.id;
  return pick.id;
}

async function pinOne(token: string, boardId: string, w: Wallpaper): Promise<boolean> {
  const seo = seoFor(w);
  const link = siteUrl(wallHref(w));
  const title = `${w.title} | ${w.resolution ?? 'High-resolution'} Wallpaper`.slice(0, 100);
  const description = `${seo.description} View the image and original-source rights details: ${link} #wallpapers ${
    w.category ? `#${w.category.toLowerCase().replace(/[^a-z0-9]+/g, '')}` : ''
  }`.slice(0, 500);
  const res = await fetch(`${API}/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      board_id: boardId,
      title,
      description,
      link,
      media_source: { source_type: 'image_url', url: w.image_url },
      alt_text: seo.alt.slice(0, 300),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok;
}

/** Publish fresh pins for today's newest wallpapers. Called by the daily-drip cron. */
export async function dailyPins(limit = PIN_LIMIT_PER_RUN): Promise<{ pinned: number; note: string }> {
  const sb = getServiceSupabase();
  if (!sb) return { pinned: 0, note: 'supabase_not_configured' };
  if (!process.env.PINTEREST_CLIENT_ID || !process.env.PINTEREST_CLIENT_SECRET) {
    return { pinned: 0, note: 'pinterest_env_missing (client id/secret)' };
  }

  const state = await loadState(sb);
  const token = await ensureToken(sb, state);
  if (!token) return { pinned: 0, note: 'no_access_token — run scripts/pinterest-auth.js' };
  const boardId = await ensureBoard(token, state);
  if (!boardId) return { pinned: 0, note: 'no_board_found' };
  await saveState(sb, state);

  // newest walls not yet pinned
  const { data, error: wallsError } = await sb
    .from('wallpapers')
    .select('source, source_id, title, image_url, mirror_url, category, tags, resolution, width, height')
    .order('created_at', { ascending: false })
    .limit(80);
  if (wallsError) throw new Error(`pinterest_catalog_read: ${wallsError.message}`);
  const safeLimit = Math.min(PIN_LIMIT_PER_RUN, Math.max(0, Math.floor(limit)));
  const candidates = (data ?? [])
    .filter((row: any) => PIN_SOURCES.has(String(row.source)) && /^[A-Za-z0-9_-]{1,100}$/.test(String(row.source_id ?? '')))
    .map((row: any) => rowToSearchable({ ...row, image_url: row.mirror_url || row.image_url }))
    .filter((wallpaper) => validImageUrl(wallpaper.image_url) && !isExcludedWallpaper(wallpaper) && !state.pinned.includes(wallpaper.id))
    .slice(0, safeLimit);

  let pinned = 0;
  let failed = 0;
  for (const [index, w] of candidates.entries()) {
    try {
      if (await pinOne(token, boardId, w)) {
        state.pinned.push(w.id);
        pinned++;
        // Persist each success so a later request failure cannot make the whole
        // completed prefix look unpinned on the next cron run.
        await saveState(sb, state);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    if (index < candidates.length - 1) await new Promise((r) => setTimeout(r, 2500)); // polite pacing
  }
  const note = pinned
    ? `pins live on board ${boardId}${failed ? `; ${failed} request(s) failed` : ''}`
    : failed
      ? `${failed} Pinterest pin request(s) failed`
      : 'nothing_new_to_pin';
  return { pinned, note };
}
