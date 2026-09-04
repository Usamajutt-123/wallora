import { requireAdmin } from '@/lib/auth';
import SyncButton from '@/components/admin/SyncButton';
import BlogButton from '@/components/admin/BlogButton';
import { getRecentSyncRuns } from '@/lib/db';
import { nexwallConfigured } from '@/lib/nexwall';
import { serviceKeyConfigured } from '@/lib/supabase';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API Sync' };

export default async function SyncPage({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  await requireAdmin(await searchParams);
  const runs = await getRecentSyncRuns();
  const ready = serviceKeyConfigured();

  const sources = [
    {
      name: 'NexWall API',
      desc: 'Categories + up to 15 wallpapers per bounded run',
      ok: nexwallConfigured(),
      envVar: 'NEXWALL_API_KEY',
    },
    {
      name: 'AnimePixels',
      desc: 'Anime franchise metadata + up to 15 wallpapers per run',
      ok: true, // keyless API
      envVar: 'no key needed 🎌',
    },
    {
      name: 'Wallhaven (safe)',
      desc: 'Curated shelves: Gaming, Space, AMOLED, Cyberpunk, Fantasy — SFW toplist + attribution',
      ok: true,
      envVar: 'key optional · toplist only',
    },
    {
      name: 'Supabase',
      desc: 'Destination database (URL-form storage)',
      ok: ready,
      envVar: 'SUPABASE_SERVICE_ROLE_KEY',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-3xl tracking-tight">API Sync</h1>
        <p className="text-sm text-white/45 mt-1">
          Pull a bounded batch from all three sources into Supabase. This spends source requests; atomic reservations allow at most 15 new rows per source / 45 total per Pakistan-local day.
        </p>
      </div>

      {/* source status */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {sources.map((s) => (
          <div key={s.name} className="glass rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <p className="font-display font-semibold">{s.name}</p>
              <span
                className={`w-2.5 h-2.5 rounded-full ${s.ok ? 'bg-accent2 shadow-[0_0_12px_rgba(198,244,50,0.8)]' : 'bg-red-400'}`}
                title={s.ok ? 'ready' : 'missing key'}
              />
            </div>
            <p className="text-xs text-white/45 mt-2">{s.desc}</p>
            <p className="text-[10px] font-mono text-white/30 mt-3">{s.envVar}</p>
          </div>
        ))}
      </div>

      {/* trigger */}
      <div className="glass rounded-3xl p-7">
        {ready ? (
          <SyncButton />
        ) : (
          <div className="text-sm text-white/50 space-y-3">
            <p className="font-display font-semibold text-white text-lg">Almost there —</p>
            <p>
              Add your Supabase keys to <code className="bg-white/10 px-1.5 py-0.5 rounded">.env.local</code> (run the SQL from{' '}
              <code className="bg-white/10 px-1.5 py-0.5 rounded">supabase/schema.sql</code> first), restart the dev server,
              then come back and hit sync.
            </p>
            <SyncButton disabled />
          </div>
        )}
      </div>

      {/* history */}
      <div className="glass rounded-3xl p-6">
        <h2 className="font-display font-semibold text-lg mb-4">Recent sync runs</h2>
        {runs.length ? (
          <ul className="divide-y divide-white/[0.06] text-sm">
            {runs.map((r: any) => (
              <li key={r.id} className="py-3 flex items-center gap-4">
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/55 shrink-0">
                  {r.source}
                </span>
                <span className="font-display font-semibold text-accent2">+{r.inserted}</span>
                <span className="text-white/45 truncate flex-1">{r.note}</span>
                <span className="text-white/30 text-xs shrink-0">{timeAgo(r.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-white/35">No runs recorded yet — your first sync will show up here.</p>
        )}
      </div>

      {/* AI blog generator — same engine as the Mon/Wed/Fri Vercel cron */}
      <BlogButton />
    </div>
  );
}
