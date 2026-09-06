#!/usr/bin/env node
/* One-time backfill: mirror all unmirrored stored wallpapers of given sources
   to Cloudinary (or legacy ImgBB when Cloudinary is not configured) and store
   the returned URL in mirror_url. Run from the project dir:
     node scripts/backfill-imgbb.mjs nexwall wallhaven
   Best-effort per image; failures are counted, never fatal. */
import dotenv from 'dotenv';
dotenv.config({ path: '/home/user/wallora-fixed/.env.local', quiet: true });
dotenv.config({ quiet: true });
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class {};

import { createClient } from '@supabase/supabase-js';
import { mirrorBackend, uploadMirror } from './mirror-upload.mjs';

const sources = process.argv.slice(2);
if (!sources.length) { console.error('pass sources, e.g. nexwall wallhaven'); process.exit(1); }

const backend = mirrorBackend();
if (!backend) {
  console.error('Cloudinary credentials or IMGBB_API_KEY missing');
  process.exit(1);
}
console.log(`mirror backend: ${backend}`);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ALLOWED = ['kodnextech.com','nexwall.app','nexwallcdn.com','cloudinary.com','anima-image-api.vercel.app','wallhaven.cc'];
const trusted = (u) => {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    if (host === 'i.ibb.co' || host === 'ibb.co') return null;
    return url.protocol === 'https:' && !url.username && !url.password &&
      ALLOWED.some((d) => host === d || host.endsWith('.' + d)) ? url.toString() : null;
  } catch { return null; }
};

async function download(url) {
  let cur = new URL(url);
  for (let i = 0; i <= 4; i++) {
    const res = await fetch(cur, { headers: { 'User-Agent': 'Mozilla/5.0 (WALLORA backfill)', Accept: 'image/*,*/*;q=0.8' }, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new Error('redirect-no-target');
      cur = new URL(loc, cur);
      if (!trusted(cur.toString())) throw new Error('untrusted-redirect');
      continue;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = (res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(type)) throw new Error('type ' + type);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 40 * 1024 * 1024) throw new Error('too-large');
    return { buffer: buf, type };
  }
  throw new Error('too-many-redirects');
}

for (const source of sources) {
  let ok = 0, fail = 0, done = 0, start = 0;
  const fails = [];
  while (true) {
    const { data, error } = await sb.from('wallpapers')
      .select('source_id,image_url,thumb_url')
      .eq('source', source)
      .is('mirror_url', null)
      .order('created_at', { ascending: false })
      .range(start, start + 199);
    if (error) { console.log(source, 'query error', error.message.slice(0, 120)); break; }
    const batch = data ?? [];
    if (!batch.length) break;
    for (const w of batch) {
      const url = trusted(w.image_url) || trusted(w.thumb_url);
      const label = `${source}:${w.source_id}`;
      if (!url) { fail++; fails.push(`${label}:no-trusted-url`); continue; }
      try {
        const { buffer, type } = await download(url);
        const uploaded = await uploadMirror({
          buffer,
          contentType: type,
          source,
          sourceId: String(w.source_id),
          name: `wallora-${source}-${w.source_id}`,
        });
        const { error: up } = await sb.from('wallpapers').update({ mirror_url: uploaded.url }).eq('source', source).eq('source_id', w.source_id);
        if (up) throw new Error('db:' + up.message.slice(0, 80));
        ok++;
      } catch (e) {
        fail++;
        if (fails.length < 15) fails.push(`${label}:${e.message.slice(0, 60)}`);
      }
      done++;
      if (done % 10 === 0) console.log(`${source}: ${done} done (ok=${ok} fail=${fail})`);
    }
    if (batch.length < 200) break;
    start += 200;
  }
  console.log(`== ${source} FINISHED ok=${ok} fail=${fail}`);
  if (fails.length) console.log('  sample fails:', fails.join(' | '));
}
process.exit(0);
