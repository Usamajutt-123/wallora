'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function DescriptionRefreshButton() {
  const router = useRouter();
  const sk = useSearchParams().get('sk');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function run() {
    if (busy) return;
    if (!confirm('Fill missing and old template descriptions? Existing custom/AI descriptions and manual wallpapers will be preserved.')) return;
    setBusy(true);
    setNote('Building varied descriptions from saved metadata…');
    try {
      const url = `/api/admin/wallpaper-descriptions${sk ? `?sk=${encodeURIComponent(sk)}` : ''}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5000, overwrite: false }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Update failed.');
      setNote(`Done: ${data.updated} descriptions updated; ${data.preserved} custom descriptions preserved.`);
      router.refresh();
    } catch (error) {
      setNote(`Error: ${error instanceof Error ? error.message : 'Update failed.'}`);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl border border-accent2/35 bg-accent2/[0.08] hover:bg-accent2/15 disabled:opacity-60 text-accent2 font-display font-semibold text-sm px-4 py-2.5 transition"
      >
        <span aria-hidden>✦</span>
        {busy ? 'Fixing descriptions…' : 'Fix old descriptions'}
      </button>
      {note && <p className="max-w-sm text-right text-[11px] text-white/45">{note}</p>}
    </div>
  );
}
