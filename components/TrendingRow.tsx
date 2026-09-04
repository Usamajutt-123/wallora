import type { Wallpaper } from '@/lib/types';
import { imgUrl } from '@/lib/img';
import { wallHref } from '@/lib/seo';
import { fmt } from '@/lib/utils';

export default function TrendingRow({ items }: { items: Wallpaper[] }) {
  return (
    <div className="flex gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
      {items.map((w, i) => (
        <a
          key={w.id}
          href={wallHref(w)}
          className="card-shine group relative shrink-0 w-44 sm:w-52 snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.04]"
        >
          <div className="relative h-64 sm:h-72 overflow-hidden">
            <img
              src={imgUrl(w.thumb_url || w.image_url)}
              alt={w.title}
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
      ))}
    </div>
  );
}
