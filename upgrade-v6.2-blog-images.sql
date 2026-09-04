-- ═══════════════════════════════════════════════════════════════════════════
--  WALLORA v6.2 — Blog gallery images  (run ONCE in Supabase → SQL Editor)
--  Adds the `images` column used by the new Blog media picker (device uploads
--  via ImgBB + category wallpapers). Existing posts are untouched; new posts
--  store their gallery list here. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table posts add column if not exists images jsonb not null default '[]'::jsonb;
