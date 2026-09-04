import { generateBlogPost } from '@/lib/bloggen';
import { getServiceSupabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel hobby ceiling — one Gemini call fits easily

/**
 * Vercel Cron → drafts a fresh AI blog article every Monday / Wednesday / Friday.
 * See vercel.json:  { "crons": [{ "path": "/api/cron/auto-blog", "schedule": "0 9 * * 1,3,5" }] }
 *
 * AI articles are saved as "pending" — they only become public after the site
 * owner reviews them in Admin → Blog and sets Published.
 *
 * Safety rails:
 *  ① runs only on Mon/Wed/Fri (checked PKT = UTC+5, the site owner's timezone)
 *  ② never writes twice the same day (published OR pending counts; retries are idempotent)
 *  ③ cryptographically gated by CRON_SECRET
 */
export async function GET(req: NextRequest) {
  // ── auth ──
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  // ── Mon / Wed / Fri gate (PKT) ──
  const pkt = new Date(Date.now() + 5 * 3600 * 1000);
  const day = pkt.getUTCDay(); // 0=Sun
  // ?force= only works in dev — in production the Mon/Wed/Fri gate is absolute
  const force = req.nextUrl.searchParams.get('force') === '1' && process.env.NODE_ENV !== 'production';
  if (![1, 3, 5].includes(day) && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not a publishing day (Mon/Wed/Fri only)', pktDay: day });
  }

  // ── dedupe: max 1 (auto) post per day. Pending AI drafts count too, so an
  // un-reviewed draft blocks a second duplicate for the same day. ──
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 503 });
  const pktDate = pkt.toISOString().slice(0, 10);
  const nextPktDate = new Date(pkt.getTime() + 86_400_000).toISOString().slice(0, 10);
  const today = `${pktDate}T00:00:00+05:00`;
  const tomorrow = `${nextPktDate}T00:00:00+05:00`;
  const { count, error: dedupeError } = await sb
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .in('status', ['published', 'pending'])
    .gte('published_at', today)
    .lt('published_at', tomorrow);
  if (dedupeError) return NextResponse.json({ ok: false, error: `supabase: ${dedupeError.message}` }, { status: 503 });
  if ((count ?? 0) >= 1 && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'a post already exists for today (published or pending review)' });
  }
  if (!force) {
    const { data: claimed, error: claimError } = await sb.rpc('claim_daily_job', { p_job: 'auto-blog' });
    if (claimError) {
      return NextResponse.json({ ok: false, error: `daily_reservation: ${claimError.message}` }, { status: 503 });
    }
    if (!claimed) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'automatic blog run already reserved today' });
    }
  }

  const result = await generateBlogPost();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
