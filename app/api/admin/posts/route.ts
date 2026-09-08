import { adminApiOk, ADMIN_COOKIE } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { isHardBlockedWallpaper } from '@/lib/filters';
import { canonicalCategoryName } from '@/lib/categories';

export const dynamic = 'force-dynamic';

async function authed(req: NextRequest) {
  const store = await cookies();
  return adminApiOk(store.get(ADMIN_COOKIE)?.value, req.url);
}

type SbClient = NonNullable<ReturnType<typeof getServiceSupabase>>;
let imagesColumnKnown: boolean | null = null;

/** True when the posts table has the extra images column (v6.2 migration). */
async function postsHasImagesColumn(sb: SbClient): Promise<boolean> {
  if (imagesColumnKnown === null) {
    const { error } = await sb.from('posts').select('images').limit(1);
    imagesColumnKnown = !error;
  }
  return imagesColumnKnown;
}

function line(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function block(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

function optionalHttps(value: unknown): string | null {
  const raw = line(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IMAGE_HOSTS = ['i.ibb.co', 'ibb.co', 'wallhaven.cc', 'kodnextech.com', 'nexwall.app', 'nexwallcdn.com', 'res.cloudinary.com', 'anima-image-api.vercel.app'];
function trustedImageUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return IMAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** Gallery images: ordered list of trusted-host HTTPS URLs, no duplicates. */
function postImages(body: Record<string, unknown>): string[] {
  const raw = body.images;
  const list = Array.isArray(raw) ? raw.map((item) => line(item, 2048)).filter(Boolean) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of list) {
    const url = optionalHttps(value);
    if (!url || !trustedImageUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 40) break;
  }
  return out;
}

function postPayload(body: Record<string, unknown>) {
  const title = line(body.title, 140);
  const slug = slugify(line(body.slug, 100) || title);
  const description = line(body.description, 170);
  const content_markdown = block(body.content_markdown, 200_000);
  const category = canonicalCategoryName(line(body.category, 80));
  const keywords = line(body.keywords, 500) || null;
  const rawCover = line(body.cover_url, 2048);
  const cover_url = optionalHttps(rawCover);
  const images = postImages(body);
  // 'pending' = AI-written article waiting for the owner's review & approval.
  // Manual posts default to 'draft'; only an explicit choice publishes.
  const rawStatus = String(body.status ?? '');
  const status = ['published', 'pending', 'draft'].includes(rawStatus) ? (rawStatus as 'published' | 'pending' | 'draft') : 'draft';

  if (title.length < 5) throw new Error('Title must be at least 5 characters.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Enter a valid URL slug.');
  if (description.length < 40) throw new Error('Meta description must be at least 40 characters.');
  if (content_markdown.length < 100) throw new Error('Blog content must be at least 100 characters.');
  if (rawCover && !cover_url) throw new Error('Cover image must be a valid HTTPS URL.');
  if (cover_url && isHardBlockedWallpaper({ title, category, tags: keywords })) {
    throw new Error('Real-person, glamour or sexualized cover images are not allowed.');
  }

  const payload: Record<string, unknown> = { title, slug, description, content_markdown, category, keywords, cover_url, images, status };
  return payload;
}

function refreshBlog(slugs: (string | null | undefined)[]) {
  revalidatePath('/blog');
  revalidatePath('/sitemap.xml');
  revalidatePath('/admin/blogs');
  for (const slug of slugs) if (slug) revalidatePath(`/blog/${slug}`);
}

/** Create a manual blog post or draft. */
export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  try {
    const payload = postPayload((await req.json()) as Record<string, unknown>);
    if (!(await postsHasImagesColumn(sb))) delete payload.images; // pre-migration safety
    const { data, error } = await sb
      .from('posts')
      .insert({ ...payload, published_at: new Date().toISOString() })
      .select('id,slug')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'That slug is already in use.' : error.message);
    refreshBlog([data.slug]);
    return NextResponse.json({ ok: true, id: data.id, slug: data.slug });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not create post.' }, { status: 400 });
  }
}

/** Edit manual or AI-generated posts. */
export async function PATCH(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = line(body.id, 60);
    if (!UUID_RE.test(id)) throw new Error('Invalid post id.');
    const payload = postPayload(body);
    if (!(await postsHasImagesColumn(sb))) delete payload.images; // pre-migration safety
    const { data: previous, error: readError } = await sb.from('posts').select('slug,status').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!previous) throw new Error('Post not found.');
    const changes: Record<string, unknown> = { ...payload };
    if (previous.status !== 'published' && payload.status === 'published') changes.published_at = new Date().toISOString();
    const { error } = await sb.from('posts').update(changes).eq('id', id);
    if (error) throw new Error(error.code === '23505' ? 'That slug is already in use.' : error.message);
    refreshBlog([previous.slug, payload.slug]);
    return NextResponse.json({ ok: true, id, slug: payload.slug });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not update post.' }, { status: 400 });
  }
}

/** Delete a post by UUID. */
export async function DELETE(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sb = getServiceSupabase();
  if (!sb) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 400 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'Invalid post id.' }, { status: 400 });
  const { data: previous, error: readError } = await sb.from('posts').select('slug').eq('id', id).maybeSingle();
  if (readError) return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
  if (!previous) return NextResponse.json({ ok: false, error: 'Post not found.' }, { status: 404 });
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  refreshBlog([previous.slug]);
  return NextResponse.json({ ok: true });
}
