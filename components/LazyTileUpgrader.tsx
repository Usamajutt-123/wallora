'use client';

import { useEffect } from 'react';

/**
 * Deferred src upgrade for below-the-fold grid tiles.
 *
 * Native `loading="lazy"` alone is not enough on long grids: modern Chromium
 * starts fetching a lazy image once it is within ~3 viewports of the fold, so
 * a 25-tile page still fires ~16 downloads during initial load and starves
 * the LCP request on a slow pipe. Tiles marked with data-lazy-* instead SSR
 * a 1×1 transparent data-URI src (never fetched); this observer swaps in the
 * real src/srcset/sizes only as each tile nears the viewport.
 *
 * Pure DOM writes only — no React state/props — so the hydration output is
 * byte-identical to the server render (no mismatch).
 */
export default function LazyTileUpgrader({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[data-lazy-src]'));

    const upgrade = (img: HTMLImageElement) => {
      const src = img.dataset.lazySrc;
      if (!src) return;
      img.src = src;
      img.srcset = img.dataset.lazySrcset ?? '';
      img.sizes = img.dataset.lazySizes ?? '';
      img.style.opacity = '1';
    };

    if (typeof IntersectionObserver === 'undefined') {
      imgs.forEach(upgrade);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target as HTMLImageElement;
          upgrade(img);
          io.unobserve(img);
        }
      },
      { rootMargin: '1000px 0px', threshold: 0 },
    );
    imgs.forEach((img) => io.observe(img));
    return () => io.disconnect();
  }, []);

  return <>{children}</>;
}
