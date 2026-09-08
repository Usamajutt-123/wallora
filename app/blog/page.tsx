import { listPosts } from '@/lib/blog';
import { imgUrl } from '@/lib/img';
import type { Metadata } from 'next';

// ISR — blog index changes at most a few times a day; 1 hour of staleness is
// invisible and turns this from a per-request render into a cached one.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Wallpaper Blog — Guides, Trends & 4K Collections',
  description:
    'Wallpaper guides, 4K collection round-ups, AMOLED & anime trends, and setup tips — fresh reads from WALLORA to level up your screens.',
  alternates: { canonical: '/blog' },
};

const CATEGORY_LINK = (c: string | null) =>
  c ? `/search?category=${encodeURIComponent(c)}` : '/categories';

export default async function BlogIndex() {
  const posts = await listPosts();
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-28 pb-20">
      <p className="text-xs tracking-[0.35em] uppercase text-accent2/80 font-display mb-3">The WALLORA Journal</p>
      <h1 className="font-display font-extrabold text-4xl sm:text-5xl leading-tight">
        Guides, trends &<span className="text-accent2"> 4K collections</span>
      </h1>
      <p className="mt-4 text-white/50 max-w-xl">
        Every post includes direct links to live wallpaper collections — read, scroll and download.
      </p>

      {posts.length === 0 ? (
        <div className="mt-14 glass rounded-3xl p-10 text-center text-white/45">
          <p className="text-4xl mb-3">📝</p>
          No posts are published yet. New wallpaper guides will appear here.
        </div>
      ) : (
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((p, i) => {
            const cover = p.cover_url;
            return (
              <a
                key={p.slug}
                href={`/blog/${p.slug}`}
                className={`group relative glass rounded-3xl overflow-hidden transition duration-300 hover:border-accent/50 hover:-translate-y-1.5 ${
                  i === 0 ? 'sm:col-span-2 lg:row-span-1' : ''
                }`}
              >
                {cover && (
                  <div className={`relative overflow-hidden ${i === 0 ? 'h-44 sm:h-52' : 'h-40'}`}>
                    <img
                      src={imgUrl(cover)}
                      alt=""
                      className="w-full h-full object-cover transition duration-500 group-hover:scale-105"
                      loading={i < 2 ? 'eager' : 'lazy'}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a10] via-transparent to-transparent" />
                  </div>
                )}
                <div className="p-6">
                  <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-white/40">
                    {p.category && <span className="text-accent2">{p.category}</span>}
                    <span>·</span>
                    <span>{new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span>·</span>
                    <span>{p.readTime} min read</span>
                  </div>
                  <h2 className="mt-2.5 font-display font-bold text-lg leading-snug group-hover:text-accent2 transition">
                    {p.title}
                  </h2>
                  <p className="mt-2 text-sm text-white/45 line-clamp-2">{p.excerpt}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-display tracking-wider text-accent2">
                    READ GUIDE
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
