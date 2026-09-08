import type { Wallpaper } from '@/lib/types';
import { imgSrcSet } from '@/lib/img';
import { seoFor, wallHref } from '@/lib/seo';

const SPANS = [
  'md:col-span-2 md:row-span-2',
  '',
  'md:row-span-2',
  '',
  '',
  'md:col-span-2',
];

/** 2-col grid on phones/tablets, 4-col from md — matches the auto-rows tiles. */
const BENTO_SIZES = '(min-width: 768px) 25vw, (min-width: 640px) 45vw, 48vw';

export default function BentoFeatured({ items }: { items: Wallpaper[] }) {
  const list = items.slice(0, 6);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-[150px] sm:auto-rows-[175px] gap-3.5">
      {list.map((w, i) => {
        // Below the first viewport on a phone (measured y≈1740 at 390px):
        // lazy + srcset (see TrendingRow for why).
        const { src, srcSet, sizes } = imgSrcSet(w.thumb_url || w.image_url, { sizes: BENTO_SIZES });
        return (
        <a
          key={w.id}
          href={wallHref(w)}
          className={`card-shine group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900 row-span-1 ${SPANS[i % SPANS.length]}`}
        >
          <img
            src={src}
            srcSet={srcSet}
            sizes={sizes}
            alt={seoFor(w).alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.06]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 opacity-80 group-hover:opacity-100 transition" />
          <div className="absolute bottom-0 inset-x-0 p-4 flex items-end justify-between gap-2">
            <div className="min-w-0">
              {w.category && (
                <p className="text-[10px] font-display tracking-[0.25em] uppercase text-accent2 mb-1">
                  {w.category}
                </p>
              )}
              <p className="font-display font-semibold truncate text-sm sm:text-base">{w.title}</p>
            </div>
            <span className="shrink-0 grid place-items-center w-9 h-9 rounded-full glass text-white/80 opacity-0 group-hover:opacity-100 transition translate-y-1 group-hover:translate-y-0">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </span>
          </div>
          {i === 0 && (
            <span className="absolute top-3 left-3 rounded-full bg-accent2 text-black text-[10px] font-display font-bold tracking-widest px-2.5 py-1">
              EDITOR&apos;S PICK
            </span>
          )}
        </a>
        );
      })}
    </div>
  );
}
