# WALLORA

Premium-style wallpaper discovery platform built with **Next.js 16, React 19, Tailwind CSS and Supabase**. The catalog supports four sources at the same time:

- **NexWall API**
- **AnimePixels API**
- **Wallhaven API in curated SFW mode**
- **Manual URL-based wallpapers** added from the admin panel

Images remain URL-based; WALLORA does not store wallpaper binaries in Vercel or Supabase Storage. Optional ImgBB mirror scripts are designed to run from the owner's home PC.

## Included features

### Public site
- 55svh desktop / 38svh mobile mosaic hero
- Responsive hamburger navigation and Categories dropdown
- Masonry feed with Newest, Popular and Shuffle modes
- Mixed category/source shelves, trending rail and featured bento section
- Search and category browsing
- Wallpaper detail pages with contextual descriptions, source attribution and download handling
- Exactly one configured in-feed ad placement after every 30 rendered wallpapers
- Blog index and article pages backed by Supabase when configured
- Dynamic metadata, canonical URLs, safe JSON-LD, robots.txt and a stored-catalog sitemap

### Content policy
- Real-person women/girls, glamour photography and sexualized content are always blocked by metadata policy.
- Clearly illustrated/anime characters are allowed unless sexualized.
- Devotional content stays out of normal discovery feeds and categories.
- A meaningful user-typed search may reveal devotional results, but it never bypasses the real-person/sexualized block.
- `WALLORA_EXCLUDE_EXTRA` can add more discovery-blocked words. The required built-in policy cannot be disabled by an environment flag.

Metadata filtering cannot visually inspect an arbitrary manual image URL, so the admin must still review the actual image before publishing it.

### Admin (`/admin`)
- Supabase-backed admin accounts with salted scrypt password hashes
- Analytics dashboard, 14-day series and source counts
- Add/edit/delete/feature manual or synced wallpapers; manual category shelves refresh automatically
- Required unique description for manually managed wallpaper records
- Metadata-based description repair without source or AI calls
- Create, edit, draft, publish and delete manual or AI-generated blog posts
- Configure ad slots
- Bounded API sync console and sync history

## Safe installation

### 1. Install locked dependencies

```bash
npm ci
```

### 2. Configure Supabase

For a new database, run either of these identical canonical schema files in **Supabase → SQL Editor**:

- `scripts/supabase-setup.sql`
- `supabase/schema.sql`

For an existing pre-v6 WALLORA database, run:

- `scripts/upgrade-v6-audited.sql`

The upgrade is idempotent and preserves wallpapers, posts and analytics events. It adds compatibility columns, moves Pinterest state into a private table, repairs analytics structures and replaces obsolete RLS policies. For security, malformed legacy admin rows and any old plaintext `password` column are removed; recreate an admin with the hashed creator script.

### 3. Create the admin account

Do **not** create the dashboard admin through Supabase Authentication and do not insert a plain-text password row. Run:

```bash
node scripts/create-admin.js
```

The script writes only a salted scrypt hash to the service-only `admin_users` table. Password length must be 12–256 characters.

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill the required values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=https://your-real-domain.example
CRON_SECRET=use-a-long-random-secret

NEXWALL_API_KEY=
WALLHAVEN_API_KEY=
IMGBB_API_KEY=
GEMINI_API_KEY=

PINTEREST_CLIENT_ID=
PINTEREST_CLIENT_SECRET=
PINTEREST_REFRESH_TOKEN=
```

`SUPABASE_SERVICE_ROLE_KEY`, API secrets and `.env.local` must never be committed or exposed to browser code.

When Supabase service credentials are configured, `admin_users` is authoritative and the environment-password fallback is not used. `ADMIN_PASSWORD` is only a fallback for a non-Supabase installation. The known development fallback is rejected in production.

### 5. Start locally

```bash
npm run dev
```

With no Supabase keys, the public site uses a small zero-analytics demo catalog. No source API is called unless live mode is explicitly enabled with a NexWall key or an authenticated sync/cron route is triggered.

## Source synchronization and daily drip

### Manual sync

Admin → **API Sync** keeps all three source integrations. PostgreSQL atomically caps manual syncs at **15 new wallpapers per source / 45 total per Pakistan-local day**, even across repeated or concurrent requests. It is not a bulk importer; failed writes may conservatively consume reserved slots until the next day.

**Do not press Sync or call source routes until you are ready to spend source quota.** A production build, sitemap generation and normal Supabase-backed page view do not call NexWall, AnimePixels or Wallhaven.

### Scheduled drip

`vercel.json` schedules:

- `/api/cron/daily-drip` daily at **05:00 UTC / 10:00 PKT**, up to 45 unseen wallpapers
- `/api/cron/auto-blog` Monday/Wednesday/Friday at **09:00 UTC / 14:00 PKT**, at most one published AI article per PKT day

Both production cron routes require `CRON_SECRET`. PostgreSQL reserves each scheduled job once per Pakistan-local day before external work, preventing retry/concurrency duplicates. A failed reserved run waits until its next scheduled day rather than risking an oversized retry.

## ImgBB mirrors — home PC only

ImgBB upload routes are intentionally not deployed. ImgBB may reject datacenter/Vercel IPs, so run these scripts only from the owner's home connection.

### Mirror saved NexWall rows

This reads existing Supabase NexWall URLs and does **not** call the NexWall API:

```bash
node scripts/nexwall-imgbb-mirror.js --dry --limit 20
node scripts/nexwall-imgbb-mirror.js --limit 20
```

It fills `wallpapers.mirror_url`; the public site prefers the mirror while retaining the original source metadata.

### Wallhaven → ImgBB pipeline

```bash
npm run pipeline -- "anime" 15
npm run pipeline -- "cyberpunk" 10
npm run pipeline -- "nature" 2 --dry
```

The pipeline caps a run at 15 and shares the atomic Pakistan-day Wallhaven allowance used by Admin Sync. It rejects unsafe queries, enforces Wallhaven's SFW/general+anime settings, validates trusted redirects, image responses and size, deduplicates before upload, and reconnects audit-only legacy mirrors without bypassing the publish cap. `--dry` performs real Wallhaven search/image requests but makes no ImgBB upload or database write.

`--selftest` performs a **real one-pixel ImgBB upload**. It is not a no-op and cannot be combined with `--dry`.

No mirror provider is an absolute permanence guarantee. WALLORA retains both original and mirror URLs to reduce single-source failure risk.

## Blog management

Production posts live in the Supabase `posts` table. Once Supabase is configured, bundled markdown is demo-only and cannot revive a deleted or draft DB post.

- Manual post: Admin → Blog posts → **New manual post**
- AI post: Admin → **AI Blog Writer** or `npm run blog`
- Every AI post remains fully editable in Admin
- Raw HTML and inline remote Markdown images are dropped; link protocols are validated
- Drafts are hidden by RLS and omitted from the public blog/sitemap

Optional local commands:

```bash
npm run blog -- --topic "Best ultrawide wallpapers"
npm run blog -- --local --dry
npm run seo -- --limit 300
npm run seo -- --dry
```

These commands require their documented keys. `--dry` for the Gemini scripts can still call Gemini; it only disables persistence.

## Pinterest

1. Create/configure a Pinterest developer app.
2. Add `http://localhost:3333/callback` as an allowed redirect URI.
3. Run `node scripts/pinterest-auth.js` locally.
4. Store the returned refresh token in local/Vercel environment variables.

The implementation uses Pinterest API v5 OAuth and `POST /v5/pins` with nested `media_source`. Access/refresh state, board ID and recent pinned IDs are stored in service-only `private_settings`, never public `site_settings`. Daily drip attempts at most five safe, unpinned catalog images and prefers ImgBB mirrors.

## Analytics and security

- Public browser pings go through `/api/track` with payload validation and rate/dedupe guards.
- A service-only `track_wallpaper_event` RPC records the immutable event and updates wallpaper, site and daily counters in one database transaction.
- Anonymous users cannot directly insert/read analytics events.
- Admin sessions use signed, HttpOnly, SameSite=Lax cookies in production.
- Query-token fallback is disabled in normal production. `ADMIN_URL_TOKEN_FALLBACK=1` should only be used for a trusted cookie-blocked iframe deployment.
- The image proxy restricts hosts/protocols, validates every redirect, enforces timeouts/content type and caps response size.
- Ad network snippets run in sandboxed iframes; AdSense identifiers are validated.
- Usage rights remain with the applicable image creator/source. WALLORA does not invent or grant a wallpaper license.

## Deployment

1. Add all required variables in **Vercel → Project → Settings → Environment Variables**.
2. Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin.
3. Deploy from Git or with the Vercel CLI.
4. Run the SQL migration and `scripts/create-admin.js` before expecting DB-backed admin login.
5. Verify the cron configuration and keep `CRON_SECRET` set.

## Validation commands

These checks do not need to call wallpaper sources:

```bash
npx tsc --noEmit
npm run build
for f in scripts/*.js; do node --check "$f"; done
```

For a quota-safe build, explicitly clear source/API keys in the build shell. Never run either ImgBB `--selftest` during a no-mutation audit.

## Key files

```text
app/                              Next.js pages and API routes
components/                       Public/admin UI
lib/db.ts                         Catalog access, filtering and analytics
lib/blog.ts                       Supabase-first blog reader + safe Markdown
lib/bloggen.ts                    Shared Gemini blog generator
lib/pinterest.ts                  Pinterest v5 auto-pin flow
lib/filters.ts                    Devotional/person/sexualized policy
scripts/supabase-setup.sql        Canonical idempotent database setup
supabase/schema.sql               Identical canonical schema copy
scripts/upgrade-v6-audited.sql    Existing-install upgrade
scripts/create-admin.js           Hashed Supabase admin creator
scripts/nexwall-imgbb-mirror.js   Existing NexWall URL mirror tool
scripts/wallhaven-imgbb-pipeline.js  Bounded Wallhaven mirror pipeline
```
