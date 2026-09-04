import { requireAdmin } from '@/lib/auth';
import { getServiceSupabase } from '@/lib/supabase';
import { imgUrl } from '@/lib/img';
import BlogButton from '@/components/admin/BlogButton';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Blog manager' };

export default async function AdminBlogs({ searchParams }: { searchParams: Promise<{ sk?: string }> }) {
  const query = await searchParams;
  await requireAdmin(query);
  const sb = getServiceSupabase();
  const sk = query.sk;
  const href = (url: string) => (sk ? `${url}${url.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : url);
  const { data, error } = sb
    ? await sb.from('posts').select('id,slug,title,description,category,cover_url,status,published_at,content_markdown').order('published_at', { ascending: false }).limit(200)
    : { data: null, error: null };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-display tracking-[0.24em] uppercase text-accent2">Editorial</p>
          <h1 className="mt-1 font-display font-bold text-3xl tracking-tight">Blog posts</h1>
          <p className="mt-1 text-sm text-white/45">Create manual articles and fully edit posts written by AI. AI posts wait as <span className="text-amber-200/90">Pending</span> — review them, fix anything, then set Published.</p>
        </div>
        <Link href={href('/admin/blogs/new')} className="rounded-xl bg-accent hover:bg-accent2 text-black font-display font-bold text-sm px-5 py-3 transition">+ New manual post</Link>
      </div>

      {!sb ? (
        <div className="glass rounded-3xl p-10 text-center text-white/45">Connect Supabase to manage database-backed posts.</div>
      ) : (
        <>
          <BlogButton />
          <div className="glass rounded-3xl p-4 sm:p-6">
            {error && <p className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error.message}</p>}
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-white/[0.07] text-left text-[10px] uppercase tracking-[0.2em] text-white/35">
                    <th className="pb-3 pr-4">Post</th>
                    <th className="pb-3 pr-4">Category</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Published</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((post: any) => {
                    const words = String(post.content_markdown ?? '').trim().split(/\s+/).filter(Boolean).length;
                    return (
                      <tr key={post.id} className="border-b border-white/[0.05] hover:bg-white/[0.025]">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                              {post.cover_url ? <img src={imgUrl(post.cover_url)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-white/20">✎</div>}
                            </div>
                            <div className="min-w-0">
                              <p className="max-w-[320px] truncate font-medium">{post.title}</p>
                              <p className="mt-1 text-[11px] text-white/35">/{post.slug} · {words} words</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-white/50">{post.category || '—'}</td>
                        <td className="py-3 pr-4">
                          {post.status === 'published' ? (
                            <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent">Published</span>
                          ) : post.status === 'pending' ? (
                            <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-amber-200">⏳ Pending · review</span>
                          ) : (
                            <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/40">Draft</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-white/40">{new Date(post.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {post.status === 'published' && <a href={`/blog/${post.slug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/45 hover:text-white">View</a>}
                            <Link href={href(`/admin/blogs/${post.id}`)} className="rounded-lg border border-accent2/30 bg-accent2/[0.07] px-3 py-2 text-xs text-accent2 hover:bg-accent2/15">Edit</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!(data ?? []).length && (
                    <tr><td colSpan={5} className="py-14 text-center text-white/40">No database posts yet. Create one manually or use the AI writer above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
