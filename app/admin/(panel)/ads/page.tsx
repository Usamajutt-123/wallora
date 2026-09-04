import { requireAdmin } from '@/lib/auth';
import { getAdsConfig, SLOT_META } from '@/lib/ads';
import AdsForm from '@/components/admin/AdsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ad slots' };

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  await requireAdmin(await searchParams);
  const cfg = await getAdsConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-3xl tracking-tight">Ad Slots</h1>
        <p className="text-sm text-white/45 mt-1">
          Paste your <b>Adsterra</b>, <b>Monetag</b>, or <b>AdSense</b> snippets here — enabled slots are served site-wide after a successful save.
          AdSense is auto-detected and rendered natively; other networks render in a safe sandboxed frame.
        </p>
      </div>

      <div className="rounded-2xl border border-accent2/25 bg-accent2/[0.06] px-5 py-4 text-xs text-accent2/80 space-y-1">
        <p>💡 <b>Adsterra/Monetag:</b> copy the "Social Bar" / "Banner" <i>script tag</i> from their dashboard and paste the whole snippet.</p>
        <p>💡 <b>AdSense:</b> paste the full <code className="bg-black/40 px-1 py-0.5 rounded">&lt;ins class="adsbygoogle"…&gt;</code> unit snippet (with script). Units serve only after AdSense approves your domain.</p>
      </div>

      <AdsForm initial={cfg} meta={SLOT_META} />
    </div>
  );
}
