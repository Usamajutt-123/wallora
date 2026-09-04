import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { isHardBlockedWallpaper } from '@/lib/filters';

export const dynamic = 'force-dynamic';

async function authed(req: NextRequest) {
  const store = await cookies();
  return adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url);
}

function splitId(id: string): { source: string; source_id: string } | null {
  const sep = id.indexOf(':');
  if (sep < 1) return null;
  const source = id.slice(0, sep);
  const source_id = id.slice(sep + 1);
  if (!['manual', 'nexwall', 'animepixels', 'wallhaven'].includes(source) || !/^[A-Za-z0-9_-]{1,100}$/.test(source_id)) return null;
  return { source, source_id };
}

function text(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function longText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function httpsUrl(value: unknown, required = false): string | null {
  const raw = text(value, 2048);
  if (!raw && !required) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function editablePayload(body: Record<string, unknown>) {
  const title = text(body.title, 140);
  const category = text(body.category, 80);
  const description = longText(body.description ?? body.seo_description, 300).replace(/\s+/g, ' ');
  const image_url = httpsUrl(body.image_url, true);
  const thumbInput = text(body.thumb_url, 2048);
  const thumb_url = thumbInput ? httpsUrl(thumbInput) : image_url;
  const sourceInput = text(body.source_url, 2048);
  const source_url = sourceInput ? httpsUrl(sourceInput) : null;
  const safeDimension = (value: unknown) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 && number <= 20000 ? number : 0;
  };
  let width = safeDimension(body.width);
  let height = safeDimension(body.height);
  const resolutionMatch = text(body.resolution, 40).match(/^(\d{3,5})x(\d{3,5})$/i);
  if ((!width || !height) && resolutionMatch) {
    width = safeDimension(resolutionMatch[1]);
    height = safeDimension(resolutionMatch[2]);
  }
  const resolution = width && height ? `${width}x${height}` : null;

  if (title.length < 3) throw new Error('Title must be at least 3 characters.');
  if (!category) throw new Error('Category is required.');
  if (description.length < 40) throw new Error('Write a unique description of at least 40 characters.');
  if (!image_url) throw new Error('A valid HTTPS image URL is required.');
  if (thumbInput && !thumb_url) throw new Error('Thumbnail must be a valid HTTPS URL.');
  if (sourceInput && !source_url) throw new Error('Source page must be a valid HTTPS URL.');

  const tags = text(body.tags, 500) || null;
  if (isHardBlockedWallpaper({ title, category, tags })) {
    throw new Error('Real-person, glamour or sexualized wallpapers are not allowed.');
  }

  return {
    title,
    category,
    image_url,
    thumb_url,
    source_url,
    width,
    height,
    resolution,
    tags,
    is_featured: Boolean(body.is_featured),
    is_premium: Boolean(body.is_premium),
    seo_title: text(body.seo_title, 90) || null,
    seo_description: description,
    seo_keywords: text(body.seo_keywords, 500) || null,
    seo_alt: text(body.seo_alt, 140) || `${title}${resolution ? ` ${resolution}` : ''} ${category} wallpaper`,
  };
}

async function ensureUniqueDescription(
  sb: NonNullable<ReturnType<typeof getServiceSupabase>>,
  description: string,
  current?: { source: string; source_id: string },
) {
  const { data, error } = await sb
    .from('wallpapers')
    .select('source,source_id')
    .eq('seo_description', description)
    .limit(2);
  if (error) throw new Error(`Description uniqueness check failed: ${error.message}`);
  const duplicate = (data ?? []).some(
    (row) => !current || row.source !== current.source || row.source_id !== current.source_id,
  );
  if (duplicate) throw new Error('That exact wallpaper description is already in use. Write contextual copy for this image.');
}

function manualCategoryId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'manual';
  const hash = createHash('md5').update(name.trim()).digest('hex').slice(0, 12);
  return `${slug}-${hash}`;
}

async function syncManualCategory(
  sb: NonNullable<ReturnType<typeof getServiceSupabase>>,
  category: string | null | undefined,
): Promise<string | null> {
  const name = text(category, 80);
  if (!name) return null;
  const source_id = manualCategoryId(name);
  const { data, count, error } = await sb
    .from('wallpapers')
    .select('image_url,thumb_url,mirror_url,created_at', { count: 'exact' })
    .eq('source', 'manual')
    .eq('category', name)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return `Category refresh: ${error.message}`;
  if (!count) {
    const { error: deleteError } = await sb.from('categories').delete().eq('source', 'manual').eq('source_id', source_id);
    return deleteError ? `Category cleanup: ${deleteError.message}` : null;
  }
  const cover = data?.[0]?.mirror_url || data?.[0]?.thumb_url || data?.[0]?.image_url || null;
  const { error: upsertError } = await sb.from('categories').upsert(
    {
      source: 'manual',
      source_id,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || source_id,
      cover_url: cover,
      wallpaper_count: Math.min(2_147_483_647, count),
      is_premium: false,
    },
    { onConflict: 'source,source_id' },
  );
  return upsertError ? `Category refresh: ${upsertError.message}` : null;
}

function refreshPages(id?: string) {
  revalidatePath('/');
  revalidatePath('/search');
  revalidatePath('/categories');
  revalidatePath('/sitemap.xml');
  revalidatePath('/admin');
  revalidatePath('/admin/wallpapers');
  if (id) revalidatePath(`/wallpaper/${id}`);
}

/** POST — add one first-party/manual wallpaper (URL metadata only). */
export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const source_id = randomUUID().replace(/-/g, '');
    const payload = editablePayload(body);
    await ensureUniqueDescription(sb, payload.seo_description);
    const row = { source: 'manual', source_id, ...payload };
    const { error } = await sb.from('wallpapers').insert(row);
    if (error) throw new Error(error.code === '23505' ? 'That wallpaper description is already in use.' : error.message);
    const [categoryWarning, statsResult] = await Promise.all([
      syncManualCategory(sb, payload.category),
      sb.rpc('refresh_site_stats'),
    ]);
    const id = `manual:${source_id}`;
    refreshPages(id);
    const warnings = [categoryWarning, statsResult.error ? `Stats refresh: ${statsResult.error.message}` : null].filter(Boolean);
    return NextResponse.json({ ok: true, id, ...(warnings.length ? { warning: warnings.join(' | ') } : {}) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not add wallpaper.' },
      { status: 400 },
    );
  }
}

/** PATCH — edit wallpaper metadata, or support the existing quick featured toggle. */
export async function PATCH(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = text(body.id, 160);
    const parts = splitId(id);
    if (!parts) throw new Error('Invalid wallpaper id.');

    const quickFeature = typeof body.is_featured === 'boolean' && !('title' in body);
    let previousCategory: string | null = null;
    if (!quickFeature && parts.source === 'manual') {
      const { data: previous, error: previousError } = await sb
        .from('wallpapers')
        .select('category')
        .eq('source', parts.source)
        .eq('source_id', parts.source_id)
        .maybeSingle();
      if (previousError) throw new Error(previousError.message);
      if (!previous) throw new Error('Wallpaper not found.');
      previousCategory = previous.category;
    }
    const changes = quickFeature ? { is_featured: body.is_featured } : editablePayload(body);
    if (!quickFeature && 'seo_description' in changes) {
      await ensureUniqueDescription(sb, changes.seo_description, parts);
    }
    const { data, error } = await sb
      .from('wallpapers')
      .update(changes)
      .eq('source', parts.source)
      .eq('source_id', parts.source_id)
      .select('source_id')
      .maybeSingle();
    if (error) throw new Error(error.code === '23505' ? 'That wallpaper description is already in use.' : error.message);
    if (!data) throw new Error('Wallpaper not found.');
    const categoryWarnings: string[] = [];
    if (!quickFeature && parts.source === 'manual') {
      const names = [...new Set([previousCategory, 'category' in changes ? changes.category : null].filter(Boolean))] as string[];
      const results = await Promise.all(names.map((name) => syncManualCategory(sb, name)));
      categoryWarnings.push(...results.filter((warning): warning is string => Boolean(warning)));
    }
    refreshPages(id);
    return NextResponse.json({ ok: true, id, ...(categoryWarnings.length ? { warning: categoryWarnings.join(' | ') } : {}) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not update wallpaper.' },
      { status: 400 },
    );
  }
}

/** DELETE ?id= — remove a wallpaper. */
export async function DELETE(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  const id = req.nextUrl.searchParams.get('id') ?? '';
  const parts = splitId(id);
  if (!parts) return NextResponse.json({ ok: false, error: 'Invalid wallpaper id.' }, { status: 400 });
  const { data, error } = await sb
    .from('wallpapers')
    .delete()
    .eq('source', parts.source)
    .eq('source_id', parts.source_id)
    .select('source_id,category')
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'Wallpaper not found.' }, { status: 404 });
  const [categoryWarning, statsResult] = await Promise.all([
    parts.source === 'manual' ? syncManualCategory(sb, data.category) : Promise.resolve(null),
    sb.rpc('refresh_site_stats'),
  ]);
  refreshPages(id);
  const warnings = [categoryWarning, statsResult.error ? `Stats refresh: ${statsResult.error.message}` : null].filter(Boolean);
  return NextResponse.json({ ok: true, ...(warnings.length ? { warning: warnings.join(' | ') } : {}) });
}
