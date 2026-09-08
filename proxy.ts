import { NextResponse, type NextRequest } from 'next/server';
import { canonicalCategoryName, isLegacyCategoryAlias } from '@/lib/categories';

/**
 * Route proxy (Next.js 16 `proxy.ts` convention).
 *
 * Permanent (301) redirect for legacy category spellings, e.g.
 *   /search?category=nature → /search?category=Nature%20%26%20Landscapes
 *   /search?category=Anime  → /search?category=Anime%20%26%20Manga
 *
 * This consolidates the duplicate category URLs (keyword cannibalization)
 * onto one canonical URL per category. Other query params (q, sort, page)
 * are preserved. A true 301 is used (Next.js `redirects()` and
 * `permanentRedirect()` both emit 308), which is what the SEO audit requires.
 */
export default function proxy(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('category');
  if (!raw || !isLegacyCategoryAlias(raw)) return NextResponse.next();
  const canonical = canonicalCategoryName(raw);
  if (!canonical) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.searchParams.set('category', canonical);
  return NextResponse.redirect(url, 301);
}

export const config = {
  matcher: ['/search'],
};
