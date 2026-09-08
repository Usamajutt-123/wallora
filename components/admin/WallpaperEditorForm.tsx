'use client';

import { imgUrl } from '@/lib/img';
import { useRouter, useSearchParams } from 'next/navigation';
import { isHardBlockedWallpaper } from '@/lib/filters';
import { validateLocalFile, uploadFileToWallora } from './client-upload';
import { FormEvent, useMemo, useRef, useState } from 'react';

export interface WallpaperEditorValue {
  id?: string;
  source?: string;
  title: string;
  category: string;
  description: string;
  image_url: string;
  thumb_url: string;
  source_url: string;
  width: number;
  height: number;
  resolution: string;
  tags: string;
  seo_title: string;
  seo_keywords: string;
  seo_alt: string;
  is_featured: boolean;
  is_premium: boolean;
}

const CATEGORIES = [
  'Anime',
  'Gaming',
  'Nature & Landscapes',
  'Cars & Vehicles',
  'Space & Cosmos',
  'AMOLED & Dark',
  'Minimal',
  'Abstract & 3D',
  'Cyberpunk City',
  'Fantasy Worlds',
  'Cityscapes',
  'Animals & Wildlife',
  'Ocean & Beach',
  'Mountains',
  'Flowers',
];

const field =
  'w-full rounded-xl bg-white/[0.045] border border-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-accent2/60 focus:bg-white/[0.065] placeholder:text-white/25';
const label = 'mb-2 block text-[11px] font-display uppercase tracking-[0.18em] text-white/45';

export default function WallpaperEditorForm({ initial }: { initial?: WallpaperEditorValue }) {
  const router = useRouter();
  const search = useSearchParams();
  const sk = search.get('sk');
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState<WallpaperEditorValue>(
    initial ?? {
      title: '',
      category: '',
      description: '',
      image_url: '',
      thumb_url: '',
      source_url: '',
      width: 0,
      height: 0,
      resolution: '',
      tags: '',
      seo_title: '',
      seo_keywords: '',
      seo_alt: '',
      is_featured: false,
      is_premium: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const api = (url: string) => (sk ? `${url}${url.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : url);
  const back = sk ? `/admin/wallpapers?sk=${encodeURIComponent(sk)}` : '/admin/wallpapers';
  const preview = useMemo(() => form.thumb_url || form.image_url, [form.thumb_url, form.image_url]);
  const blocked = useMemo(
    () => isHardBlockedWallpaper({ title: form.title, category: form.category, tags: form.tags }),
    [form.title, form.category, form.tags],
  );

  function set<K extends keyof WallpaperEditorValue>(key: K, value: WallpaperEditorValue[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  /** Upload a local file to ImgBB (via the server) and fill the URL + size. */
  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (event.target.value) event.target.value = '';
    if (!file) return;
    const problem = validateLocalFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const result = await uploadFileToWallora(file, api);
      setForm((current) => ({
        ...current,
        image_url: result.url,
        thumb_url: current.thumb_url || result.url,
        width: current.width || result.width || 0,
        height: current.height || result.height || 0,
        resolution: current.resolution || (result.width && result.height ? `${result.width}x${result.height}` : ''),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(api('/api/admin/wallpapers'), {
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

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid xl:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6">
          <section className="glass rounded-3xl p-5 sm:p-7 space-y-5">
            <div>
              <p className="text-xs font-display tracking-[0.2em] uppercase text-accent2">Wallpaper details</p>
              <h2 className="mt-1 font-display font-bold text-xl">Content and unique description</h2>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="sm:col-span-2">
                <span className={label}>Title *</span>
                <input className={field} value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={140} required placeholder="Neon samurai beneath a violet moon" />
              </label>
              <label>
                <span className={label}>Category *</span>
                <input className={field} list="wallora-categories" value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={80} required placeholder="Anime" />
                <datalist id="wallora-categories">{CATEGORIES.map((item) => <option key={item} value={item} />)}</datalist>
              </label>
              <label>
                <span className={label}>Tags</span>
                <input className={field} value={form.tags} onChange={(e) => set('tags', e.target.value)} maxLength={500} placeholder="samurai, neon, moon, purple" />
              </label>
              <label className="sm:col-span-2">
                <span className={label}>Unique description * <b className="normal-case tracking-normal text-white/30">({form.description.length}/300)</b></span>
                <textarea
                  className={`${field} min-h-32 resize-y leading-relaxed`}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  minLength={40}
                  maxLength={300}
                  required
                  placeholder="Describe this specific wallpaper's subject, mood, visual details and ideal screen use. Do not paste the same wording used on another wallpaper."
                />
                <span className="mt-2 block text-xs leading-relaxed text-white/35">This copy appears on the wallpaper page and is used as its SEO description. Synced wallpapers receive separate metadata-based descriptions automatically.</span>
              </label>
            </div>
          </section>

          <section className="glass rounded-3xl p-5 sm:p-7 space-y-5">
            <div>
              <p className="text-xs font-display tracking-[0.2em] uppercase text-accent2">Image</p>
              <h2 className="mt-1 font-display font-bold text-xl">Upload from device, or paste a URL</h2>
            </div>
            <div className="grid gap-4">
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="rounded-xl bg-accent2/90 hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-5 py-2.5 text-sm transition"
                  >
                    {uploading ? 'Uploading to ImgBB…' : '⬆ Upload from device'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="hidden" onChange={handleFile} />
                  <span className="text-xs text-white/35">JPG · PNG · WebP · GIF · AVIF, up to 12 MB. The image is saved on ImgBB and this URL is stored in your database.</span>
                </div>
              </div>
              <p className="text-xs text-white/35">Or paste a URL instead:</p>
              <label>
                <span className={label}>Full-resolution HTTPS URL *</span>
                <input type="url" className={field} value={form.image_url} onChange={(e) => set('image_url', e.target.value)} required placeholder="https://i.ibb.co/.../wallpaper.jpg" />
              </label>
              <label>
                <span className={label}>Thumbnail HTTPS URL</span>
                <input type="url" className={field} value={form.thumb_url} onChange={(e) => set('thumb_url', e.target.value)} placeholder="Leave blank to use the full image" />
              </label>
              <label>
                <span className={label}>Original/source page URL</span>
                <input type="url" className={field} value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="Optional attribution link" />
              </label>
              <p className="text-xs text-white/35">ImgBB direct links (<code>i.ibb.co</code>) are recommended and already supported by WALLORA&apos;s secure image proxy.</p>
            </div>
          </section>

          <section className="glass rounded-3xl p-5 sm:p-7 space-y-5">
            <div>
              <p className="text-xs font-display tracking-[0.2em] uppercase text-accent2">Technical and SEO</p>
              <h2 className="mt-1 font-display font-bold text-xl">Resolution and search metadata</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <label>
                <span className={label}>Width</span>
                <input type="number" min={0} max={20000} className={field} value={form.width || ''} onChange={(e) => set('width', Number(e.target.value) || 0)} placeholder="3840" />
              </label>
              <label>
                <span className={label}>Height</span>
                <input type="number" min={0} max={20000} className={field} value={form.height || ''} onChange={(e) => set('height', Number(e.target.value) || 0)} placeholder="2160" />
              </label>
              <label>
                <span className={label}>Resolution</span>
                <input className={field} value={form.resolution} onChange={(e) => set('resolution', e.target.value)} maxLength={40} placeholder="Auto from width × height" />
              </label>
              <label className="sm:col-span-3">
                <span className={label}>SEO title</span>
                <input className={field} value={form.seo_title} onChange={(e) => set('seo_title', e.target.value)} maxLength={90} placeholder="Optional — a natural title is generated when blank" />
              </label>
              <label className="sm:col-span-3">
                <span className={label}>SEO keywords</span>
                <input className={field} value={form.seo_keywords} onChange={(e) => set('seo_keywords', e.target.value)} maxLength={500} placeholder="neon samurai wallpaper 4k, purple anime desktop background" />
              </label>
              <label className="sm:col-span-3">
                <span className={label}>Accessible image alt text</span>
                <input className={field} value={form.seo_alt} onChange={(e) => set('seo_alt', e.target.value)} maxLength={140} placeholder="Describe what is visibly present in the image" />
              </label>
            </div>
          </section>
        </div>

        <aside className="glass rounded-3xl p-5 xl:sticky xl:top-24 space-y-5">
          <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-black/40 border border-white/10 grid place-items-center">
            {blocked ? (
              <span className="px-5 text-center text-sm text-red-300/80">Preview blocked by the real-person/glamour/sexualized metadata policy.</span>
            ) : preview ? (
              <img src={imgUrl(preview)} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm text-white/25">Image preview</span>
            )}
          </div>
          {editing && <p className="text-xs text-white/35">Source: <b className="text-white/60">{initial?.source}</b></p>}
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm">
            <input type="checkbox" checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} className="accent-[#C6F432]" />
            Feature on WALLORA
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm">
            <input type="checkbox" checked={form.is_premium} onChange={(e) => set('is_premium', e.target.checked)} className="accent-[#C6F432]" />
            Mark as premium
          </label>
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-100/65">
            Do not add real women/girls, glamour photography or unsafe content. Illustrated/anime artwork is allowed.
          </div>
          {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-accent hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-5 py-3 transition">
            {busy ? 'Saving…' : editing ? 'Save wallpaper changes' : 'Publish manual wallpaper'}
          </button>
          <button type="button" onClick={() => router.push(back)} className="w-full rounded-xl border border-white/10 hover:bg-white/5 text-white/60 px-5 py-3 text-sm transition">
            Cancel
          </button>
        </aside>
      </div>
    </form>
  );
}
