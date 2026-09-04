'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function RowActions({ id, featured }: { id: string; featured: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const sk = useSearchParams().get('sk');
  const editHref = `/admin/wallpapers/edit?id=${encodeURIComponent(id)}${sk ? `&sk=${encodeURIComponent(sk)}` : ''}`;
  const api = (url: string) => (sk ? `${url}${url.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : url);
  const [error, setError] = useState('');

  async function call(method: 'PATCH' | 'DELETE') {
    if (busy) return;
    if (method === 'DELETE' && !confirm('Delete this wallpaper permanently?')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        api(method === 'DELETE' ? `/api/admin/wallpapers?id=${encodeURIComponent(id)}` : '/api/admin/wallpapers'),
        method === 'DELETE'
          ? { method: 'DELETE' }
          : {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, is_featured: !featured }),
            },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Action failed.');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span title={error} className="text-xs text-red-400">!</span>}
      <Link
        href={editHref}
        title="Edit title, description and metadata"
        className="grid place-items-center w-8 h-8 rounded-full border border-white/15 text-white/40 hover:text-cyan-300 hover:border-cyan-300/50 transition"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
        </svg>
      </Link>
      <button
        onClick={() => call('PATCH')}
        disabled={busy}
        title={featured ? 'Unfeature' : 'Feature'}
        className={`grid place-items-center w-8 h-8 rounded-full border transition disabled:opacity-50 ${
          featured
            ? 'border-accent2/60 bg-accent2/15 text-accent2'
            : 'border-white/15 text-white/40 hover:text-accent2 hover:border-accent2/40'
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill={featured ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="m12 3 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7L12 3Z" />
        </svg>
      </button>
      <button
        onClick={() => call('DELETE')}
        disabled={busy}
        title="Delete"
        className="grid place-items-center w-8 h-8 rounded-full border border-white/15 text-white/40 hover:text-red-400 hover:border-red-400/50 transition disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h8l1-13" />
        </svg>
      </button>
    </div>
  );
}
