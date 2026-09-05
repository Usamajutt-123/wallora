import type { Wallpaper } from '@/lib/types';
import { imgSrcSet } from '@/lib/img';
import { wallHref } from '@/lib/seo';
import { sourceLabel } from '@/lib/labels';
import { fmt } from '@/lib/utils';

/**
 * Masonry tile width per breakpoint (container max-w-7xl, 12 px column gap):
 * 2 cols on phones, 3 on sm, 4 on lg, 5 on 2xl. A 390 px phone resolves the
 * 380 px srcset candidate instead of the old blanket 900 px render.
 */
const MASONRY_SIZES =
  '(min-width: 1536px) calc((100vw - 108px) / 5), ' +
  '(min-width: 1024px) calc((100vw - 132px) / 4), ' +
  '(min-width: 640px) calc((100vw - 72px) / 3), ' +
  'calc((100vw - 44px) / 2)';

/**
 * Pure presentational card — safe to render from both server and client components.
 *
 * The tile reserves its own height from the stored dimensions (falling back to a
 * portrait 9/16 phone wallpaper) and paints a dark card background, so a
 * lazy-loaded image arriving on a slow connection looks like a placeholder card
 * instead of an empty black hole in the masonry grid.
 */
const FALLBACK_RATIO = 9 / 16;

export default function WallCard({ w }: { w: Wallpaper }) {
  const ratio = w.width > 0 && w.height > 0 ? w.width / w.height : FALLBACK_RATIO;
  const { src, srcSet, sizes } = imgSrcSet(w.thumb_url || w.image_url, { sizes: MASONRY_SIZES });
  return (
    <a
      href={wallHref(w)}
      className="card-shine group relative block overflow-hidden rounded-2xl bg-zinc-900 border border-white/[0.06]"
    >
      <img
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt={w.title}
        loading="lazy"
        decoding="async"
        width={w.width || 800}
        height={w.height || 1200}
        style={{ aspectRatio: String(ratio) }}
        className="w-full h-auto bg-zinc-900 object-cover transition duration-700 ease-out group-hover:scale-[1.05]"
      />

      {/* premium badge */}
      {w.is_premium && (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] font-display font-semibold tracking-widest text-accent2 border border-accent2/30">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
            <path d="M3 8l4.5 3L12 5l4.5 6L21 8l-1.5 10h-15L3 8Z" />
          </svg>
          PRO
        </span>
      )}

      {/* source badge — always visible */}
      <span className="absolute top-3 left-3 rounded-full bg-black/55 backdrop-blur px-2.5 py-1 text-[9px] font-semibold tracking-[0.18em] uppercase text-white/70 border border-white/10">
        {sourceLabel(w.source)}
      </span>

      {/* bottom info */}
      <div className="absolute inset-x-0 bottom-0 p-3.5 pt-12 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition duration-300">
        <p className="font-display font-semibold text-sm truncate">{w.title}</p>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/60">
          {w.category && (
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5">{w.category}</span>
          )}
          {w.resolution && <span className="text-white/40">{w.resolution}</span>}
          <span className="ml-auto inline-flex items-center gap-1">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {fmt(w.views)}
          </span>
        </div>
      </div>

      {/* quick download button */}
      <span className={`absolute ${w.is_premium ? 'top-12' : 'top-3'} right-3 grid place-items-center w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/15 text-white opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition duration-300`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
        </svg>
      </span>
    </a>
  );
}
