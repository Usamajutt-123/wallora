/**
 * WALLORA canonical categories — single source of truth for category identity.
 *
 * PROBLEM (SEO audit): duplicate category URLs index separately and split
 * ranking signals (keyword cannibalization), e.g.
 *   ?category=nature  vs  ?category=Nature & Landscapes
 *   ?category=Anime   vs  ?category=Anime & Manga
 *
 * FIX: exactly ONE canonical display name per category. Legacy spellings are
 * permanent 301 aliases (see middleware.ts) and are merged at READ time
 * everywhere (feed filter, category aggregation, sitemap, titles) so the site
 * stays consistent even before/while the DB migration runs:
 *   supabase/migrate-categories-v6.3.sql
 *
 * This module is deliberately dependency-free so it is safe to import from
 * the Edge middleware, client components and server code alike.
 */

/** Legacy spelling (normalised key) → canonical display name. */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  nature: 'Nature & Landscapes',
  anime: 'Anime & Manga',
};

/** Normalise a raw category value for comparison (case/space-insensitive). */
export function normalizeCategoryKey(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
}

/**
 * Canonical display name for any stored/requested category.
 * Unknown names pass through cleaned (trimmed, single-spaced) but unchanged.
 */
export function canonicalCategoryName(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const cleaned = String(name).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!cleaned) return null;
  return ALIAS_TO_CANONICAL[cleaned.toLowerCase()] ?? cleaned;
}

/** True when the value is a legacy alias that must 301 to its canonical. */
export function isLegacyCategoryAlias(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return false;
  const cleaned = String(name).replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  const canonical = ALIAS_TO_CANONICAL[cleaned.toLowerCase()];
  return !!canonical && cleaned !== canonical;
}

/**
 * Every stored spelling a canonical category may still have in the DB
 * (canonical first). Used for transition-safe `.in('category', …)` reads so
 * filtering works identically before AND after the SQL migration.
 */
export function categoryStoredValues(name: string | null | undefined): string[] {
  const canonical = canonicalCategoryName(name);
  if (!canonical) return [];
  const out = [canonical];
  for (const [alias, target] of Object.entries(ALIAS_TO_CANONICAL)) {
    if (target === canonical) {
      // Re-capitalise the known legacy spellings observed in the catalog.
      for (const spelling of [alias, alias.charAt(0).toUpperCase() + alias.slice(1)]) {
        if (spelling !== canonical && !out.includes(spelling)) out.push(spelling);
      }
    }
  }
  return out;
}
