#!/usr/bin/env node
/* One-time: fetch REAL tags for every tag-less Wallhaven wallpaper from the
   per-wall endpoint (the list API ships none) and store them.
     node scripts/wallhaven-tags-backfill.mjs
   Factual data — never fabricated. Gentles the public API (~0.9s between calls).
   Failures are counted and listed; re-run to retry the leftovers. */
import dotenv from 'dotenv';
dotenv.config({ path: '/home/user/wallora-fixed/.env.local', quiet: true });
dotenv.config({ quiet: true });
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class {};
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTags(id) {
  const res = await fetch(`https://wallhaven.cc/api/v1/w/${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (WALLORA backfill)', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429) throw Object.assign(new Error('rate'), { rate: true });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return (json?.data?.tags ?? [])
    .filter((t) => t.type !== 'meta')
    .map((t) => String(t.name || '').replace(/\s+/g, ' ').trim())
    .filter((n) => n.length >= 2 && n.length <= 60);
}

let ok = 0, fail = 0, start = 0;
const fails = [];
while (true) {
  const { data, error } = await sb.from('wallpapers')
    .select('source_id').eq('source', 'wallhaven')
    .or('tags.is.null,tags.eq.')
    .order('created_at', { ascending: true })
    .range(start, start + 199);
  if (error) { console.log('query error:', error.message.slice(0, 120)); break; }
  const batch = data ?? [];
  if (!batch.length) break;
  for (const r of batch) {
    const id = String(r.source_id);
    try {
      const tags = await fetchTags(id);
      if (!tags.length) { fail++; fails.push(`${id}:no-tags`); }
      else {
        const { error: up } = await sb.from('wallpapers').update({ tags: tags.join(', ').slice(0, 500) }).eq('source', 'wallhaven').eq('source_id', id);
        if (up) throw new Error('db:' + up.message.slice(0, 60));
        ok++;
      }
    } catch (e) {
      fail++;
      if (fails.length < 20) fails.push(`${id}:${String(e.message || e).slice(0, 50)}`);
      if (e?.rate) await sleep(20000); // slow down politely
    }
    if ((ok + fail) % 20 === 0) console.log(`… ${ok + fail} done (ok=${ok} fail=${fail})`);
    await sleep(900);
  }
  if (batch.length < 200) break;
  start += 200;
}
console.log(`\n== FINISHED ok=${ok} fail=${fail}`);
if (fails.length) console.log('sample fails:', fails.slice(0, 10).join(' | '));
process.exit(0);
