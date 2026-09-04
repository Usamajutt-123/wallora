import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { defaultAds, getAdsConfig, saveAdsConfig, SLOT_IDS, type AdsConfig } from '@/lib/ads';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ads: await getAdsConfig() });
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Partial<AdsConfig> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'bad_body' }, { status: 400 });

  const clean = defaultAds();
  for (const id of SLOT_IDS) {
    const s = body[id];
    if (!s) continue;
    clean[id] = {
      enabled: Boolean(s.enabled),
      code: String(s.code ?? '').slice(0, 8000),
      height: Math.min(600, Math.max(50, Number(s.height) || clean[id].height)),
    };
  }
  try {
    const { stored } = await saveAdsConfig(clean);
    return NextResponse.json({ ok: true, stored });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not save ad settings.' },
      { status: 500 },
    );
  }
}
