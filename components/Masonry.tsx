import type { Wallpaper } from '@/lib/types';
import WallCard from './WallCard';

export default function Masonry({ items }: { items: Wallpaper[] }) {
  return (
    <div className="masonry columns-2 sm:columns-3 lg:columns-4 2xl:columns-5">
      {items.map((w) => (
        <WallCard key={w.id} w={w} />
      ))}
    </div>
  );
}
