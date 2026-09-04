import { requireAdmin } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import WallpaperEditorForm, { type WallpaperEditorValue } from '@/components/admin/WallpaperEditorForm';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit wallpaper' };

export default async function EditWallpaperPage({ searchParams }: { searchParams: Promise<{ id?: string; sk?: string }> }) {
  const query = await searchParams;
  await requireAdmin(query);
  const rawId = query.id ?? '';
  const separator = rawId.indexOf(':');
  if (separator < 1) notFound();
  const source = rawId.slice(0, separator);
  const sourceId = rawId.slice(separator + 1);
  if (!['nexwall', 'animepixels', 'wallhaven', 'manual'].includes(source) || !/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) notFound();
  const sb = getServiceSupabase();
  if (!sb) notFound();

  const { data } = await sb.from('wallpapers').select('*').eq('source', source).eq('source_id', sourceId).maybeSingle();
  if (!data) notFound();

  const initial: WallpaperEditorValue = {
    id: rawId,
    source: data.source,
    title: data.title ?? '',
    category: data.category ?? '',
    description: data.seo_description ?? '',
    image_url: data.image_url ?? '',
    thumb_url: data.thumb_url ?? '',
    source_url: data.source_url ?? '',
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
    resolution: data.resolution ?? '',
    tags: data.tags ?? '',
    seo_title: data.seo_title ?? '',
    seo_keywords: data.seo_keywords ?? '',
    seo_alt: data.seo_alt ?? '',
    is_featured: Boolean(data.is_featured),
    is_premium: Boolean(data.is_premium),
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-display tracking-[0.24em] uppercase text-accent2">Wallpaper manager</p>
        <h1 className="mt-1 font-display font-bold text-3xl tracking-tight">Edit wallpaper</h1>
        <p className="mt-2 text-sm text-white/45">Update the title, custom description, image URLs or SEO metadata.</p>
      </div>
      <WallpaperEditorForm initial={initial} />
    </div>
  );
}
