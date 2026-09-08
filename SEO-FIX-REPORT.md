# WALLORA — SEO Audit Fix Report

**Site:** https://www.wallora.cloud (Next.js + Vercel)
**Branch:** `arena/01a0807e-wallora`
**Date:** 8 September 2026
**Status:** All fixes implemented in working tree — **NOT committed, NOT pushed** (waiting for owner approval)
**Scope:** 34 files modified + 4 new files

> Existing schema markup (ImageObject, BreadcrumbList, Article, WebSite) was NOT broken — verified intact on all tested pages.

---

## Table of Contents

1. [Priority 1 — High Impact](#-priority-1--high-impact)
   - [1. Empty alt attributes](#1-empty-alt-attributes--fixed)
   - [2. Duplicate categories (cannibalization)](#2-duplicate-categories-cannibalization--fixed)
   - [3. Orphan categories](#3-orphan-categories--fixed)
   - [4. Static-page canonicals](#4-static-page-canonicals--fixed)
   - [5. Sitemap bugs](#5-sitemap-bugs--fixed)
2. [Priority 2 — Medium](#-priority-2--medium)
   - [6. Wallpaper titles](#6-wallpaper-titles--fixed)
   - [7. Category normalization](#7-category-normalization--fixed-core-phase-2-noted)
   - [8. Thin blog](#8-thin-blog--set-to-daily-per-owner)
   - [9. GSC + Analytics](#9-gsc--analytics--code-ready-owner-action-needed)
3. [Priority 3 — Nice to Have](#-priority-3--nice-to-have)
4. [Acceptance Criteria — Verification Evidence](#acceptance-criteria--verification-evidence)
5. [Files Changed (full list)](#files-changed-full-list)
6. [Owner Actions After Deploy](#owner-actions-after-deploy-required)
7. [Deliberately Deferred (Phase 2)](#deliberately-deferred-phase-2)
8. [Testing Notes & Limits](#testing-notes--limits)

---

## 🔴 PRIORITY 1 — High Impact

### 1. Empty alt attributes — FIXED ✅

**Problem:** Homepage had ~60 of 116 `<img>` tags with `alt=""`. Root cause found: the Hero mosaic rendered 15 tiles × 4 marquee copies = 60 images, all with `alt=""`. On a wallpaper site this kills Google Images traffic.

**Fix applied (every wallpaper/content image now has a descriptive alt):**

| Location | Before | After |
|---|---|---|
| `components/Hero.tsx` (mosaic) | `alt=""` (60 imgs) | `alt={seoFor(t).alt}` (30 imgs, see §10) |
| `components/WallCard.tsx` (feed/search/related) | `alt={w.title}` (bare) | `alt={seoFor(w).alt}` (full descriptive) |
| `components/TrendingRow.tsx` | `alt={w.title}` | `alt={seoFor(w).alt}` |
| `components/BentoFeatured.tsx` | `alt={w.title}` | `alt={seoFor(w).alt}` |
| `components/CategoryRow.tsx` + `app/categories/page.tsx` | `alt={c.name}` | `alt={`${c.name} wallpapers`}` |
| `app/blog/page.tsx` (covers) | `alt=""` | `alt={post.title}` |
| `app/blog/[slug]/page.tsx` (gallery) | `alt=""` | `alt={`${post.title} — gallery image N`}` |
| `app/wallpaper/[id]/page.tsx` (guide cover) | `alt=""` | `alt={guide.title}` |

Example alt: `Frozen Summit — HD Nature & Landscapes wallpaper in 1600x2240`. A curator/AI-written `seo_alt` is honored when present.

**Kept `alt=""` only where correct:**
- Wallpaper page blurred ambient backdrop (`aria-hidden` decorative duplicate of the main image).
- Hero mosaic keeps its `aria-hidden` wrapper (duplicated content hidden from screen readers = correct a11y) while alts serve Google Images (Googlebot reads alt regardless of aria-hidden).
- Admin panel thumbnails (admin is noindex, out of audit scope).

**Verified:** Homepage `alt=""` count = **0** (85/85 images filled). Search page 0, /categories 0, blog index 0, blog post 0.

---

### 2. Duplicate categories (cannibalization) — FIXED ✅

**Problem:** `?category=nature` vs `?category=Nature & Landscapes`, and `?category=Anime` vs `?category=Anime & Manga` indexed separately, splitting ranking signals.

**Fix applied (4 layers):**

1. **Canonical names decided** (audit's recommendation): `Nature & Landscapes`, `Anime & Manga`.
   New single source of truth: **`lib/categories.ts`** — dependency-free, safe in Edge middleware, client + server. Exports `canonicalCategoryName()`, `isLegacyCategoryAlias()`, `categoryStoredValues()`.
2. **True 301 redirects** — new **`proxy.ts`** (Next.js 16 `proxy.ts` convention; `middleware.ts` is deprecated in Next 16):
   - `?category=nature` → 301 → `?category=Nature+%26+Landscapes`
   - `?category=Anime` → 301 → `?category=Anime+%26+Manga`
   - Case-insensitive (`NATURE`, ` Nature ` also redirect); other params (`q`, `sort`, `page`) preserved. A real **301** (not 308) as the audit required. Verified live with curl.
3. **Data-layer merge (read side)** — works identically before AND after the SQL migration:
   - `lib/db.ts`: feed filter uses `.in('category', [canonical + legacy spellings])`; umbrella lookup tries all spellings; category aggregation groups by canonical name (counts SUM); umbrella shelves merge by MAX (they overlap exact-row groups — never summed, no double-count).
   - `lib/live.ts`, `lib/animepixels.ts`, `lib/blog.ts` (guide lookup), demo feed: all canonical-aware.
   - `app/search/page.tsx`: display name + canonical tag always use the canonical spelling.
4. **Write side (duplicates can never return):**
   - `app/api/admin/sync/route.ts`: AnimePixels umbrella row now written as `Anime & Manga` / `anime-manga`; all synced wallpaper rows canonicalized before upsert.
   - `app/api/cron/daily-drip/route.ts`: rows canonicalized before insert.
   - `app/api/admin/wallpapers/route.ts` + `app/api/admin/posts/route.ts`: manual entries canonicalized.
   - `lib/bloggen.ts` (AI blog) + `lib/seo-copy.ts` (AI SEO copy): canonical categories enforced.
   - Admin category datalist suggestions fixed (`Anime & Manga`, `Minimalist`, `Cars & Bikes`).
5. **SQL migration** — new **`supabase/migrate-categories-v6.3.sql`**: one-time, re-runnable, single transaction. Renames legacy shelves in `wallpapers`, `categories` (incl. `__all` umbrella + `custom` covers), and `posts`, with verification SELECTs. **Owner must run once in Supabase SQL Editor after deploy.**

---

### 3. Orphan categories — FIXED ✅

**Problem:** `/categories` linked 25 categories but sitemap listed ~50 — different sources (page = real aggregation from wallpaper rows; sitemap = raw `categories` table incl. duplicates and 0-wallpaper rows).

**Fix:** `app/sitemap.ts` now builds category URLs from the **same `getCategories()` aggregation the page renders**. Page links and sitemap URLs can never drift apart again. Only shelves that really contain wallpapers appear in either; 0-wallpaper categories are in neither.

**Verified:** sitemap category URLs == page category links, **exact set match** (9 == 9 in demo data), canonical spellings in both.

---

### 4. Static-page canonicals — FIXED ✅

Added `alternates: { canonical: siteUrl('/<path>') }` (absolute `https://www.wallora.cloud/…`) to:
`app/about`, `app/contact`, `app/dmca`, `app/privacy`, `app/terms`, `app/disclaimer`.

**Verified:** view-source shows `<link rel="canonical">` on all 6 pages.

---

### 5. Sitemap bugs — FIXED ✅

**Fixes in rewritten `app/sitemap.ts`:**
- **(a) Duplicates:** every entry passes through a `Set<loc>` — one category can never appear twice even if two sources advertise the same name. Verified: 0 duplicate `<loc>`.
- **(b) Fake lastmod:** `new Date()` at request time removed everywhere.
  - Static pages + category shelves → stable **deploy date** (mtime of a committed file ≈ git checkout at build; identical across requests, moves only on new deploy).
  - Wallpapers → real `created_at`; posts → real `published_at` (deploy date only as fallback for invalid values).
- **Verified:** two sitemap fetches 70 seconds apart are **byte-identical (md5 match)**.
- Blog index entry: `daily / 0.8` per owner instruction (see §8).

---

## 🟡 PRIORITY 2 — Medium

### 6. Wallpaper titles — FIXED ✅

**Problem:** titles truncated mid-word + keyword repeated (`Naruto Uzumaki · Naruto Uzumaki Wallpaper - HD Anime &`).

**Fix (`lib/seo.ts`):**
- New pattern: `${Title} Wallpaper ${4K|HD} – ${Category}` + layout's `· WALLORA` suffix.
- Hard budget: 50 chars + 10-char brand suffix = **rendered title ≤ 60 chars**, cut at word boundaries (never mid-word).
- Parts already in the stored title (wallpaper-word, quality token, category — case-insensitive) are **skipped, never duplicated**.
- Stored (AI/manual) `seo_title` sanitized at render: longest `·`/`|` segment kept, brand mentions + doubled words removed, capped at 50.
- `og:title` uses the same deduped title (no brand duplication). Meta description deduped too (see below).
- Future AI titles: Gemini prompt tightened (≤50 chars, no brand, each keyword once) + validator **rejects** brand/pipe titles so they're never stored.

**Live example:** `Frozen Summit Wallpaper HD – Nature & Landscapes · WALLORA` (57 chars, keyword once).

**Bonus fix (`lib/wallpaper-copy.ts`):** descriptions could repeat the category twice and clip mid-sentence (`…it is an.`). Tag-less rows now draw from category-free opening templates, and when opening+ending overflow the budget the complete opening sentence wins over a truncated body. Still deterministic, still factual (no invented visuals).

**Verified:** 3 wallpaper pages — title ≤ 60, keyword once, `ImageObject` + `BreadcrumbList` JSON-LD present on all.

---

### 7. Category normalization — FIXED (core), Phase 2 noted

One canonical display name per category is now enforced **everywhere**: data reads/writes, sitemap, page titles, breadcrumbs, navbar, search canonicals, footer datalist, AI generators.

**Not done:** clean `/category/<slug>` routes and anime-franchise spelling prettification (`Dragonball-Z` → `Dragon Ball Z`). Reason: requires production-data inspection + a bigger migration (new route, all internal links, canonicals, 301 map). The canonical mechanism (`lib/categories.ts`) is ready — this is a small Phase-2 task. See §7 below.

---

### 8. Thin blog — SET TO DAILY PER OWNER ✅

Per owner instruction ("main daily blog post upload kroon ga"), `/blog` sitemap entry = **`changefreq: daily`, `priority: 0.8`**. Live-verified in sitemap XML after rebuild.

Note: local `content/posts/*.md` holds 5 quality guides but renders only in demo mode — production reads posts from Supabase, so daily publishing happens via Admin → Blogs (or the auto-blog cron), no code change needed.

---

### 9. GSC + Analytics — CODE READY, owner action needed

- `app/layout.tsx`: Google Search Console `google-site-verification` meta renders when `NEXT_PUBLIC_GSC_VERIFICATION` is set (nothing renders until then).
- GA4 via `next/script` (`afterInteractive`) when `NEXT_PUBLIC_GA_ID` is set; ID is shape-validated (`G-…`) so a typo can't inject script.
- First-party analytics (`/api/track` → `events` table → admin dashboard) already work; GA4 is optional on top.
- `.env.example` documents both variables + the GSC sitemap-submission URL.
- **Verified:** test build with dummy values renders the meta tag + both GA scripts correctly.

**Owner still must:** set the two env vars in Vercel, click Verify in GSC, submit `/sitemap.xml`. (See §6.)

---

## 🟢 PRIORITY 3 — Nice to Have (all done ✅)

| # | Item | Fix | Verified |
|---|---|---|---|
| 10 | Homepage HTML size / preloads | Hero marquee 4× → 2× copies (same `-50%` loop = visually seamless); halves ~60 imgs to ~30 | Image preloads exactly **3** (4th is a low-priority JS chunk) |
| 11 | HSTS | `max-age=31536000; includeSubDomains; preload` | Header live ✅ |
| 12 | `x-powered-by` | `poweredByHeader: false` | Header absent ✅ |
| 13 | Homepage `og:url` | `openGraph: { url: siteUrl('/') }` in `app/page.tsx` | Meta live ✅ |
| 14 | RSS feed | New `app/feed.xml/route.ts` (RSS 2.0 from posts, 1h cache) | HTTP 200, valid items ✅ |

---

## Acceptance Criteria — Verification Evidence

Production build (`next build`, type-check clean) + `next start` + curl, demo-mode data (no Supabase keys in sandbox):

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Homepage: 0 wallpaper `alt=""` | `alt=""` count = 0 (85/85 imgs filled) | ✅ |
| 2 | `?category=nature` → 301 → canonical; Anime pair likewise | `HTTP/1.1 301` + correct `Location`, params preserved, case-insensitive | ✅ |
| 3 | `/categories` lists every sitemap category | 9 == 9 exact set match | ✅ |
| 4 | Canonical on /about /contact /dmca /privacy /terms /disclaimer | `<link rel="canonical">` on 6/6 | ✅ |
| 5 | Sitemap: no dup `<loc>`; stable lastmod @ 1 min apart | 0 dupes; md5 identical across 70 s | ✅ |
| 6 | 3 wallpaper pages: ≤60 chars, keyword once, rich-results JSON-LD | 57-char example; ImageObject+Breadcrumb 3/3 | ✅ |
| 7 | No 404/500; JSON-LD untouched | 14/14 routes HTTP 200; all 4 schema types intact | ✅ |

---

## Files Changed (full list)

**New (4):**
- `lib/categories.ts` — canonical category map + helpers (single source of truth)
- `proxy.ts` — 301 redirects for legacy category URLs (Next 16 convention)
- `app/feed.xml/route.ts` — RSS 2.0 feed
- `supabase/migrate-categories-v6.3.sql` — one-time category-merge migration

**Modified (34):**
- SEO core: `lib/seo.ts`, `lib/wallpaper-copy.ts`, `lib/db.ts`, `lib/live.ts`, `lib/blog.ts`, `lib/bloggen.ts`, `lib/seo-copy.ts`, `lib/animepixels.ts`
- Sitemap/search/home/layout: `app/sitemap.ts`, `app/search/page.tsx`, `app/page.tsx`, `app/layout.tsx`
- Static pages (canonicals): `app/about`, `app/contact`, `app/dmca`, `app/privacy`, `app/terms`, `app/disclaimer` (`page.tsx` each)
- Content pages (alts): `app/categories/page.tsx`, `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `app/wallpaper/[id]/page.tsx`
- Components (alts + hero): `components/Hero.tsx`, `components/WallCard.tsx`, `components/TrendingRow.tsx`, `components/BentoFeatured.tsx`, `components/CategoryRow.tsx`, `components/admin/WallpaperEditorForm.tsx`
- Write paths: `app/api/admin/sync/route.ts`, `app/api/cron/daily-drip/route.ts`, `app/api/admin/wallpapers/route.ts`, `app/api/admin/posts/route.ts`
- Config/docs: `next.config.mjs`, `.env.example`

---

## Owner Actions After Deploy (REQUIRED)

1. **Run the SQL migration once:** paste `supabase/migrate-categories-v6.3.sql` into Supabase → SQL Editor → Run. (Idempotent; verification queries at the end must show 0 leftovers.)
2. **Confirm Vercel env:** `NEXT_PUBLIC_SITE_URL=https://www.wallora.cloud` — every canonical tag, the sitemap, and all JSON-LD URLs are built from this one value.
3. **Search Console:** set `NEXT_PUBLIC_GSC_VERIFICATION` in Vercel → redeploy → click Verify in GSC → submit `https://www.wallora.cloud/sitemap.xml` under Sitemaps.
4. **GA4 (optional):** set `NEXT_PUBLIC_GA_ID=G-…` if Google Analytics reporting is wanted; otherwise `/api/track` + admin dashboard already cover view/download analytics.
5. Publish blog posts daily (Admin → Blogs or auto-blog cron) to match the `daily` sitemap signal.

---

## Deliberately Deferred (Phase 2)

1. **Clean `/category/<slug>` routes** with 301s from `?category=` — bigger migration (new route + all internal links + canonicals). Query values are now consistent, which satisfies the audit's minimum.
2. **Anime-franchise spelling cleanup** (`Dragonball-Z` → `Dragon Ball Z`, etc.) — needs production-data inspection first; add entries to `lib/categories.ts` + extend the SQL migration when ready.
3. **Footer `?q=` links → canonical category links** — optional internal-linking upgrade; current links are harmless (noindex user-convenience).
4. **Raise validation:** after real traffic flows, confirm in GSC that old `?category=nature` / `?category=Anime` URLs drop from the index and canonicals consolidate.

---

## Testing Notes & Limits

- Sandbox has no Supabase credentials, so the running server was verified in **demo mode** (bundled catalog + 5 local posts). All logic paths (canonicalization, merge, sitemap, titles, redirects) are mode-independent and were exercised; Supabase-only paths (wallpaper sitemap rows) reuse the previously working paginated query with identical filters.
- Sandbox has no access to Google Fonts, so `next build` was run with a **temporary** `next/font/google` stub that was **reverted afterwards** — the final tree contains zero stub remnants (verified by grep). Vercel builds will fetch fonts normally.
- `proxy.ts` (not `middleware.ts`) is used because Next.js 16 deprecated the `middleware.ts` file convention; behavior verified live (exact 301 + Location).

---

*Report generated 8 September 2026. No commit or push performed — all changes are in the working tree on `arena/01a0807e-wallora` awaiting owner approval.*
