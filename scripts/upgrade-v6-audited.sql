-- ══════════════════════════════════════════════════════════════════
--  WALLORA — audited v6 Supabase setup (paste whole file in SQL Editor → Run)
--  Includes manual wallpaper/blog management, editable AI posts, unique SEO copy,
--  ads/settings, analytics, sync log and ImgBB URL fields.
--  Designed to be safely re-run; compatibility repairs preserve catalog/posts/events.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. wallpapers (the catalog — URLs only, files stay on source CDNs) ──
create table if not exists wallpapers (
  id              bigint generated always as identity primary key,
  source          text not null,                  -- nexwall | animepixels | wallhaven | manual
  source_id       text not null,
  title           text not null,
  image_url       text not null,
  thumb_url       text,
  category        text,
  tags            text,
  width           int  default 0,
  height          int  default 0,
  resolution      text,
  source_url      text,                           -- attribution link back to the source
  is_premium      boolean default false,
  is_featured     boolean default false,
  views           bigint default 0,
  downloads       bigint default 0,
  api_views       bigint default 0,
  api_downloads   bigint default 0,
  created_at      timestamptz not null default now(),
  -- AI-generated SEO (filled by scripts/generate-seo.js / `npm run seo`)
  seo_title       text,
  seo_description text,
  seo_keywords    text,
  seo_alt         text,
  unique (source, source_id)
);
create index if not exists wallpapers_cat_idx   on wallpapers (category);
create index if not exists wallpapers_views_idx on wallpapers (views desc);
create index if not exists wallpapers_new_idx   on wallpapers (created_at desc);

-- if the table already existed without these columns:
alter table wallpapers
  add column if not exists tags text,
  add column if not exists source_url text,
  add column if not exists is_premium boolean default false,
  add column if not exists is_featured boolean default false,
  add column if not exists api_views bigint default 0,
  add column if not exists api_downloads bigint default 0,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists seo_keywords text,
  add column if not exists seo_alt text;
-- Legacy tables may predate the composite uniqueness rule used by every upsert.
delete from wallpapers a using wallpapers b
where a.source = b.source and a.source_id = b.source_id and a.ctid < b.ctid;
create unique index if not exists wallpapers_source_source_id_key on wallpapers (source, source_id);
create index if not exists wallpapers_featured_idx on wallpapers (is_featured) where is_featured = true;
create index if not exists wallpapers_seo_desc_idx on wallpapers (seo_description) where seo_description is not null;
-- Repair legacy duplicate/blank copy before enforcing case-insensitive uniqueness.
update wallpapers set seo_description = null where btrim(coalesce(seo_description, '')) = '';
with ranked as (
  select ctid, row_number() over (
    partition by lower(seo_description) order by id, ctid
  ) as duplicate_number
  from wallpapers where seo_description is not null
)
update wallpapers w set seo_description = null
from ranked r where w.ctid = r.ctid and r.duplicate_number > 1;
create unique index if not exists wallpapers_seo_desc_unique_idx
  on wallpapers (lower(seo_description)) where seo_description is not null;

-- ── 2. categories ──
create table if not exists categories (
  id              bigint generated always as identity primary key,
  source          text not null,
  source_id       text not null,
  name            text not null,
  slug            text,
  cover_url       text,
  wallpaper_count int default 0,
  is_premium      boolean default false,
  unique (source, source_id)
);
alter table categories add column if not exists is_premium boolean default false;
delete from categories a using categories b
where a.source = b.source and a.source_id = b.source_id and a.ctid < b.ctid;
create unique index if not exists categories_source_source_id_key on categories (source, source_id);

-- ── 3. posts (AI blog — Gemini writes, cron publishes Mon/Wed/Fri) ──
create table if not exists posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  title            text not null,
  description      text,
  keywords         text,
  category         text,
  content_markdown text not null,
  cover_url        text,
  status           text not null default 'published', -- published | draft
  published_at     timestamptz not null default now()
);
-- Compatibility for older post tables: manual/AI entries share one editable shape.
alter table posts
  add column if not exists description text,
  add column if not exists keywords text,
  add column if not exists category text,
  add column if not exists content_markdown text,
  add column if not exists cover_url text,
  add column if not exists status text not null default 'published',
  add column if not exists published_at timestamptz default now();
update posts set content_markdown = '' where content_markdown is null;
update posts set published_at = now() where published_at is null;
update posts set status = 'draft' where status is null or status not in ('published', 'draft');
alter table posts alter column content_markdown set not null;
alter table posts alter column published_at set default now();
alter table posts alter column published_at set not null;
alter table posts alter column status set default 'published';
alter table posts alter column status set not null;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.posts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.posts drop constraint %I', c.conname); end loop;
end $$;
alter table posts add constraint posts_status_check check (status in ('published', 'draft', 'pending'));
delete from posts a using posts b where a.slug = b.slug and a.ctid < b.ctid;
create unique index if not exists posts_slug_key on posts (slug);
create index if not exists posts_pub_idx on posts (published_at desc);

-- ── 4. site_settings (ad slots config, feature flags, anything key-value) ──
create table if not exists site_settings (
  key   text primary key,
  value jsonb not null
);

-- Secrets/private automation state must never use the publicly readable table.
create table if not exists private_settings (
  key   text primary key,
  value jsonb not null
);

-- Move a Pinterest state accidentally written by an older build, then remove
-- its public copy. This is safe when no such row exists.
insert into private_settings (key, value)
select key, value from site_settings where key = 'pinterest'
on conflict (key) do nothing;
delete from site_settings where key = 'pinterest';

-- ── 5. analytics ──
create table if not exists events (
  id         bigint generated by default as identity primary key,
  source     text not null default '',
  source_id  text not null default '',
  type       text not null check (type in ('view','download')),
  created_at timestamptz default now()
);
-- old-migration compat: columns + drop the old NOT-NULL wallpaper_id requirement
alter table events add column if not exists source    text not null default '';
alter table events add column if not exists source_id text not null default '';
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name='events' and column_name='wallpaper_id' and is_nullable='NO') then
    alter table events alter column wallpaper_id drop not null;
    alter table events alter column wallpaper_id drop default;
  end if;
end $$;
create index if not exists events_type_day_idx on events (type, created_at);

-- old migration made these as VIEWS — a view can't take new columns, drop it first
do $$
begin
  if exists (select 1 from pg_views where schemaname='public' and viewname='site_stats') then
    drop view if exists site_stats cascade;
  end if;
end $$;

-- code expects columns: id, walls, views, downloads — keep both fresh-installs AND
-- tables made by the OLD migration (no id) aligned; every alter is if-not-exists safe.
create table if not exists site_stats (
  id              smallint primary key default 1,
  walls           bigint default 0,
  views           bigint default 0,
  downloads       bigint default 0,
  updated_at      timestamptz default now()
);
alter table site_stats add column if not exists id        smallint default 1;
alter table site_stats add column if not exists walls     bigint default 0;
alter table site_stats add column if not exists views     bigint default 0;
alter table site_stats add column if not exists downloads bigint default 0;
alter table site_stats add column if not exists updated_at timestamptz default now();
update site_stats set id = 1 where id is null;
delete from site_stats where id <> 1;
-- An early migration had a one-row aggregate table without an id. If it was
-- manually duplicated, keep one aggregate row before enforcing the singleton.
delete from site_stats a using site_stats b
where a.id = b.id and a.ctid < b.ctid;
create unique index if not exists site_stats_id_uidx on site_stats (id);
alter table site_stats alter column id set not null;
insert into site_stats (id, walls, views, downloads) values (1, 0, 0, 0)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from pg_views where schemaname='public' and viewname='daily_stats') then
    drop view if exists daily_stats cascade;
  end if;
end $$;

create table if not exists daily_stats (
  day       date primary key default current_date,
  views     int default 0,
  downloads int default 0
);
alter table daily_stats add column if not exists day date default current_date;
alter table daily_stats add column if not exists views int default 0;
alter table daily_stats add column if not exists downloads int default 0;
update daily_stats set day = current_date where day is null;
-- Repair an old hand-made table before relying on ON CONFLICT(day).
with ranked as (
  select ctid, row_number() over (partition by day order by ctid) as n,
         sum(coalesce(views, 0)) over (partition by day) as total_views,
         sum(coalesce(downloads, 0)) over (partition by day) as total_downloads
  from daily_stats
)
update daily_stats d set views = r.total_views, downloads = r.total_downloads
from ranked r where d.ctid = r.ctid and r.n = 1;
with ranked as (
  select ctid, row_number() over (partition by day order by ctid) as n from daily_stats
)
delete from daily_stats d using ranked r where d.ctid = r.ctid and r.n > 1;
create unique index if not exists daily_stats_day_uidx on daily_stats (day);
alter table daily_stats alter column day set not null;
-- Rebuild the recent chart from immutable events when upgrading an old project.
insert into daily_stats (day, views, downloads)
select created_at::date,
       count(*) filter (where type = 'view')::int,
       count(*) filter (where type = 'download')::int
from events
where created_at >= now() - interval '90 days'
group by created_at::date
on conflict (day) do update set
  views = greatest(coalesce(daily_stats.views, 0), excluded.views),
  downloads = greatest(coalesce(daily_stats.downloads, 0), excluded.downloads);

-- ── 6. sync_runs (admin dashboard "last sync" history) ──
create table if not exists sync_runs (
  id         bigint generated always as identity primary key,
  source     text not null,
  inserted   int default 0,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists sync_runs_created_idx on sync_runs (created_at desc);

-- Atomic per-source reservations stop repeated/concurrent admin sync requests
-- from turning a bounded run into a same-day bulk publish. A reservation is
-- intentionally conservative: failed writes may consume a slot, but can never
-- cause the 15-per-source Pakistan-day ceiling to be exceeded.
create or replace function claim_manual_sync_slots(p_source text, p_requested int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'Asia/Karachi')::date;
  v_start timestamptz;
  v_end timestamptz;
  v_used int := 0;
  v_granted int := 0;
begin
  if p_source not in ('nexwall', 'animepixels', 'wallhaven') then
    raise exception 'unsupported sync source';
  end if;
  if p_requested is null or p_requested <= 0 then return 0; end if;

  v_start := v_day::timestamp at time zone 'Asia/Karachi';
  v_end := (v_day + 1)::timestamp at time zone 'Asia/Karachi';
  perform pg_advisory_xact_lock(hashtext('wallora-manual-sync:' || p_source || ':' || v_day::text));
  select coalesce(sum(greatest(inserted, 0)), 0)::int into v_used
    from sync_runs
    where source = 'manual-sync:' || p_source
      and created_at >= v_start and created_at < v_end;
  v_granted := least(15 - least(v_used, 15), least(p_requested, 15));
  if v_granted > 0 then
    insert into sync_runs (source, inserted, note)
      values ('manual-sync:' || p_source, v_granted, 'Atomic daily-cap reservation');
  end if;
  return greatest(v_granted, 0);
end $$;

-- Claim a scheduled job window. The reservation is made before any external
-- work, so retries/concurrent cron deliveries cannot exceed the cap:
--   • auto-blog  → once per Pakistan-local day (Mon/Wed/Fri gate is in the app)
--   • daily-drip → once per rolling 6-hour window (fresh walls 4x a day)
create or replace function claim_daily_job(p_job text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz;
  v_key text;
begin
  if p_job not in ('daily-drip', 'auto-blog') then
    raise exception 'unsupported daily job';
  end if;
  if p_job = 'auto-blog' then
    v_from := (current_date)::timestamp at time zone 'Asia/Karachi';
    v_key := 'wallora-auto-blog:' || to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD');
  else
    v_from := now() - interval '6 hours';
    v_key := 'wallora-daily-drip:6h';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_key));
  if exists (
    select 1 from sync_runs
    where source in ('job-reservation:' || p_job, p_job)
      and created_at >= v_from
  ) then
    return false;
  end if;
  insert into sync_runs (source, inserted, note)
    values ('job-reservation:' || p_job, 0, 'Atomic reservation (' || p_job || ' window)');
  return true;
end $$;

-- Update only generated description fields. This avoids full-row upserts that
-- could overwrite view/download increments made while a maintenance batch runs.
create or replace function apply_wallpaper_descriptions(p_updates jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  changed int;
  total_changed int := 0;
  v_source text;
  v_source_id text;
  v_description text;
begin
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) > 100 then
    raise exception 'updates must be an array of at most 100 rows';
  end if;
  for item in select value from jsonb_array_elements(p_updates)
  loop
    v_source := item->>'source';
    v_source_id := item->>'source_id';
    v_description := btrim(item->>'seo_description');
    if v_source is null or v_source_id is null or v_description is null
       or v_source not in ('nexwall', 'animepixels', 'wallhaven', 'manual')
       or v_source_id !~ '^[A-Za-z0-9_-]{1,100}$'
       or length(v_description) < 40 or length(v_description) > 300 then
      raise exception 'invalid wallpaper description update';
    end if;
    update wallpapers set seo_description = v_description
      where source = v_source and source_id = v_source_id;
    get diagnostics changed = row_count;
    total_changed := total_changed + changed;
  end loop;
  return total_changed;
end $$;

-- ── 7. (optional) ImgBB mirror table for the local pipeline ──
create table if not exists wallpapers_imgbb (
  id           bigint generated always as identity primary key,
  wallhaven_id text unique not null,
  wallpaper_url text not null,  -- independent ImgBB mirror link
  display_url  text,
  category     text,
  title        text,
  width        int,
  height       int,
  file_size    bigint,
  source_url   text,
  created_at   timestamptz not null default now()
);
delete from wallpapers_imgbb a using wallpapers_imgbb b
where a.wallhaven_id = b.wallhaven_id and a.ctid < b.ctid;
create unique index if not exists wallpapers_imgbb_wallhaven_id_key on wallpapers_imgbb (wallhaven_id);

-- ══════════════════════════════════════════════════════════════════
--  SECURITY — Row Level Security: public can READ the catalog/blog/settings,
--  everything else is service-key only (your server/admin).
-- ══════════════════════════════════════════════════════════════════
alter table wallpapers       enable row level security;
alter table categories       enable row level security;
alter table posts            enable row level security;
alter table site_settings    enable row level security;
alter table private_settings enable row level security;
alter table events           enable row level security;
alter table site_stats       enable row level security;
alter table daily_stats      enable row level security;
alter table sync_runs        enable row level security;
alter table wallpapers_imgbb enable row level security;

-- Replace all prior policies on WALLORA-owned tables so an obsolete public
-- write/read policy cannot survive an upgrade. The service role bypasses RLS.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any (array[
      'wallpapers', 'categories', 'posts', 'site_settings', 'private_settings',
      'events', 'site_stats', 'daily_stats', 'sync_runs', 'wallpapers_imgbb'
    ])
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy "public read" on wallpapers for select
  using (source in ('nexwall', 'animepixels', 'wallhaven', 'manual'));
create policy "public read" on categories for select
  using (source in ('nexwall', 'animepixels', 'wallhaven', 'manual'));
create policy "public reads published" on posts for select using (status = 'published');
create policy "public read" on site_settings for select using (key = 'ads');
create policy "public read" on site_stats for select using (true);
-- private_settings, events, daily_stats, sync_runs and wallpapers_imgbb have no
-- public policy. Browser analytics go through the rate-limited service route.

-- ─── 9) admin_users — dashboard ke liye admin accounts (aap khud create karte ho) ───
create table if not exists admin_users (
  id bigint generated by default as identity primary key,
  username text unique not null,
  pass_hash text not null,              -- "salt:scrypt_hash" — scripts/create-admin.js banata hai
  created_at timestamptz default now()
);
alter table admin_users
  add column if not exists username text,
  add column if not exists pass_hash text,
  add column if not exists created_at timestamptz default now();
-- Never retain a legacy plaintext credential column or malformed credential row.
alter table admin_users drop column if exists password cascade;
delete from admin_users
where username is null or username !~ '^[a-z0-9_]{3,24}$'
   or pass_hash is null or pass_hash !~ '^[0-9a-f]{32}:[0-9a-f]{64}$';
delete from admin_users a using admin_users b
where a.username = b.username and a.ctid < b.ctid;
create unique index if not exists admin_users_username_uidx on admin_users (username);
alter table admin_users alter column username set not null;
alter table admin_users alter column pass_hash set not null;
alter table admin_users enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'admin_users'
  loop execute format('drop policy if exists %I on public.admin_users', p.policyname); end loop;
end $$;
-- No public policy: login is server-side only via the service role.

-- ─── 10) ImgBB mirror (optional «NexWall» redundancy) ─────────────────
-- nexwall-imgbb-mirror.js fills this; the site PREFERS mirror_url over the
-- original CDN link, providing an independent fallback when a source is unavailable.
alter table wallpapers add column if not exists mirror_url text;

-- Manual wallpaper categories are derived catalog shelves. Rebuild them on
-- migration so content created by an earlier build is immediately discoverable.
delete from categories where source = 'manual';
with manual_groups as (
  select
    category as name,
    count(*)::int as wallpaper_count,
    (array_agg(coalesce(mirror_url, thumb_url, image_url) order by created_at desc))[1] as cover_url
  from wallpapers
  where source = 'manual' and category is not null and category = btrim(category)
    and length(category) between 1 and 80
  group by category
), prepared as (
  select
    name,
    wallpaper_count,
    cover_url,
    coalesce(nullif(left(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), 70), ''), 'manual') as slug_base
  from manual_groups
)
insert into categories (source, source_id, name, slug, cover_url, wallpaper_count, is_premium)
select
  'manual',
  slug_base || '-' || left(md5(btrim(name)), 12),
  name,
  left(slug_base, 100),
  cover_url,
  least(2147483647, wallpaper_count),
  false
from prepared
on conflict (source, source_id) do update set
  name = excluded.name,
  slug = excluded.slug,
  cover_url = excluded.cover_url,
  wallpaper_count = excluded.wallpaper_count,
  is_premium = false;

-- Reconnect uploads made by an older standalone Wallhaven→ImgBB pipeline only
-- when that wallpaper is already in the public catalog. Audit-only rows are
-- intentionally not bulk-published by a migration; the home-PC pipeline moves
-- them into the catalog later through the same atomic daily slot reservation.
update wallpapers w set
  mirror_url = i.wallpaper_url,
  thumb_url = coalesce(i.display_url, i.wallpaper_url)
from wallpapers_imgbb i
where w.source = 'wallhaven' and w.source_id = i.wallhaven_id;

-- ─── 11) RPC: atomic counters — wallpaper, totals and daily chart stay aligned ──
create or replace function increment_view(p_source text, p_source_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update wallpapers set views = coalesce(views, 0) + 1
    where source = p_source and source_id = p_source_id;
  if found then
    update site_stats set views = coalesce(views, 0) + 1, updated_at = now() where id = 1;
    insert into daily_stats (day, views, downloads) values (current_date, 1, 0)
      on conflict (day) do update set views = coalesce(daily_stats.views, 0) + 1;
  end if;
end; $$;

create or replace function increment_download(p_source text, p_source_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update wallpapers set downloads = coalesce(downloads, 0) + 1
    where source = p_source and source_id = p_source_id;
  if found then
    update site_stats set downloads = coalesce(downloads, 0) + 1, updated_at = now() where id = 1;
    insert into daily_stats (day, views, downloads) values (current_date, 0, 1)
      on conflict (day) do update set downloads = coalesce(daily_stats.downloads, 0) + 1;
  end if;
end; $$;

-- One transaction records the immutable event and updates all aggregates. The
-- server route uses this RPC so a partial network/database failure cannot leave
-- event rows and counters out of sync.
create or replace function track_wallpaper_event(p_source text, p_source_id text, p_type text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  changed boolean;
begin
  if p_type = 'view' then
    update wallpapers set views = coalesce(views, 0) + 1
      where source = p_source and source_id = p_source_id;
  elsif p_type = 'download' then
    update wallpapers set downloads = coalesce(downloads, 0) + 1
      where source = p_source and source_id = p_source_id;
  else
    return false;
  end if;
  changed := found;
  if not changed then return false; end if;

  insert into site_stats (id, walls, views, downloads) values (1, 0, 0, 0)
    on conflict (id) do nothing;
  insert into events (source, source_id, type) values (p_source, p_source_id, p_type);
  if p_type = 'view' then
    update site_stats set views = coalesce(views, 0) + 1, updated_at = now() where id = 1;
    insert into daily_stats (day, views, downloads) values (current_date, 1, 0)
      on conflict (day) do update set views = coalesce(daily_stats.views, 0) + 1;
  else
    update site_stats set downloads = coalesce(downloads, 0) + 1, updated_at = now() where id = 1;
    insert into daily_stats (day, views, downloads) values (current_date, 0, 1)
      on conflict (day) do update set downloads = coalesce(daily_stats.downloads, 0) + 1;
  end if;
  return true;
end; $$;

revoke execute on function increment_view(text, text) from public, anon, authenticated;
revoke execute on function increment_download(text, text) from public, anon, authenticated;
revoke execute on function track_wallpaper_event(text, text, text) from public, anon, authenticated;
grant execute on function increment_view(text, text) to service_role;
grant execute on function increment_download(text, text) to service_role;
grant execute on function track_wallpaper_event(text, text, text) to service_role;
revoke execute on function claim_manual_sync_slots(text, int) from public, anon, authenticated;
grant execute on function claim_manual_sync_slots(text, int) to service_role;
revoke execute on function claim_daily_job(text) from public, anon, authenticated;
grant execute on function claim_daily_job(text) to service_role;
revoke execute on function apply_wallpaper_descriptions(jsonb) from public, anon, authenticated;
grant execute on function apply_wallpaper_descriptions(jsonb) to service_role;

-- ─── 12) Refresh the cached totals after migration/manual catalog work ─────
create or replace function refresh_site_stats()
returns void language sql security definer set search_path = public as
$$ update site_stats set
     walls = (select count(*) from wallpapers),
     views = coalesce((select sum(views) from wallpapers), 0),
     downloads = coalesce((select sum(downloads) from wallpapers), 0),
     updated_at = now()
   where id = 1 $$;

select refresh_site_stats();
revoke execute on function refresh_site_stats() from public, anon, authenticated;
grant execute on function refresh_site_stats() to service_role;

-- Done. Add Supabase keys to .env.local/Vercel, then create the first admin with
-- `node scripts/create-admin.js`. Source synchronization remains a separate,
-- explicitly triggered operation.
