import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { generateBlogPost } from '@/lib/bloggen';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Manual blog generation from the admin panel:  POST /api/admin/blog-generate { topic?: "…" } */
export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let topic: string | undefined;
  try {
    const raw = (await req.json())?.topic;
    topic = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 240) : undefined;
  } catch {
    /* topic optional */
  }
  const result = await generateBlogPost(topic);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
