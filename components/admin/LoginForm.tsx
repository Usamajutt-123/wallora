'use client';

import { useState } from 'react';

export default function LoginForm({ showDefaultHint }: { showDefaultHint: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      // cookie bridge for iframes that drop cookies — token-in-URL fallback keeps the session going
      const data = await res.json().catch(() => null);
      const sk = data?.token ? `?sk=${encodeURIComponent(data.token)}` : '';
      window.location.assign(`/admin${sk}`); // full navigation → fresh session everywhere
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? 'Login failed');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass rounded-3xl p-7">
      <label className="block text-xs font-display tracking-[0.25em] text-white/45 uppercase mb-2">
        Username
      </label>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="admin"
        autoComplete="username"
        className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-accent/70 transition"
      />
      <label className="block text-xs font-display tracking-[0.25em] text-white/45 uppercase mt-4 mb-2">
        Password
      </label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        autoFocus
        autoComplete="current-password"
        className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-accent/70 transition"
      />
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {showDefaultHint && (
        <p className="mt-3 text-xs text-accent2/80">
          Supabase admin banaya hai to username+password se login karo; warna default password{' '}
          <code className="bg-white/10 px-1.5 py-0.5 rounded">wallora-admin</code> (ADMIN_PASSWORD set karo!)
        </p>
      )}
      <button
        disabled={busy || !password}
        className="mt-5 w-full rounded-xl bg-accent hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold py-3.5 transition-colors"
      >
        {busy ? 'Opening the vault…' : 'Enter dashboard'}
      </button>
    </form>
  );
}
