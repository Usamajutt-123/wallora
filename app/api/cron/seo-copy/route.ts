import { runSeoEnrichment } from '@/lib/seo-copy';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 🌱 SEO COPY CRON — slowly enriches wallpapers with unique SEO copy.
 *
 * Schedule: vercel.json → "30 1,7,13,19 * * *" (4x a day, offset from the
 * wallpaper drip). Each run:
 *   • adds REAL Wallhaven tags (per-wall API) to tag-less rows, and
 *   • writes AI SEO title/description/keywords/alt for a few tagged rows.
 * Small batches on purpose: search engines see gradual improvement and the
 * free Gemini key never gets hammered. Rate-limit safe, never fatal.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not set' }, { status: 503 });
  }
  const summary = await runSeoEnrichment();
  return NextResponse.json({ ok: true, ...summary });
}
