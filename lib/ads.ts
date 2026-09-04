/**
 * WALLORA Ads system — slot-based ad placements, managed from /admin/ads.
 *
 * Paste any network snippet per slot:
 *   • Adsterra / Monetag  → rendered inside a sandboxed iframe (document.write-safe)
 *   • Google AdSense      → auto-detected, rendered as a real adsbygoogle unit
 *
 * Storage: Supabase `site_settings` table first, local JSON file as fallback.
 * One-time SQL:
 *   create table if not exists site_settings (key text primary key, value jsonb not null);
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAnonSupabase, getServiceSupabase, isSupabaseConfigured } from './supabase';

export const SLOT_IDS = ['home-top', 'home-mid', 'feed-inline', 'wallpaper-side', 'blog-bottom'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export interface AdSlotConfig {
  enabled: boolean;
  code: string;
  height: number;
}

export type AdsConfig = Record<SlotId, AdSlotConfig>;

export const SLOT_META: Record<SlotId, { label: string; hint: string }> = {
  'home-top': { label: 'Home — top banner', hint: 'Leaderboard-style banner between hero and trending (728×90 / responsive)' },
  'home-mid': { label: 'Home — mid feed', hint: 'After the Featured section, above the main feed (responsive banner)' },
  'feed-inline': { label: 'In-feed — every 30 wallpapers', hint: 'Repeats between wallpaper batches in the infinite scroller (home, search & every category page)' },
  'wallpaper-side': { label: 'Wallpaper page — sidebar', hint: 'Under the download panel (300×250 box works great)' },
  'blog-bottom': { label: 'Blog post — bottom', hint: 'After the article, before related wallpapers (banner)' },
};

const FILE = path.join(process.cwd(), 'content', 'ads.json');

export function defaultAds(): AdsConfig {
  return {
    'home-top': { enabled: false, code: '', height: 96 },
    'home-mid': { enabled: false, code: '', height: 110 },
    'feed-inline': { enabled: false, code: '', height: 110 },
    'wallpaper-side': { enabled: false, code: '', height: 260 },
    'blog-bottom': { enabled: false, code: '', height: 110 },
  };
}

function normalize(raw: unknown): AdsConfig {
  const base = defaultAds();
  const r = (raw ?? {}) as Partial<Record<SlotId, Partial<AdSlotConfig>>>;
  for (const id of SLOT_IDS) {
    const s = r[id];
    if (s) {
      const requestedHeight = Number(s.height);
      base[id] = {
        enabled: Boolean(s.enabled),
        code: String(s.code ?? '').slice(0, 8000),
        height: Number.isFinite(requestedHeight)
          ? Math.min(600, Math.max(50, Math.round(requestedHeight)))
          : base[id].height,
      };
    }
  }
  return base;
}

/** Server-side read — Supabase first, then local file. Never throws. */
export async function getAdsConfig(): Promise<AdsConfig> {
  const sb = getAnonSupabase();
  if (sb) {
    try {
      const { data, error } = await sb.from('site_settings').select('value').eq('key', 'ads').maybeSingle();
      if (!error && data?.value) return normalize(data.value);
    } catch {
      /* fall through to file */
    }
  }
  if (isSupabaseConfigured()) return defaultAds();
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return defaultAds();
  }
}

/** Server-side save — configured databases stay authoritative; files are demo/dev only. */
export async function saveAdsConfig(cfg: AdsConfig): Promise<{ stored: 'supabase' | 'file' }> {
  if (isSupabaseConfigured()) {
    const sb = getServiceSupabase();
    if (!sb) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to save ad settings.');
    const { error } = await sb.from('site_settings').upsert({ key: 'ads', value: cfg }, { onConflict: 'key' });
    if (error) throw new Error(`Could not save ad settings: ${error.message}`);
    return { stored: 'supabase' };
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  return { stored: 'file' };
}
