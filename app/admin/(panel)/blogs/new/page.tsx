import { requireAdmin } from '@/lib/auth';
import BlogEditorForm from '@/components/admin/BlogEditorForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New blog post' };

export default async function NewBlogPost({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  await requireAdmin(await searchParams);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-display tracking-[0.24em] uppercase text-accent2">Manual article</p>
        <h1 className="mt-1 font-display font-bold text-3xl tracking-tight">Write a blog post</h1>
        <p className="mt-2 text-sm text-white/45">Save privately as a draft or publish it directly to the WALLORA blog.</p>
      </div>
      <BlogEditorForm />
    </div>
  );
}
