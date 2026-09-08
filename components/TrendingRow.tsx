import type { Wallpaper } from '@/lib/types';
import { imgSrcSet } from '@/lib/img';
import { seoFor, wallHref } from '@/lib/seo';
import { fmt } from '@/lib/utils';

/** Fixed-width cards: w-44 (176 px) on phones, w-52 (208 px) on sm+. */
const TRENDING_SIZES = '(min-width: 640px) 208px, 176px';

export default function TrendingRow({ items }: { items: Wallpaper[] }) {
  return (
    <div className="flex gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
      {items.map((w, i) => {
        // This strip sits BELOW the first viewport on a phone (measured y≈1227
        // at 390px), so it stays lazy — it loads in the background as the user
        // scrolls, and its srcset still caps the mobile render at 380 px.
        // (React 19 auto-preloads every eager image, so lazy also keeps the
        // page's preload count at the hero's ~5.)
        const { src, srcSet, sizes } = imgSrcSet(w.thumb_url || w.image_url, { sizes: TRENDING_SIZES });
        return (
        <a
          key={w.id}
          href={wallHref(w)}
          className="card-shine group relative shrink-0 w-44 sm:w-52 snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900"
        >
          <div className="relative h-64 sm:h-72 overflow-hidden bg-zinc-900">
            <img
              src={src}
              srcSet={srcSet}
              sizes={sizes}
              alt={seoFor(w).alt}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition duration-700 group-hover:scale-110"
            />
            {/* big outlined rank */}
            <span className="absolute bottom-1 left-2 font-display font-bold text-[64px] leading-none text-stroke opacity-80 select-none">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/85 to-transparent" />
            <div className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/55 backdrop-blur px-2 py-1 text-[10px] text-white/70 border border-white/10">
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-accent2" fill="currentColor">
                <path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10.5H12l1-8.5Z" />
              </svg>
              {fmt(w.views)}
            </div>
          </div>
          <div className="px-3.5 py-3">
            <p className="font-display font-semibold text-sm truncate">{w.title}</p>
            <p className="text-[11px] text-white/40 mt-0.5">{w.category ?? 'Wallpaper'}</p>
          </div>
        </a>
        );
      })}
    </div>
  );
}
