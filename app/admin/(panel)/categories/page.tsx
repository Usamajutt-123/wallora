import { requireAdmin } from '@/lib/auth';
import { getCategoriesRaw } from '@/lib/db';
import { getServiceSupabase } from '@/lib/supabase';
import CategoryCoversManager from '@/components/admin/CategoryCoversManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Category covers' };

export default async function CategoryCoversPage({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  await requireAdmin(await searchParams);
  const [raw, sb] = await Promise.all([getCategoriesRaw(), Promise.resolve(getServiceSupabase())]);

  const custom = new Map<string, string>();
  if (sb) {
    try {
      const { data } = await sb.from('categories').select('name, cover_url').eq('source', 'custom');
      for (const row of data ?? []) {
        const url = String(row.cover_url ?? '');
        if (url) custom.set(String(row.name), url);
      }
    } catch {
      /* custom covers optional */
    }
  }

  const items = raw.map((category) => ({
    name: category.name,
    source: category.source,
    count: category.wallpaper_count,
    autoCover: category.cover_url || '',
    cover: custom.get(category.name) || category.cover_url || '',
    custom: custom.has(category.name),
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-display tracking-[0.24em] uppercase text-accent2">Discover</p>
        <h1 className="mt-1 font-display font-bold text-3xl tracking-tight">Category covers</h1>
        <p className="mt-2 text-sm text-white/45">
          Set the cover for every card in the home page “Pick your vibe” section and on the Categories page —
          choose from any category’s wallpapers, upload from your device, or reset to the default.
        </p>
      </div>
      <CategoryCoversManager items={items} />
    </div>
  );
}
