import { requireAdmin } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import BlogEditorForm, { type BlogEditorValue } from '@/components/admin/BlogEditorForm';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit blog post' };

export default async function EditBlogPost({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sk?: string }> }) {
  const [route, query] = await Promise.all([params, searchParams]);
  await requireAdmin(query);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(route.id)) notFound();
  const sb = getServiceSupabase();
  if (!sb) notFound();
  const { data } = await sb.from('posts').select('*').eq('id', route.id).maybeSingle();
  if (!data) notFound();

  const initial: BlogEditorValue = {
    id: data.id,
    title: data.title ?? '',
    slug: data.slug ?? '',
    description: data.description ?? '',
    keywords: data.keywords ?? '',
    category: data.category ?? '',
    content_markdown: data.content_markdown ?? '',
    cover_url: data.cover_url ?? '',
    images: Array.isArray(data.images) ? data.images.filter((u: unknown) => typeof u === 'string').slice(0, 40) : [],
    status: ['published', 'pending', 'draft'].includes(data.status) ? data.status : 'draft',
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-display tracking-[0.24em] uppercase text-accent2">Manual + AI editing</p>
        <h1 className="mt-1 font-display font-bold text-3xl tracking-tight">Edit blog post</h1>
        <p className="mt-2 text-sm text-white/45">Every field is editable, including AI-written title, SEO description and markdown.</p>
      </div>
      <BlogEditorForm initial={initial} />
    </div>
  );
}
