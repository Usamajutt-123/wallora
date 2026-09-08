import { getPost, listPosts } from '@/lib/blog';
import { getWallpapers } from '@/lib/db';
import { imgUrl } from '@/lib/img';
import { siteUrl } from '@/lib/seo';
import { getAdsConfig } from '@/lib/ads';
import AdSlot from '@/components/ads/AdSlot';
import Masonry from '@/components/Masonry';
import SectionHeading from '@/components/SectionHeading';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { jsonLdString } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const route = await params;
  const post = await getPost(route.slug);
  if (!post) return { title: 'Not found — WALLORA', robots: { index: false } };
  const canonical = siteUrl(`/blog/${post.slug}`);
  const cover = post.cover_url || undefined;
  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url: canonical,
      publishedTime: post.date,
      siteName: 'WALLORA',
      ...(cover ? { images: [{ url: cover, alt: post.title }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.description, ...(cover ? { images: [cover] } : {}) },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const route = await params;
  const post = await getPost(route.slug);
  if (!post) notFound();
  const ads = await getAdsConfig();

  // fresh walls from the post's category → cover + "browse" section at the end
  let walls: Awaited<ReturnType<typeof getWallpapers>>['data'] = [];
  try {
    walls = (await getWallpapers({ category: post.category ?? undefined, perPage: 8 })).data;
  } catch {
    /* same-category walls optional */
  }
  const cover = post.cover_url ? { image_url: post.cover_url } : walls[0];
  const coverImage = cover ? imgUrl(cover.image_url) : '';
  const coverAbsolute = coverImage ? (coverImage.startsWith('/') ? siteUrl(coverImage) : coverImage) : undefined;

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    keywords: post.keywords.join(', '),
    wordCount: post.readTime * 200,
    inLanguage: 'en',
    image: coverAbsolute,
    author: { '@type': 'Organization', name: 'WALLORA' },
    publisher: { '@type': 'Organization', name: 'WALLORA' },
    mainEntityOfPage: siteUrl(`/blog/${post.slug}`),
  };

  const related = (await listPosts()).filter((p) => p.slug !== post.slug).slice(0, 3);

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: siteUrl('/blog') },
      ...(post.category
        ? [{ '@type': 'ListItem', position: 3, name: post.category, item: siteUrl(`/search?category=${encodeURIComponent(post.category)}`) }]
        : []),
      { '@type': 'ListItem', position: post.category ? 4 : 3, name: post.title, item: siteUrl(`/blog/${post.slug}`) },
    ],
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-28 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbLd) }} />

      <nav className="flex items-center gap-2 text-xs text-white/40 mb-8">
        <a href="/" className="hover:text-accent2 transition">Home</a>
        <span>/</span>
        <a href="/blog" className="hover:text-accent2 transition">Blog</a>
        <span>/</span>
        <span className="text-white/70 truncate max-w-[200px]">{post.title}</span>
      </nav>

      <div className="flex items-center gap-2 text-[10px] tracking-[0.25em] uppercase text-white/40 flex-wrap">
        {post.category && (
          <a href={`/search?category=${encodeURIComponent(post.category)}`} className="text-accent2 hover:underline">
            {post.category}
          </a>
        )}
        <span>·</span>
        <span>{new Date(post.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        <span>·</span>
        <span>{post.readTime} min read</span>
      </div>

      <h1 className="mt-4 font-display font-extrabold text-3xl sm:text-[2.6rem] leading-[1.15]">{post.title}</h1>

      {cover && (
        <div className="mt-8 rounded-3xl overflow-hidden glass p-2">
          <img src={imgUrl(cover.image_url)} alt={post.title} className="w-full max-h-[420px] object-cover rounded-2xl" />
        </div>
      )}

      <article className="blog-prose mt-10" dangerouslySetInnerHTML={{ __html: post.html }} />

      {(() => {
        const gallery = post.images.filter((url) => url !== cover?.image_url && url !== post.cover_url);
        if (!gallery.length) return null;
        return (
          <div className="mt-12">
            <p className="text-[11px] font-display font-semibold tracking-[0.35em] text-accent2 uppercase">Gallery</p>
            <h2 className="mt-2 font-display font-bold text-2xl sm:text-3xl tracking-tight">More from this post</h2>
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="nofollow noopener noreferrer" className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">
                  <img src={imgUrl(url)} alt={`${post.title} — gallery image ${i + 1}`} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105" />
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="mt-12">
        <AdSlot id="blog-bottom" config={ads['blog-bottom']} />
      </div>

      {walls.length > 0 && (
        <div className="mt-16">
          <SectionHeading kicker="From the post" title={post.category ?? 'Wallpapers'} />
          <p className="text-sm text-white/40 mt-1">Fresh from the {post.category ?? 'collection'} — tap any to download in full quality.</p>
          <div className="mt-6">
            <Masonry items={walls} />
          </div>
          <div className="mt-8 text-center">
            <a
              href={post.category ? `/search?category=${encodeURIComponent(post.category)}` : '/categories'}
              className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-7 py-3 font-display text-sm tracking-wider text-accent2 hover:bg-accent/20 transition"
            >
              Browse all {post.category ?? 'wallpapers'} → 
            </a>
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-16">
          <h2 className="font-display font-bold text-xl mb-5">More from the journal</h2>
          <div className="grid gap-4">
            {related.map((p) => (
              <a key={p.slug} href={`/blog/${p.slug}`} className="glass rounded-2xl p-5 flex justify-between items-center gap-4 hover:border-accent/40 transition group">
                <div>
                  <h3 className="font-display font-semibold group-hover:text-accent2 transition">{p.title}</h3>
                  <p className="text-xs text-white/40 mt-1">{p.readTime} min read · {p.category ?? 'Guide'}</p>
                </div>
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-white/30 group-hover:text-accent2 transition shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
