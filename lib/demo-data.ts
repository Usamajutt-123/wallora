import type { Wallpaper, Category } from './types';

const U = (photo: string, w = 1600) =>
  `https://images.unsplash.com/photo-${photo}?q=80&w=${w}&auto=format&fit=crop`;

interface Spec {
  photo: string;
  title: string;
  category: string;
  ratio: number; // height / width
}

const SPECS: Spec[] = [
  { photo: '1506905925346-21bda4d32df4', title: 'Frozen Summit', category: 'Nature', ratio: 1.4 },
  { photo: '1470071459604-3b5ec3a7fe05', title: 'Misty Highlands', category: 'Nature', ratio: 1.5 },
  { photo: '1441974231531-c6227db76b6e', title: 'Emerald Forest', category: 'Nature', ratio: 1.33 },
  { photo: '1469474968028-56623f02e42e', title: 'Golden Valley', category: 'Nature', ratio: 0.67 },
  { photo: '1472214103451-9374bd1c798e', title: 'Open Road', category: 'Nature', ratio: 0.66 },
  { photo: '1519681393784-d120267933ba', title: 'Starlit Peaks', category: 'Nature', ratio: 1.33 },
  { photo: '1501594907352-04cda38ebc29', title: 'Mirror Lake', category: 'Nature', ratio: 0.75 },
  { photo: '1419242902214-272b3f66ee7a', title: 'Desert Milky Way', category: 'Space', ratio: 0.67 },
  { photo: '1462331940025-496dfbfc7564', title: 'Nebula Drift', category: 'Space', ratio: 0.62 },
  { photo: '1451187580459-43490279c0fa', title: 'Earth Grid', category: 'Space', ratio: 1.25 },
  { photo: '1534796636912-3b95b3ab5986', title: 'Violet Cosmos', category: 'Space', ratio: 1.5 },
  { photo: '1541701494587-cb58502866ab', title: 'Ink Storm', category: 'Abstract', ratio: 1.4 },
  { photo: '1550859492-d5da9d8e45f3', title: 'Ultraviolet Flow', category: 'Abstract', ratio: 1.5 },
  { photo: '1579546929518-9e396f3cc809', title: 'Prism Fade', category: 'Abstract', ratio: 1.78 },
  { photo: '1618005182384-a83a8bd57fbe', title: 'Soft Geometry', category: 'Abstract', ratio: 1.25 },
  { photo: '1614850523459-c2f4c699c52e', title: 'Chromatic Bloom', category: 'Abstract', ratio: 1.5 },
  { photo: '1557682250-33bd709cbe85', title: 'Purple Haze', category: 'Abstract', ratio: 1.78 },
  { photo: '1550684376-efcbd6e3f031', title: 'Neon Ripples', category: 'Abstract', ratio: 1.33 },
  { photo: '1558470598-a5dda9640f68', title: 'Candy Wave', category: 'Abstract', ratio: 1.33 },
  { photo: '1486718448742-163732cd1544', title: 'Spiral Tower', category: 'Architecture', ratio: 1.5 },
  { photo: '1493397212122-2b85dda8106b', title: 'Honeycomb Facade', category: 'Architecture', ratio: 1.5 },
  { photo: '1480714378408-67cf0d13bc1b', title: 'City at Dusk', category: 'City', ratio: 0.67 },
  { photo: '1514565131-fce0801e5785', title: 'Gotham Nights', category: 'City', ratio: 1.5 },
  { photo: '1519608487953-e999c86e7455', title: 'Neon Alley', category: 'City', ratio: 1.5 },
  { photo: '1507525428034-b723cf961d3e', title: 'Turquoise Shore', category: 'Ocean', ratio: 0.67 },
  { photo: '1518837695005-2083093ee35b', title: 'Deep Swell', category: 'Ocean', ratio: 1.5 },
  { photo: '1503376780353-7e6692767b70', title: 'Apex Predator', category: 'Vehicles', ratio: 1.25 },
  { photo: '1546182990-dffeafbe841d', title: 'The King', category: 'Animals', ratio: 1.4 },
  { photo: '1494438639946-1ebd1d20bf85', title: 'White Arches', category: 'Minimal', ratio: 1.25 },
  { photo: '1493723843671-1d655e66ac1c', title: 'Monstera Shade', category: 'Minimal', ratio: 1.4 },
];

export const DEMO_WALLPAPERS: Wallpaper[] = SPECS.map((s, i) => {
  const views = 0;
  const downloads = 0;
  return {
    id: `demo:${i + 1}`,
    source: 'demo',
    source_id: String(i + 1),
    title: s.title,
    category: s.category,
    image_url: U(s.photo, 1600),
    thumb_url: U(s.photo, 700),
    width: 1600,
    height: Math.round(1600 * s.ratio),
    resolution: `1600x${Math.round(1600 * s.ratio)}`,
    views,
    downloads,
    is_featured: i % 5 === 0,
    is_premium: false,
    created_at: '1970-01-01T00:00:00.000Z',
  };
});

export const DEMO_CATEGORIES: Category[] = (() => {
  const map = new Map<string, Category>();
  for (const w of DEMO_WALLPAPERS) {
    const c = map.get(w.category!);
    if (c) c.wallpaper_count++;
    else
      map.set(w.category!, {
        id: `cat-${w.category}`,
        slug: w.category!.toLowerCase(),
        name: w.category!,
        cover_url: w.thumb_url,
        wallpaper_count: 1,
        is_premium: false,
        source: 'demo',
      });
  }
  return [...map.values()].sort((a, b) => b.wallpaper_count - a.wallpaper_count);
})();
