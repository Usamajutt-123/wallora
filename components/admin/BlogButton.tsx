'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Admin: manually ask Gemini to write & publish one blog post (same engine as the Mon/Wed/Fri cron). */
export default function BlogButton() {
  const sk = useSearchParams().get('sk');
  const router = useRouter();
  const api = (u: string) => (sk ? `${u}${u.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : u);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [topic, setTopic] = useState('');

  async function run() {
    if (busy) return;
    setBusy(true);
    setNote('✍️ Gemini is writing the post…');
    try {
      const res = await fetch(api('/api/admin/blog-generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(topic.trim() ? { topic: topic.trim() } : {}),
      });
      const data = await res.json();
      setNote(
        data.ok
          ? `✅ Saved as PENDING: “${data.title}” → open it below, review/fix, then set Published.`
          : `✖ ${data.error}`,
      );
      if (data.ok) router.refresh();
    } catch {
      setNote('✖ Network error');
    }
    setBusy(false);
  }

  return (
    <div className="glass rounded-3xl p-6 space-y-3">
      <p className="font-display font-semibold">🤖 AI Blog Writer</p>
      <p className="text-xs text-white/45">
        The protected Vercel cron attempts one draft every <b>Mon / Wed / Fri at 2:00 PM PKT</b>.
        Everything AI writes is saved as <b>PENDING</b> — it only goes public after you review it here
        and set the status to Published. You can also trigger a manual article with an optional custom topic.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder='Optional topic, e.g. "Choosing wallpapers for an ultrawide"'
          maxLength={240}
          className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm outline-none focus:border-accent2/50 placeholder:text-white/25"
        />
        <button
          onClick={run}
          disabled={busy}
          className="rounded-xl bg-accent2/90 hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-5 py-2.5 text-sm transition-colors"
        >
          {busy ? 'Writing…' : '✍️ Write draft'}
        </button>
      </div>
      {note && <p className="text-xs text-white/60">{note}</p>}
    </div>
  );
}
