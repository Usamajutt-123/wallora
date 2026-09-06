import type { Wallpaper } from '@/lib/types';
import { imgSrcSet } from '@/lib/img';
import { fmt } from '@/lib/utils';
import type { SiteStats } from '@/lib/db';

const COLS = 5;

/**
 * The mosaic is a 3-col strip on phones (5 on sm+) — tiles render ~1/3 (or
 * 1/5) of the viewport wide, so phones resolve to the 380 px candidate of the
 * site-wide srcset ladder instead of a 900 px render.
 */
const HERO_SIZES = '(min-width: 640px) 20vw, 33vw';

export default function Hero({ tiles, stats }: { tiles: Wallpaper[]; stats: SiteStats }) {
  // distribute tiles into vertical columns
  const columns: Wallpaper[][] = Array.from({ length: COLS }, () => []);
  tiles.forEach((t, i) => columns[i % COLS].push(t));

  return (
    <section className="relative min-h-[38svh] sm:min-h-[55svh] overflow-hidden flex items-center justify-center">
      {/* ---- scrolling mosaic backdrop ---- */}
      <div
        className="absolute inset-0 grid grid-cols-3 sm:grid-cols-5 gap-3 p-3 opacity-45"
        style={{
          maskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 30%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 30%, transparent 78%)',
        }}
        aria-hidden
      >
        {columns.map((col, i) => (
          <div key={i} className="relative overflow-hidden rounded-2xl">
            <div
              className="flex flex-col gap-3 animate-marqueeY"
              style={{
                animationDuration: `${38 + i * 9}s`,
                animationDirection: i % 2 ? 'reverse' : 'normal',
              }}
            >
              {[...col, ...col, ...col, ...col].map((t, j) => {
                const { src, srcSet, sizes, candidates } = imgSrcSet(t.thumb_url, { sizes: HERO_SIZES });
                // Only the three columns visible in the first mobile row are
                // eager/high priority. React 19 preloads eager images, so the
                // duplicated marquee copies and off-screen columns stay lazy.
                const eager = j === 0 && i < 3;
                // Keep any fallback preload on the exact 380w mobile candidate;
                // the responsive srcSet still upgrades it on larger screens.
                const mobileSrc = candidates?.[0] || src;
                return (
                  <img
                    key={`${t.id}-${j}`}
                    src={eager ? mobileSrc : src}
                    srcSet={srcSet}
                    sizes={sizes}
                    alt=""
                    loading={eager ? 'eager' : 'lazy'}
                    fetchPriority={eager ? 'high' : undefined}
                    decoding="async"
                    className="w-full rounded-2xl bg-zinc-900 object-cover aspect-[3/4] brightness-[0.85]"
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ---- aurora glows ---- */}
      <div className="absolute -top-32 left-1/4 w-[520px] h-[520px] rounded-full bg-accent/25 blur-[140px] animate-floaty" aria-hidden />
      <div className="absolute bottom-0 right-1/5 w-[420px] h-[420px] rounded-full bg-accent2/10 blur-[120px] animate-floaty" style={{ animationDelay: '-6s' }} aria-hidden />

      {/* ---- content ---- */}
      <div className="relative z-10 text-center px-5 pt-24 pb-12 max-w-5xl mx-auto">
        <div className="animate-fadeUp inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-xs sm:text-sm text-white/75 tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulseGlow" />
          {fmt(stats.walls)} WALLPAPERS · CURATED MULTI-SOURCE CATALOG
        </div>

        <h1 className="animate-fadeUp font-display font-bold leading-[0.95] mt-5 text-[10vw] sm:text-6xl lg:text-7xl tracking-tight" style={{ animationDelay: '0.12s' }}>
          WALLS THAT
          <br />
          <span className="text-grad">SPEAK.</span>
        </h1>

        <p className="animate-fadeUp mt-4 text-white/55 max-w-lg mx-auto text-sm sm:text-base leading-relaxed" style={{ animationDelay: '0.24s' }}>
          Explore high-resolution Anime, Gaming, AMOLED and Aesthetic backgrounds from a carefully filtered catalog.
        </p>

        <div className="animate-fadeUp mt-6 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '0.36s' }}>
          <a
            href="#browse"
            className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3 font-display font-semibold text-black text-sm tracking-wide hover:bg-accent2 transition-colors"
          >
            Explore the feed
            <svg viewBox="0 0 24 24" className="w-4 h-4 transition-transform group-hover:translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14m-6-6 6 6 6-6" />
            </svg>
          </a>
          <a
            href="/categories"
            className="inline-flex items-center gap-2 rounded-full glass px-7 py-3 font-display font-semibold text-sm tracking-wide text-white/85 hover:border-accent/60 hover:text-white transition"
          >
            Browse categories
          </a>
        </div>

        {/* live stats */}
        <div className="animate-fadeUp mt-7 flex items-center justify-center gap-2 sm:gap-3 flex-wrap" style={{ animationDelay: '0.48s' }}>
          {[
            ['Wallpapers', fmt(stats.walls)],
            ['Total views', fmt(stats.views)],
            ['Downloads', fmt(stats.downloads)],
          ].map(([label, val]) => (
            <div key={label} className="glass rounded-2xl px-4 sm:px-6 py-2.5 text-left">
              <div className="font-display font-bold text-lg sm:text-xl text-grad">{val}</div>
              <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-white/45 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
