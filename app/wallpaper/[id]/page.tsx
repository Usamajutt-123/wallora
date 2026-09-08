import { getRelated, getWallpaperById } from '@/lib/db';
import { getGuidePost } from '@/lib/blog';
import { getAdsConfig } from '@/lib/ads';
import AdSlot from '@/components/ads/AdSlot';
import { imgUrl, imgSrcSet } from '@/lib/img';
import { imageJsonLd, parseWallParam, seoFor, siteUrl, wallHref, wallSlug } from '@/lib/seo';
import { sourceLabel } from '@/lib/labels';
import { fmt, jsonLdString } from '@/lib/utils';
import DownloadButton from '@/components/DownloadButton';
import ViewTracker from '@/components/ViewTracker';
import Masonry from '@/components/Masonry';
import SectionHeading from '@/components/SectionHeading';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Resolve a route param (legacy `source:id` or SEO slug) to a wallpaper. */
async function resolveWall(param: string) {
  const parsed = parseWallParam(param);
  if (!parsed) return { w: null, legacy: false };
  const w = await getWallpaperById(`${parsed.source}:${parsed.id}`);
  return { w, legacy: parsed.legacy };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const route = await params;
  const { w } = await resolveWall(route.id);
  if (!w) return { title: 'Not found — WALLORA', robots: { index: false } };
  const seo = seoFor(w);
  const canonical = siteUrl(wallHref(w));
  const image = imgUrl(w.image_url);
  const ogImage = image.startsWith('/') ? siteUrl(image) : image;
  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    alternates: { canonical },
    robots: { index: true, follow: true, 'max-image-preview': 'large' },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: canonical,
      siteName: 'WALLORA',
      type: 'article',
      images: ogImage ? [{ url: ogImage, alt: seo.alt }] : [],
    },
    twitter: { card: 'summary_large_image', title: seo.title, description: seo.description, images: ogImage ? [ogImage] : [] },
  };
}

export default async function WallpaperPage({ params }: { params: Promise<{ id: string }> }) {
  const route = await params;
  const { w, legacy } = await resolveWall(route.id);
  if (!w) notFound();
  // 308: old /wallpaper/source:id URLs permanently move to keyword slugs
  if (legacy || route.id !== wallSlug(w)) permanentRedirect(wallHref(w));

  const seo = seoFor(w);
  const [related, ads, guide] = await Promise.all([getRelated(w, 8), getAdsConfig(), getGuidePost(w.category)]);
  const thumb = imgUrl(w.thumb_url);
  // Structured data advertises the TRUE original file (Google indexes it), so it
  // asks the proxy not to resize.
  const original = imgUrl(w.image_url, { full: true });
  // The on-page preview and its blurred backdrop share ONE srcset, so the
  // browser downloads a single render (1080 px on phones, 1440 px on
  // desktops) instead of two different sizes.
  const preview = imgSrcSet(w.image_url, { widths: [1080, 1440], sizes: '80vw' });
  const absolute = (url: string) => (url.startsWith('/') ? siteUrl(url) : url);
  const jsonLd = imageJsonLd(
    w,
    siteUrl(wallHref(w)),
    absolute(thumb),
    absolute(original),
  );
  const pageUrl = siteUrl(wallHref(w));
  const crumbList = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl('/') },
    ...(w.category
      ? [{ '@type': 'ListItem', position: 2, name: w.category, item: siteUrl(`/search?category=${encodeURIComponent(w.category)}`) }]
      : []),
    { '@type': 'ListItem', position: w.category ? 3 : 2, name: seo.title, item: pageUrl },
  ];
  const breadcrumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbList };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-28 pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbLd) }} />
      <ViewTracker id={w.id} />

      {/* breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-white/40 mb-8 flex-wrap">
        <a href="/" className="hover:text-accent2 transition">Home</a>
        <span>/</span>
        {w.category && (
          <>
            <a href={`/search?category=${encodeURIComponent(w.category)}`} className="hover:text-accent2 transition">
              {w.category}
            </a>
            <span>/</span>
          </>
        )}
        <span className="text-white/70 truncate max-w-[220px]">{w.title}</span>
      </nav>

      <div className="grid lg:grid-cols-[1fr_380px] gap-10 items-start">
        {/* ---- preview with ambient glow ---- */}
        <div className="relative">
          <img
            src={preview.src}
            srcSet={preview.srcSet}
            sizes={preview.sizes}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-30 scale-110 rounded-3xl -z-10"
          />
          <div className="glass rounded-3xl p-2.5">
            {/* Main preview is the one place a visitor looks at the image large,
                so it asks the proxy for a wider 1440 px render (1080 on phones). */}
            <img
              src={preview.src}
              srcSet={preview.srcSet}
              sizes={preview.sizes}
              alt={seo.alt}
              className="w-full max-h-[78vh] object-contain rounded-2xl bg-black"
            />
          </div>
        </div>

        {/* ---- info panel ---- */}
        <aside className="glass rounded-3xl p-7 lg:sticky lg:top-24">
          <div className="flex items-center gap-2 flex-wrap">
            {w.category && (
              <a
                href={`/search?category=${encodeURIComponent(w.category)}`}
                className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-xs font-display tracking-widest text-accent2 uppercase"
              >
                {w.category}
              </a>
            )}
            {w.is_premium && (
              <span className="rounded-full border border-accent2/40 bg-accent2/10 px-3 py-1 text-xs font-display tracking-widest text-accent2 uppercase">
                Pro
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-widest text-white/50 uppercase">
              {sourceLabel(w.source)}
            </span>
          </div>

          <h1 className="font-display font-bold text-3xl mt-5 leading-tight">{w.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/50">{seo.description}</p>

          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            {w.resolution && (
              <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-3.5">
                <dt className="text-[10px] uppercase tracking-[0.2em] text-white/40">Resolution</dt>
                <dd className="font-display font-semibold mt-1">{w.resolution}</dd>
              </div>
            )}
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-3.5">
              <dt className="text-[10px] uppercase tracking-[0.2em] text-white/40">Views</dt>
              <dd className="font-display font-semibold mt-1">{fmt(w.views)}</dd>
            </div>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-3.5">
              <dt className="text-[10px] uppercase tracking-[0.2em] text-white/40">Downloads</dt>
              <dd className="font-display font-semibold mt-1">{fmt(w.downloads)}</dd>
            </div>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-3.5">
              <dt className="text-[10px] uppercase tracking-[0.2em] text-white/40">Added</dt>
              <dd className="font-display font-semibold mt-1">
                {new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </dd>
            </div>
          </dl>

          <div className="mt-7">
            <DownloadButton id={w.id} imageUrl={w.image_url} title={w.title} />
            <p className="mt-3 text-center text-[11px] text-white/35">
              Direct download · check the original source for usage rights
            </p>
            {w.source_url && (
              <a
                href={w.source_url}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="mt-2 flex items-center justify-center gap-1 text-[11px] text-white/40 hover:text-accent2 transition"
              >
                View original on {sourceLabel(w.source)}
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </a>
            )}
          </div>

          {/* Ad: wallpaper sidebar */}
          <div className="mt-5">
            <AdSlot id="wallpaper-side" config={ads['wallpaper-side']} />
          </div>
        </aside>
      </div>

      {/* related guide — contextual internal link to the category's blog (SEO) */}
      {guide && w.category && (
        <a
          href={`/blog/${guide.slug}`}
          className="group mt-10 grid sm:grid-cols-[230px_1fr] gap-0 overflow-hidden glass rounded-3xl transition duration-300 hover:border-accent/50 hover:-translate-y-1"
        >
          {guide.cover_url ? (
            <div className="relative h-44 sm:h-full sm:min-h-[180px] overflow-hidden">
              <img
                src={imgUrl(guide.cover_url)}
                alt={guide.title}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t sm:bg-gradient-to-r from-[#0a0a10] via-transparent to-transparent" />
            </div>
          ) : (
            <div className="hidden sm:grid place-items-center bg-gradient-to-br from-accent/15 via-white/[0.03] to-accent2/10 min-h-[180px]">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-accent2/70" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
            </div>
          )}
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-white/40 flex-wrap">
              {w.category && <span className="text-accent2">{w.category}</span>}
              <span>·</span>
              <span>{new Date(guide.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span>·</span>
              <span>Guide</span>
            </div>
            <p className="mt-2.5 font-display font-bold text-lg sm:text-xl leading-snug group-hover:text-accent2 transition line-clamp-2">
              {guide.title}
            </p>
            {guide.description && <p className="mt-1.5 text-sm text-white/45 line-clamp-2">{guide.description}</p>}
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-display tracking-wider text-accent2">
              READ GUIDE
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 transition group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </span>
          </div>
        </a>
      )}

      {/* related */}
      {related.length > 0 && (
        <section className="mt-24">
          <SectionHeading kicker="Keep scrolling" title="More like this" />
          <Masonry items={related} />
        </section>
      )}
    </div>
  );
}
