import type { Category } from '@/lib/types';
import { imgSrcSet } from '@/lib/img';
import { shelfBySlug } from '@/lib/wallhaven';
import { fmt } from '@/lib/utils';

/** Fixed-width cards (w-40 = 160 px) on every viewport. */
const CATEGORY_SIZES = '160px';

export default function CategoryRow({ categories }: { categories: Category[] }) {
  return (
    <div className="flex gap-4 overflow-x-auto no-scrollbar snap-x pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
      {categories.map((c) => {
        const { src, srcSet, sizes } = imgSrcSet(c.cover_url, { sizes: CATEGORY_SIZES });
        return (
        <a
          key={c.id}
          href={`/search?category=${encodeURIComponent(c.name)}`}
          className="card-shine group relative shrink-0 w-40 h-52 snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900"
        >
          {c.cover_url ? (
            <img
              src={src}
              srcSet={srcSet}
              sizes={sizes}
              alt={`${c.name} wallpapers`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-accent/40 to-accent2/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          <div className="absolute bottom-0 inset-x-0 p-3.5">
            <p className="font-display font-semibold text-sm leading-tight">
              {c.source === 'wallhaven' ? `${shelfBySlug(c.slug)?.emoji ?? ''} ` : ''}
              {c.name}
            </p>
            <p className="text-[11px] text-white/50 mt-1">{fmt(c.wallpaper_count)} walls</p>
          </div>
          <span className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-full bg-black/45 backdrop-blur border border-white/15 text-white/80 opacity-0 group-hover:opacity-100 transition">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </span>
        </a>
        );
      })}
    </div>
  );
}
