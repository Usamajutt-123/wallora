import { requireAdmin } from '@/lib/auth';
import WallpaperEditorForm from '@/components/admin/WallpaperEditorForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add wallpaper' };

export default async function NewWallpaperPage({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  await requireAdmin(await searchParams);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-display tracking-[0.24em] uppercase text-accent2">Manual publishing</p>
        <h1 className="mt-1 font-display font-bold text-3xl tracking-tight">Add a wallpaper</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">Add a CDN or ImgBB URL, accurate image metadata and original copy. No source API request is used.</p>
      </div>
      <WallpaperEditorForm />
    </div>
  );
}
