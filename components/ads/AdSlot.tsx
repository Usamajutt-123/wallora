'use client';

import { useEffect, useRef } from 'react';
import type { SlotId, AdSlotConfig } from '@/lib/ads';

function isAdSense(code: string): boolean {
  return /pagead2\.googlesyndication|adsbygoogle/.test(code);
}

/** Extract key attributes out of a pasted AdSense snippet. */
function parseAdSense(code: string) {
  const pick = (name: string) => code.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
  const client = pick('data-ad-client');
  const slot = pick('data-ad-slot');
  return {
    client: /^ca-pub-\d+$/.test(client) ? client : '',
    slot: /^\d+$/.test(slot) ? slot : '',
    format: pick('data-ad-format') || 'auto',
    responsive: /data-full-width-responsive="true"/.test(code),
  };
}

function AdSenseUnit({ code, height }: { code: string; height: number }) {
  const ref = useRef<HTMLModElement>(null);
  const { client, slot, format, responsive } = parseAdSense(code);

  useEffect(() => {
    if (!client) return;
    // load adsbygoogle.js once per client id
    if (!document.querySelector(`script[src*="adsbygoogle.js?client=${client}"]`)) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
    }
    const t = setTimeout(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
      } catch {
        /* adsbygoogle not ready/blocked — fine */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [client]);

  if (!client || !slot) return null;
  return (
    <ins
      ref={ref}
      className="adsbygoogle"
      style={{ display: 'block', minHeight: height }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive={responsive ? 'true' : 'false'}
    />
  );
}

/** Adsterra/Monetag style snippet → isolated iframe (document.write-safe). */
function IframeUnit({ code, height, id }: { code: string; height: number; id: SlotId }) {
  return (
    <iframe
      title={`ad-${id}`}
      srcDoc={`<!doctype html><html><head><style>html,body{margin:0;padding:0;display:flex;align-items:center;justify-content:center;height:100%;background:transparent}</style></head><body>${code}</body></html>`}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={{ width: '100%', height, border: 0, display: 'block' }}
      loading="lazy"
    />
  );
}

export default function AdSlot({ id, config }: { id: SlotId; config: AdSlotConfig }) {
  const live = config?.enabled && config.code.trim().length > 8;

  if (!live) {
    // Dev placeholder — shows placement until a real snippet is pasted (dev only)
    if (process.env.NODE_ENV !== 'development') return null;
    return (
      <div
        className="w-full rounded-2xl border-2 border-dashed border-white/[0.09] bg-white/[0.02] flex flex-col items-center justify-center gap-1"
        style={{ height: config?.height ?? 96 }}
      >
        <span className="text-[10px] font-display tracking-[0.3em] text-white/25 uppercase">Ad slot</span>
        <span className="text-xs text-white/30">{id} — enable from /admin/ads</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="text-[9px] tracking-[0.35em] uppercase text-white/25 text-center mb-1.5">Advertisement</p>
      <div className="mx-auto max-w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        {isAdSense(config.code) ? (
          <AdSenseUnit code={config.code} height={config.height} />
        ) : (
          <IframeUnit code={config.code} height={config.height} id={id} />
        )}
      </div>
    </div>
  );
}
