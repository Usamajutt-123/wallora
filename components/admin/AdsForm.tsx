'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AdsConfig, SlotId } from '@/lib/ads';

export default function AdsForm({
  initial,
  meta,
}: {
  initial: AdsConfig;
  meta: Record<SlotId, { label: string; hint: string }>;
}) {
  const [cfg, setCfg] = useState<AdsConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sk = useSearchParams().get('sk');

  const setSlot = (id: SlotId, patch: Partial<AdsConfig[SlotId]>) =>
    setCfg((c) => ({ ...c, [id]: { ...c[id], ...patch } }));

  async function save() {
    if (busy) return;
    setBusy(true);
    setNote('Saving…');
    try {
      const url = `/api/admin/ads${sk ? `?sk=${encodeURIComponent(sk)}` : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      setNote(data.ok ? `✅ Saved (${data.stored === 'supabase' ? 'Supabase' : 'local demo file'}); enabled slots appear after the next render.` : `✖ ${data.error}`);
    } catch {
      setNote('✖ Network error');
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      {(Object.keys(meta) as SlotId[]).map((id) => (
        <div key={id} className="glass rounded-3xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-display font-semibold">{meta[id].label}</p>
              <p className="text-xs text-white/40 mt-0.5">{meta[id].hint}</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-white/40">Height (px)</label>
              <input
                type="number"
                min={50}
                max={600}
                value={cfg[id].height}
                onChange={(e) => setSlot(id, { height: Number(e.target.value) || 96 })}
                className="w-20 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm outline-none focus:border-accent2/50"
              />
              <button
                type="button"
                onClick={() => setSlot(id, { enabled: !cfg[id].enabled })}
                className={`relative w-11 h-6 rounded-full transition ${cfg[id].enabled ? 'bg-accent2' : 'bg-white/10'}`}
                aria-label={`toggle ${id}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-black transition-all ${cfg[id].enabled ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </div>
          </div>
          <textarea
            value={cfg[id].code}
            onChange={(e) => setSlot(id, { code: e.target.value })}
            placeholder='<script type="text/javascript" src="//…">…full ad snippet…</script>'
            rows={4}
            spellCheck={false}
            className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-xs font-mono text-white/80 outline-none focus:border-accent2/50 placeholder:text-white/20 resize-y"
          />
        </div>
      ))}

      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-2xl bg-accent hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-8 py-3.5 transition-colors"
        >
          {busy ? 'Saving…' : 'Save ad slots'}
        </button>
        {note && <p className="text-sm text-white/60">{note}</p>}
      </div>
    </div>
  );
}
