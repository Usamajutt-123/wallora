import { getCategories } from '@/lib/db';
import { imgUrl } from '@/lib/img';
import { fmt } from '@/lib/utils';
import type { Metadata } from 'next';

// Avoid consuming a live-source request during deployment builds. Runtime data
// still uses the cached clients in lib/live.ts when Supabase is not connected.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-32 pb-10">
      <p className="text-[11px] font-display font-semibold tracking-[0.35em] text-accent2 uppercase mb-3">✦ The vault index</p>
      <h1 className="font-display font-bold text-4xl sm:text-6xl tracking-tight">
        Every <span className="text-grad">mood</span>, mapped.
      </h1>
      <p className="mt-4 text-white/50 max-w-lg text-sm sm:text-base">
        {categories.length} curated categories — from midnight amoled to daylight minimal. Pick one and dive in.
      </p>

      <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {categories.map((c, i) => (
          <a
            key={c.id}
            href={`/search?category=${encodeURIComponent(c.name)}`}
            className={`card-shine group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-zinc-900 ${
              i % 7 === 0 ? 'row-span-2 h-full min-h-[320px]' : 'h-44 sm:h-52'
            }`}
          >
            {c.cover_url ? (
              <img
                src={imgUrl(c.cover_url)}
                alt={c.name}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-accent/40 to-accent2/20" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 p-4">
              <p className="font-display font-bold text-base sm:text-lg leading-tight">{c.name}</p>
              <p className="text-xs text-white/50 mt-1">{fmt(c.wallpaper_count)} wallpapers</p>
            </div>
            <span className="absolute top-3 right-3 grid place-items-center w-9 h-9 rounded-full bg-black/45 backdrop-blur border border-white/15 text-white opacity-0 group-hover:opacity-100 transition">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
