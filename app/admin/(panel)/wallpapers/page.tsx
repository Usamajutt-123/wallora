import { requireAdmin } from '@/lib/auth';
import RowActions from '@/components/admin/RowActions';
import DescriptionRefreshButton from '@/components/admin/DescriptionRefreshButton';
import { getServiceSupabase } from '@/lib/supabase';
import { imgUrl } from '@/lib/img';
import { fmt } from '@/lib/utils';
import Link from 'next/link';
import { isHardBlockedWallpaper } from '@/lib/filters';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Wallpapers' };

const PAGE_SIZE = 20;

export default async function AdminWallpapers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; source?: string; sk?: string }>;
}) {
  const queryParams = await searchParams;
  const sb = getServiceSupabase();
  await requireAdmin(queryParams);
  const q = queryParams.q?.replace(/\s+/g, ' ').trim().slice(0, 100) ?? '';
  const source = ['manual', 'nexwall', 'animepixels', 'wallhaven'].includes(queryParams.source ?? '')
    ? queryParams.source!
    : '';
  const page = Math.min(10_000, Math.max(1, Math.floor(Number(queryParams.page) || 1)));
  const sk = queryParams.sk;
  const withSk = (url: string) => {
    if (!sk) return url;
    return `${url}${url.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}`;
  };

  if (!sb) {
    return (
      <div className="glass rounded-3xl p-10 text-center">
        <h1 className="font-display font-bold text-2xl">Wallpaper manager</h1>
        <p className="mt-3 text-white/50 text-sm max-w-md mx-auto">
          Demo mode — once your Supabase keys are in <code className="bg-white/10 px-1.5 py-0.5 rounded">.env.local</code> and
          you&apos;ve run a sync, every wallpaper will be manageable from right here.
        </p>
      </div>
    );
  }

  let query = sb
    .from('wallpapers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (q) query = query.ilike('title', `%${q}%`);
  if (source) query = query.eq('source', source);

  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const lastPage = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const pageUrl = (n: number) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (source) p.set('source', source);
    if (sk) p.set('sk', sk);
    p.set('page', String(n));
    return `/admin/wallpapers?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-3xl tracking-tight">Wallpapers</h1>
          <p className="text-sm text-white/45 mt-1">{fmt(count ?? 0)} in the library</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DescriptionRefreshButton />
          <Link
            href={withSk('/admin/wallpapers/new')}
            className="inline-flex items-center gap-2 rounded-xl bg-accent hover:bg-accent2 text-black font-display font-semibold text-sm px-5 py-2.5 transition-colors"
          >
            + Add manually
          </Link>
          <Link
            href={withSk('/admin/sync')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 hover:bg-white/5 text-white/60 font-display font-semibold text-sm px-4 py-2.5 transition-colors"
          >
            API Sync
          </Link>
        </div>
      </div>

      {/* filters */}
      <form className="flex flex-wrap gap-2" action="/admin/wallpapers">
        {sk && <input type="hidden" name="sk" value={sk} />}
        <div className="flex items-center glass rounded-full pl-4 pr-1 py-1">
          <input name="q" defaultValue={q} placeholder="Search title…" className="bg-transparent outline-none text-sm w-44 placeholder:text-white/30" />
          <button className="rounded-full bg-white/10 hover:bg-accent hover:text-black px-4 py-1.5 text-sm transition">Search</button>
        </div>
        {['', 'manual', 'nexwall', 'animepixels', 'wallhaven'].map((s) => (
          <Link
            key={s || 'all'}
            href={withSk(s ? `/admin/wallpapers?source=${s}` : '/admin/wallpapers')}
            className={`rounded-full px-4 py-2 text-sm border transition ${
              source === s ? 'bg-accent text-black border-accent font-semibold' : 'glass text-white/60 hover:text-white'
            }`}
          >
            {s ? s : 'All sources'}
          </Link>
        ))}
      </form>

      {/* table */}
      <div className="glass rounded-3xl p-4 sm:p-6">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.2em] text-white/35 border-b border-white/[0.07]">
                <th className="pb-3 pr-4">Wallpaper</th>
                <th className="pb-3 pr-4">Source</th>
                <th className="pb-3 pr-4">Category</th>
                <th className="pb-3 pr-4 text-right">Views</th>
                <th className="pb-3 pr-4 text-right">Downloads</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((w: any) => {
                const blocked = isHardBlockedWallpaper(w);
                return (
                <tr key={`${w.source}-${w.source_id}`} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      {blocked ? (
                        <span className="grid w-14 h-9 place-items-center rounded-lg border border-red-400/20 bg-red-400/10 text-[9px] text-red-300">BLOCKED</span>
                      ) : (
                        <img src={imgUrl(w.thumb_url || w.image_url)} alt="" className="w-14 h-9 object-cover rounded-lg border border-white/10" loading="lazy" />
                      )}
                      <span className="font-medium truncate max-w-[240px]">{w.title}</span>
                      {w.is_featured && <span title="Featured">⭐</span>}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/55">{w.source}</span>
                  </td>
                  <td className="py-3 pr-4 text-white/50">{w.category ?? '—'}</td>
                  <td className="py-3 pr-4 text-right font-display">{fmt(w.views ?? 0)}</td>
                  <td className="py-3 pr-4 text-right text-white/60">{fmt(w.downloads ?? 0)}</td>
                  <td className="py-3 text-right">
                    <RowActions id={`${w.source}:${w.source_id}`} featured={!!w.is_featured} />
                  </td>
                </tr>
                );
              })}
              {!(data ?? []).length && (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-white/40">
                    Nothing here yet — run a sync from the API Sync tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {lastPage > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3 text-sm">
            {page > 1 && (
              <Link href={pageUrl(page - 1)} className="glass rounded-full px-4 py-2 text-white/70 hover:text-white transition">
                ← Prev
              </Link>
            )}
            <span className="text-white/40">
              Page {page} / {lastPage}
            </span>
            {page < lastPage && (
              <Link href={pageUrl(page + 1)} className="glass rounded-full px-4 py-2 text-white/70 hover:text-white transition">
                Next →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
