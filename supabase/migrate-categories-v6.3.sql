-- ══════════════════════════════════════════════════════════════════
--  WALLORA v6.3 — merge duplicate categories (SEO audit §2)
--  Run ONCE in Supabase → SQL Editor → Run (safe to re-run: every statement
--  is idempotent and the whole migration is one transaction).
--
--  Canonical names (must match lib/categories.ts):
--    "nature" → "Nature & Landscapes"
--    "Anime"  → "Anime & Manga"
--
--  The app code already merges these at READ time and 301-redirects the old
--  URLs (middleware.ts), so this migration only makes the stored data match
--  what visitors already see. Zero downtime.
-- ══════════════════════════════════════════════════════════════════

begin;

-- ── 1. wallpapers: move rows from legacy shelves to the canonical ones ──
update wallpapers
set category = 'Nature & Landscapes'
where lower(trim(category)) = 'nature'
  and category <> 'Nature & Landscapes';

update wallpapers
set category = 'Anime & Manga'
where lower(trim(category)) = 'anime'
  and category <> 'Anime & Manga';

-- ── 2. categories table: same rename for advertised shelves ──
-- (unique key is (source, source_id), so renames can never collide)
update categories
set name = 'Nature & Landscapes'
where lower(trim(name)) = 'nature'
  and name <> 'Nature & Landscapes';

update categories
set name = 'Anime & Manga'
where lower(trim(name)) = 'anime'
  and name <> 'Anime & Manga';

-- The AnimePixels umbrella shelf keeps its stable id but advertises the
-- canonical name and slug from now on.
update categories
set name = 'Anime & Manga', slug = 'anime-manga'
where source = 'animepixels' and source_id = '__all';

-- Admin-set custom covers follow their shelves.
update categories
set name = 'Nature & Landscapes'
where source = 'custom' and lower(trim(name)) = 'nature';

update categories
set name = 'Anime & Manga'
where source = 'custom' and lower(trim(name)) = 'anime';

-- ── 3. blog posts: keep guide lookup aligned with wallpaper shelves ──
update posts
set category = 'Nature & Landscapes'
where lower(trim(category)) = 'nature';

update posts
set category = 'Anime & Manga'
where lower(trim(category)) = 'anime';

commit;

-- ── 4. verify (expect 0 rows everywhere) ──
select 'wallpapers-legacy' as check_name, count(*) as leftover
from wallpapers
where lower(trim(category)) in ('nature', 'anime');
select 'categories-legacy' as check_name, count(*) as leftover
from categories
where lower(trim(name)) in ('nature', 'anime');
select 'posts-legacy' as check_name, count(*) as leftover
from posts
where lower(trim(category)) in ('nature', 'anime');
select category, count(*) as walls
from wallpapers
where category in ('Nature & Landscapes', 'Anime & Manga')
group by category
order by category;
