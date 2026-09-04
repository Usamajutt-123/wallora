'use client';

import { imgUrl } from '@/lib/img';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useMemo, useRef, useState } from 'react';
import { validateLocalFile, uploadFileToWallora } from './client-upload';

export interface BlogEditorValue {
  id?: string;
  title: string;
  slug: string;
  description: string;
  keywords: string;
  category: string;
  content_markdown: string;
  cover_url: string;
  status: 'draft' | 'pending' | 'published';
  /** Extra images: gallery + available to insert inline. Banner = cover_url. */
  images: string[];
}

const field =
  'w-full rounded-xl bg-white/[0.045] border border-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-accent2/60 focus:bg-white/[0.065] placeholder:text-white/25';
const label = 'mb-2 block text-[11px] font-display uppercase tracking-[0.18em] text-white/45';

function makeSlug(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
}

interface WallPick {
  url: string;
  thumb: string;
  title: string;
}

export default function BlogEditorForm({ initial }: { initial?: BlogEditorValue }) {
  const router = useRouter();
  const search = useSearchParams();
  const sk = search.get('sk');
  const editing = Boolean(initial?.id);
  const [slugTouched, setSlugTouched] = useState(editing);
  const [form, setForm] = useState<BlogEditorValue>(
    initial ?? {
      title: '',
      slug: '',
      description: '',
      keywords: '',
      category: '',
      content_markdown: '',
      cover_url: '',
      status: 'draft',
      images: [],
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // media picker state
  const [pickerTab, setPickerTab] = useState<'device' | 'category'>('device');
  const [uploadingFiles, setUploadingFiles] = useState(0);
  const [categoryWalls, setCategoryWalls] = useState<WallPick[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryLoaded, setCategoryLoaded] = useState('');
  const multiFileRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement>(null);

  const api = (url: string) => (sk ? `${url}${url.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : url);
  const back = sk ? `/admin/blogs?sk=${encodeURIComponent(sk)}` : '/admin/blogs';
  const words = useMemo(() => form.content_markdown.trim().split(/\s+/).filter(Boolean).length, [form.content_markdown]);
  const galleryCount = useMemo(() => form.images.filter((url) => url !== form.cover_url).length, [form.images, form.cover_url]);

  function set<K extends keyof BlogEditorValue>(key: K, value: BlogEditorValue[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addImages(urls: string[]) {
    setForm((current) => {
      const merged = [...current.images];
      for (const url of urls) if (!merged.includes(url)) merged.push(url);
      const next: BlogEditorValue = { ...current, images: merged };
      if (!next.cover_url && merged.length) next.cover_url = merged[0]; // first image doubles as banner
      return next;
    });
  }

  function removeImage(url: string) {
    setForm((current) => ({
      ...current,
      images: current.images.filter((u) => u !== url),
      cover_url: current.cover_url === url ? (current.images.find((u) => u !== url) ?? '') : current.cover_url,
    }));
  }

  function useAsCover(url: string) {
    setForm((current) => ({ ...current, cover_url: current.cover_url === url ? '' : url }));
  }

  function insertAtCursor(url: string, alt = 'Image') {
    const node = markdownRef.current;
    if (!node) return;
    const md = `\n\n![${alt}](${url})\n\n`;
    const start = node.selectionStart ?? node.value.length;
    const end = node.selectionEnd ?? node.value.length;
    const value = node.value;
    const next = value.slice(0, start) + md + value.slice(end);
    setForm((current) => ({ ...current, content_markdown: next }));
    requestAnimationFrame(() => {
      node.focus();
      const cursor = start + md.length;
      node.setSelectionRange(cursor, cursor);
    });
  }

  function titleChanged(value: string) {
    setForm((current) => ({ ...current, title: value, slug: slugTouched ? current.slug : makeSlug(value) }));
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const ok = list.every((file) => !validateLocalFile(file));
    if (!ok) {
      setError('One of the files is invalid — use JPG/PNG/WebP/GIF/AVIF under 12 MB.');
      return;
    }
    setUploadingFiles(list.length);
    setError('');
    setNotice(`Uploading ${list.length} image${list.length > 1 ? 's' : ''} to ImgBB…`);
    const done: string[] = [];
    try {
      for (const file of list) {
        const result = await uploadFileToWallora(file, api);
        done.push(result.url);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      addImages(done);
      setNotice(done.length === 1 ? 'Image uploaded and added below.' : `${done.length} images uploaded and added below.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed.');
      if (done.length) addImages(done);
    } finally {
      setUploadingFiles(0);
    }
  }

  async function loadCategoryWalls() {
    const category = form.category.trim();
    if (category.length < 2) {
      setError('Type a category name first (e.g. Anime or Gaming), then load its wallpapers.');
      return;
    }
    setCategoryLoading(true);
    setError('');
    try {
      const res = await fetch(api(`/api/wallpapers?category=${encodeURIComponent(category)}&page=1&perPage=80`), { cache: 'no-store' });
      const data = await res.json();
      const items: WallPick[] = (data?.data ?? [])
        .map((item: { image_url?: string; thumb_url?: string; title?: string }) => {
          const url = String(item.image_url ?? '').trim();
          if (!url) return null;
          return { url, thumb: String(item.thumb_url || item.image_url || ''), title: String(item.title ?? '') };
        })
        .filter((pick: WallPick | null): pick is WallPick => Boolean(pick?.url));
      setCategoryWalls(items);
      setCategoryLoaded(items.length ? `${items.length} wallpapers from “${category}”` : `No wallpapers found for “${category}”.`);
    } catch {
      setError('Could not load category wallpapers.');
    } finally {
      setCategoryLoading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(api('/api/admin/posts'), {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: initial?.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Save failed.');
      router.push(back);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Save failed.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial?.id || busy || !confirm('Delete this blog post permanently?')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(api(`/api/admin/posts?id=${encodeURIComponent(initial.id)}`), { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Delete failed.');
      router.push(back);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Delete failed.');
      setBusy(false);
    }
  }

  const hiddenFileInput = (
    <input
      ref={multiFileRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
      multiple
      className="hidden"
      onChange={(e) => {
        handleFiles(e.target.files);
        if (e.target.value) e.target.value = '';
      }}
    />
  );

  return (
    <form onSubmit={save} className="grid xl:grid-cols-[1fr_310px] gap-6 items-start">
      <div className="space-y-6">
        <section className="glass rounded-3xl p-5 sm:p-7 space-y-5">
          <div>
            <p className="text-xs font-display tracking-[0.2em] uppercase text-accent2">Article details</p>
            <h2 className="mt-1 font-display font-bold text-xl">Title, URL and search preview</h2>
          </div>
          <label>
            <span className={label}>Post title *</span>
            <input className={field} value={form.title} onChange={(e) => titleChanged(e.target.value)} maxLength={140} minLength={5} required placeholder="How to choose a 4K wallpaper for an ultrawide monitor" />
          </label>
          <label>
            <span className={label}>URL slug *</span>
            <div className="flex rounded-xl border border-white/10 bg-white/[0.045] overflow-hidden focus-within:border-accent2/60">
              <span className="hidden sm:flex items-center px-4 text-xs text-white/30 border-r border-white/10">/blog/</span>
              <input
                className="w-full bg-transparent px-4 py-3 text-sm outline-none"
                value={form.slug}
                onChange={(e) => { setSlugTouched(true); set('slug', makeSlug(e.target.value)); }}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={80}
                required
              />
            </div>
          </label>
          <label>
            <span className={label}>Meta description * <b className="normal-case tracking-normal text-white/30">({form.description.length}/170)</b></span>
            <textarea className={`${field} min-h-24 resize-y`} value={form.description} onChange={(e) => set('description', e.target.value)} minLength={40} maxLength={170} required placeholder="A concise, natural summary of what the reader will learn." />
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <label>
              <span className={label}>Category</span>
              <input className={field} value={form.category} onChange={(e) => { set('category', e.target.value); setCategoryLoaded(''); setCategoryWalls([]); }} maxLength={80} placeholder="Gaming" />
            </label>
            <label>
              <span className={label}>Keywords</span>
              <input className={field} value={form.keywords} onChange={(e) => set('keywords', e.target.value)} maxLength={500} placeholder="ultrawide wallpaper, 4k monitor background" />
            </label>
          </div>
          <label>
            <span className={label}>Banner / cover URL {form.cover_url ? '(set from your images below)' : ''}</span>
            <input type="url" className={field} value={form.cover_url} onChange={(e) => set('cover_url', e.target.value)} placeholder="https://i.ibb.co/.../cover.jpg — ya neeche images mein se choose karo" />
            <span className="mt-2 block text-xs leading-relaxed text-amber-100/55">Review the actual banner before publishing. Real women/girls, glamour photography and sexualized images are not allowed; illustrated/anime characters are allowed when non-sexualized.</span>
          </label>
        </section>

        {/* ── Post images: upload from device OR pick from a category ── */}
        <section className="glass rounded-3xl p-5 sm:p-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-display tracking-[0.2em] uppercase text-accent2">Post images</p>
              <h2 className="mt-1 font-display font-bold text-xl">Device upload · category picker</h2>
            </div>
            <div className="flex rounded-xl border border-white/10 overflow-hidden text-xs font-display">
              <button type="button" onClick={() => setPickerTab('device')} className={`px-4 py-2.5 transition ${pickerTab === 'device' ? 'bg-accent2 text-black' : 'bg-white/[0.03] text-white/50 hover:text-white'}`}>⬆ Upload</button>
              <button type="button" onClick={() => setPickerTab('category')} className={`px-4 py-2.5 transition ${pickerTab === 'category' ? 'bg-accent2 text-black' : 'bg-white/[0.03] text-white/50 hover:text-white'}`}>From category</button>
            </div>
          </div>

          {pickerTab === 'device' ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  type="button"
                  onClick={() => multiFileRef.current?.click()}
                  disabled={uploadingFiles > 0}
                  className="rounded-xl bg-accent2/90 hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-5 py-2.5 text-sm transition"
                >
                  {uploadingFiles > 0 ? `Uploading ${uploadingFiles} image${uploadingFiles > 1 ? 's' : ''}…` : 'Choose images from device'}
                </button>
                <span className="text-xs text-white/35">Ek sath kai files select karo (JPG · PNG · WebP · GIF · AVIF, up to 12 MB each). Har image ImgBB par save hoti hai.</span>
              </div>
              {notice && <p className="mt-3 text-xs text-accent2/80">{notice}</p>}
              {hiddenFileInput}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={loadCategoryWalls}
                  disabled={categoryLoading}
                  className="rounded-xl bg-accent/90 hover:bg-accent disabled:opacity-60 text-black font-display font-bold px-5 py-2.5 text-sm transition"
                >
                  {categoryLoading ? 'Loading…' : `Load “${form.category.trim() || 'category'}” wallpapers`}
                </button>
                <span className="text-xs text-white/35 self-center">Upar likhe Category ke saved wallpapers dikhenge — click kar ke post mein add karo.</span>
              </div>
              {categoryLoaded && <p className="text-xs text-white/45">{categoryLoaded}</p>}
              {categoryWalls.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 max-h-72 overflow-y-auto pr-1">
                  {categoryWalls.map((wall) => {
                    const added = form.images.includes(wall.url);
                    return (
                      <button
                        key={wall.url}
                        type="button"
                        title={wall.title}
                        onClick={() => (added ? removeImage(wall.url) : addImages([wall.url]))}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition ${added ? 'border-accent2 ring-1 ring-accent2/50' : 'border-white/10 hover:border-white/30'}`}
                      >
                        <img src={imgUrl(wall.thumb)} alt={wall.title || 'wallpaper'} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        {added && (
                          <span className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-accent2 text-black text-xs font-bold">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="pt-1">
            <p className="text-[11px] font-display uppercase tracking-[0.18em] text-white/45 mb-2">
              Chuni hui images <b className="normal-case text-white/60">({form.images.length})</b>
              {form.cover_url && form.images.length ? ` — banner: ${form.images.includes(form.cover_url) ? 'woi image jo is par set hai' : 'URL se'}` : ''}
            </p>
            {form.images.length === 0 ? (
              <p className="text-sm text-white/30">Koi image nahi chuni. Banner ke liye pehli image auto-set hoti hai.</p>
            ) : (
              <div className="space-y-2">
                {form.images.map((url, index) => {
                  const isCover = url === form.cover_url;
                  return (
                    <div key={url} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2">
                      <img src={imgUrl(url)} alt="" className="w-14 h-14 rounded-lg object-cover bg-black/40 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-white/35 truncate">#{index + 1} · {url}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => useAsCover(url)} className={`rounded-lg px-2.5 py-1 text-[10px] font-display uppercase tracking-wider transition ${isCover ? 'bg-accent2 text-black' : 'bg-white/[0.06] text-white/60 hover:text-white'}`}>
                            {isCover ? '★ Banner' : 'Set as banner'}
                          </button>
                          <button type="button" onClick={() => insertAtCursor(url, `Post image ${index + 1}`)} className="rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 hover:text-white px-2.5 py-1 text-[10px] font-display uppercase tracking-wider transition">
                            ⟲ Article mein (cursor par)
                          </button>
                          <button type="button" onClick={() => removeImage(url)} className="rounded-lg bg-red-400/10 hover:bg-red-400/20 text-red-300/80 px-2.5 py-1 text-[10px] font-display uppercase tracking-wider transition">
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {galleryCount > 0 && (
              <p className="mt-2 text-xs text-white/35">
                {galleryCount} image{galleryCount > 1 ? 's' : ''} post ke end par ek <b>Gallery</b> section mein bhi dikhegi. Aur jo article ke andar insert ki, wo content mein bhi hain.
              </p>
            )}
          </div>
        </section>

        <section className="glass rounded-3xl p-5 sm:p-7 space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-display tracking-[0.2em] uppercase text-accent2">Markdown editor</p>
              <h2 className="mt-1 font-display font-bold text-xl">Article content</h2>
            </div>
            <span className="text-xs text-white/35">{words} words</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-relaxed text-white/40">
            Use <code>## Heading</code>, <code>### Subheading</code>, <code>**bold**</code>, <code>- list</code> and <code>[link text](/search?...)</code>. Do not include the H1 title; the blog page adds it. Images ko <code>![alt](url)</code> se beech mein bhi laga sakte ho (chuni images ka “Article mein” button isi ko insert karta hai).
          </div>
          <textarea
            ref={markdownRef}
            className={`${field} min-h-[560px] resize-y font-mono text-[13px] leading-7`}
            value={form.content_markdown}
            onChange={(e) => set('content_markdown', e.target.value)}
            minLength={100}
            maxLength={200000}
            required
            placeholder={'Start with a useful opening paragraph.\n\n## First section\n\nWrite practical, original content here…'}
          />
        </section>
      </div>

      <aside className="glass rounded-3xl p-5 xl:sticky xl:top-24 space-y-5">
        {form.cover_url ? (
          <div className="aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black/30">
            <img src={imgUrl(form.cover_url)} alt="Banner preview" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="aspect-video rounded-2xl border border-dashed border-white/10 grid place-items-center text-xs text-white/25">Banner preview</div>
        )}
        <label>
          <span className={label}>Publishing status</span>
          <select className={field} value={form.status} onChange={(e) => set('status', e.target.value as 'draft' | 'pending' | 'published')}>
            <option value="pending" className="bg-[#111118]">Pending review — AI draft</option>
            <option value="draft" className="bg-[#111118]">Draft — private</option>
            <option value="published" className="bg-[#111118]">Published — live</option>
          </select>
        </label>
        <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${
          form.status === 'published'
            ? 'border-accent/25 bg-accent/[0.06] text-accent/70'
            : form.status === 'pending'
              ? 'border-amber-300/30 bg-amber-300/[0.06] text-amber-200/80'
              : 'border-white/10 bg-white/[0.03] text-white/40'
        }`}>
          {form.status === 'published'
            ? 'This post will be visible in the public blog and sitemap.'
            : form.status === 'pending'
              ? 'Pending AI article — only you can see it. Read & fix any mistake, then set Published to make it live.'
              : 'Drafts are only visible inside this admin panel.'}
        </div>
        {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-accent hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-5 py-3 transition">
          {busy ? 'Saving…' : editing ? 'Save post changes' : form.status === 'published' ? 'Publish post' : form.status === 'pending' ? 'Save as pending' : 'Save draft'}
        </button>
        <button type="button" onClick={() => router.push(back)} className="w-full rounded-xl border border-white/10 hover:bg-white/5 text-white/60 px-5 py-3 text-sm transition">Cancel</button>
        {editing && (
          <button type="button" onClick={remove} disabled={busy} className="w-full rounded-xl border border-red-400/25 hover:bg-red-400/10 text-red-300/80 px-5 py-3 text-sm transition disabled:opacity-60">Delete post</button>
        )}
      </aside>
    </form>
  );
}
