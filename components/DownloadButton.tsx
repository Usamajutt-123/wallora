'use client';

import { useState } from 'react';
import { imgUrl } from '@/lib/img';

export default function DownloadButton({ id, imageUrl, title }: { id: string; imageUrl: string; title: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function download() {
    setState('busy');
    // count the download (fire & forget)
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type: 'download' }),
    }).catch(() => {});

    const src = imgUrl(imageUrl); // known CDNs use the same-origin cache; manual HTTPS hosts remain direct
    if (!src) {
      setState('idle');
      return;
    }
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      if (!blob.type.toLowerCase().startsWith('image/')) throw new Error();
      const extension: Record<string, string> = {
        'image/png': 'png',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/gif': 'gif',
      };
      const ext = extension[blob.type.toLowerCase()] || 'jpg';
      const name = `wallora-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || id}.${ext}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setState('done');
    } catch {
      // A custom CDN may deny CORS; let the browser open its HTTPS image instead.
      const fallback = document.createElement('a');
      fallback.href = src;
      fallback.target = '_blank';
      fallback.rel = 'noopener noreferrer';
      fallback.click();
      setState('done');
    }
    setTimeout(() => setState('idle'), 2500);
  }

  return (
    <button
      onClick={download}
      disabled={state === 'busy'}
      className="group inline-flex w-full items-center justify-center gap-2.5 rounded-2xl bg-accent hover:bg-accent2 disabled:opacity-70 text-black font-display font-bold text-base px-8 py-4 transition-colors"
    >
      {state === 'busy' ? (
        <>
          <span className="w-5 h-5 rounded-full border-2 border-black border-t-transparent animate-spin" />
          Preparing…
        </>
      ) : state === 'done' ? (
        <>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
          Saved — enjoy!
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="w-5 h-5 transition-transform group-hover:translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
          </svg>
          Download image
        </>
      )}
    </button>
  );
}
