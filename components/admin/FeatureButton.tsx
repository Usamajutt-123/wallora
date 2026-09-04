'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function FeatureButton({ id, featured, demo }: { id: string; featured: boolean; demo?: boolean }) {
  const sk = useSearchParams().get('sk');
  const api = (u: string) => (sk ? `${u}${u.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : u);

  const [on, setOn] = useState(featured);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (demo || busy) return;
    setBusy(true);
    try {
      const res = await fetch(api('/api/admin/wallpapers'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_featured: !on }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setOn(!on);
    } catch {
      /* keep prior state; a later refresh can retry */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || demo}
      title={demo ? 'Demo mode — connect Supabase' : on ? 'Remove from featured' : 'Mark as featured'}
      className={`inline-grid place-items-center w-8 h-8 rounded-full border transition ${
        on
          ? 'border-accent2/60 bg-accent2/15 text-accent2'
          : 'border-white/15 text-white/35 hover:text-accent2 hover:border-accent2/40'
      } disabled:opacity-50`}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="m12 3 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7L12 3Z" />
      </svg>
    </button>
  );
}
