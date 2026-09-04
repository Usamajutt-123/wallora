import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COVER_HOSTS = ['i.ibb.co', 'ibb.co', 'wallhaven.cc', 'kodnextech.com', 'nexwall.app', 'nexwallcdn.com', 'res.cloudinary.com', 'anima-image-api.vercel.app'];

function categorySlug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/g, '') || 'misc';
}

function trustedCover(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return COVER_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Admin: set or clear the custom cover image for a displayed category.
 * Covers are stored as source='custom' rows in the `categories` table, keyed
 * by the exact category name. Public pages overlay them (lib/db.ts).
 *   POST { name, cover_url }   → set / replace
 *   POST { name, cover_url: null } → clear (auto cover returns)
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return NextResponse.json({ ok: false, error: 'Category name is required.' }, { status: 400 });
  const rawCover = String(body.cover_url ?? '').trim();

  try {
    if (!rawCover || rawCover === 'null') {
      const { error } = await sb.from('categories').delete().eq('source', 'custom').eq('source_id', name);
      if (error) throw new Error(error.message);
    } else {
      const cover_url = trustedCover(rawCover);
      if (!cover_url) return NextResponse.json({ ok: false, error: 'Cover must be an HTTPS image from ImgBB or a catalog CDN.' }, { status: 400 });
      const { error } = await sb.from('categories').upsert(
        { source: 'custom', source_id: name, name, slug: categorySlug(name), cover_url },
        { onConflict: 'source,source_id' },
      );
      if (error) throw new Error(error.message);
    }
    revalidatePath('/');
    revalidatePath('/categories');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not save cover.' }, { status: 500 });
  }
}
