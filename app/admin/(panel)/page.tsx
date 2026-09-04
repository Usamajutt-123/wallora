import { requireAdmin } from '@/lib/auth';
import { getDashboardStats } from '@/lib/db';
import { imgUrl } from '@/lib/img';
import { fmt } from '@/lib/utils';
import LineChart, { SourceBar } from '@/components/admin/Charts';
import FeatureButton from '@/components/admin/FeatureButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  const query = await searchParams;
  await requireAdmin(query);
  const stats = await getDashboardStats();
  const syncHref = query.sk ? `/admin/sync?sk=${encodeURIComponent(query.sk)}` : '/admin/sync';
  const categoriesHref = query.sk ? `/admin/categories?sk=${encodeURIComponent(query.sk)}` : '/admin/categories';
  const srcTotal =
    stats.bySource.nexwall + stats.bySource.wallhaven + stats.bySource.animepixels + stats.bySource.manual + stats.bySource.demo;

  const cards = [
    { label: 'Total wallpapers', value: fmt(stats.totals.walls), icon: '🖼️', sub: `${fmt(stats.totals.walls)} in library` },
    { label: 'All-time views', value: fmt(stats.totals.views), icon: '👁️', sub: `+${fmt(stats.totals.todayViews)} today` },
    { label: 'All-time downloads', value: fmt(stats.totals.downloads), icon: '⬇️', sub: `+${fmt(stats.totals.todayDownloads)} today` },
    {
      label: 'Conversion',
      value: stats.totals.views ? `${Math.round((stats.totals.downloads / stats.totals.views) * 100)}%` : '—',
      icon: '⚡',
      sub: 'views → downloads',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-3xl tracking-tight">
            Dashboard {stats.demo && <span className="text-xs align-middle rounded-full bg-accent2/15 text-accent2 px-2.5 py-1 ml-2 tracking-widest">DEMO</span>}
          </h1>
          <p className="text-sm text-white/45 mt-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <a
          href={syncHref}
          className="inline-flex items-center gap-2 rounded-xl bg-accent hover:bg-accent2 text-black font-display font-semibold text-sm px-5 py-2.5 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" />
          </svg>
          Sync APIs
        </a>
        <a
          href={categoriesHref}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 hover:border-accent2/60 hover:bg-white/5 text-white/80 font-display font-semibold text-sm px-5 py-2.5 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
          Category covers
        </a>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-3xl p-5 hover:border-accent/40 transition">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-display tracking-[0.25em] uppercase text-white/40">{c.label}</p>
              <span className="text-lg">{c.icon}</span>
            </div>
            <p className="font-display font-bold text-3xl mt-2 text-grad">{c.value}</p>
            <p className="text-xs text-white/40 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* chart + sources */}
      <div className="grid lg:grid-cols-[1fr_300px] gap-4">
        <div className="glass rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-lg">Traffic — last 14 days</h2>
          </div>
          <LineChart series={stats.series} />
        </div>

        <div className="glass rounded-3xl p-6">
          <h2 className="font-display font-semibold text-lg mb-5">Library sources</h2>
          <div className="space-y-5">
            <SourceBar label="NexWall" value={stats.bySource.nexwall} total={srcTotal} color="linear-gradient(90deg,#7C6CFF,#A78BFA)" />
            <SourceBar label="AnimePixels" value={stats.bySource.animepixels} total={srcTotal} color="linear-gradient(90deg,#F472B6,#7C6CFF)" />
            <SourceBar label="Wallhaven" value={stats.bySource.wallhaven} total={srcTotal} color="linear-gradient(90deg,#C6F432,#7C6CFF)" />
            {stats.bySource.manual > 0 && (
              <SourceBar label="Manual" value={stats.bySource.manual} total={srcTotal} color="linear-gradient(90deg,#22D3EE,#C6F432)" />
            )}
            {stats.bySource.demo > 0 && (
              <SourceBar label="Demo" value={stats.bySource.demo} total={srcTotal} color="rgba(255,255,255,0.35)" />
            )}
          </div>
          <p className="mt-6 text-xs text-white/35 leading-relaxed">
            Sources refresh when you run a sync from the API Sync tab.
          </p>
        </div>
      </div>

      {/* top wallpapers */}
      <div className="glass rounded-3xl p-6">
        <h2 className="font-display font-semibold text-lg mb-5">Top performing walls</h2>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.2em] text-white/35 border-b border-white/[0.07]">
                <th className="pb-3 pr-4">#</th>
                <th className="pb-3 pr-4">Wallpaper</th>
                <th className="pb-3 pr-4">Category</th>
                <th className="pb-3 pr-4 text-right">Views</th>
                <th className="pb-3 pr-4 text-right">Downloads</th>
                <th className="pb-3 text-right">Featured</th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((w, i) => (
                <tr key={w.id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition">
                  <td className="py-3 pr-4 font-display text-white/35">{String(i + 1).padStart(2, '0')}</td>
                  <td className="py-3 pr-4">
                    <a href={`/wallpaper/${encodeURIComponent(w.id)}`} className="flex items-center gap-3 group">
                      <img src={imgUrl(w.thumb_url)} alt="" className="w-14 h-9 object-cover rounded-lg border border-white/10" loading="lazy" />
                      <span className="font-medium truncate max-w-[220px] group-hover:text-accent2 transition">{w.title}</span>
                    </a>
                  </td>
                  <td className="py-3 pr-4 text-white/50">{w.category ?? '—'}</td>
                  <td className="py-3 pr-4 text-right font-display">{fmt(w.views)}</td>
                  <td className="py-3 pr-4 text-right text-white/60">{fmt(w.downloads)}</td>
                  <td className="py-3 text-right">
                    <FeatureButton id={w.id} featured={w.is_featured} demo={stats.demo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
