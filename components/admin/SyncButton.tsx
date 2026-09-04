'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SyncButton({ disabled }: { disabled?: boolean }) {
  const sk = useSearchParams().get('sk');
  const api = (u: string) => (sk ? `${u}${u.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : u);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function run() {
    if (busy) return;
    setBusy(true);
    setLog(['→ Contacting APIs…']);
    try {
      const res = await fetch(api('/api/admin/sync'), { method: 'POST' });
      const data = await res.json();
      setLog(data.log ?? [data.error ?? 'Sync failed']);
    } catch {
      setLog(['✖ Network error — sync aborted']);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <button
        onClick={run}
        disabled={busy || disabled}
        className="inline-flex items-center gap-3 rounded-2xl bg-accent hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-8 py-4 transition-colors"
      >
        {busy ? (
          <>
            <span className="w-5 h-5 rounded-full border-2 border-black border-t-transparent animate-spin" />
            Syncing — keep this tab open…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" />
            </svg>
            Sync all APIs now
          </>
        )}
      </button>

      {log.length > 0 && (
        <div className="rounded-2xl bg-black/60 border border-white/10 p-5 font-mono text-xs leading-relaxed text-accent2/90 whitespace-pre-wrap">
          {log.join('\n')}
        </div>
      )}
    </div>
  );
}
