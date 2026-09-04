'use client';

import { imgUrl } from '@/lib/img';
import { useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { uploadFileToWallora, validateLocalFile } from './client-upload';

export interface CategoryCoverItem {
  name: string;
  source: string;
  count: number;
  autoCover: string;
  cover: string;
  custom: boolean;
}

interface WallPick {
  id: string;
  url: string;
  thumb: string;
  title: string;
}

export default function CategoryCoversManager({ items }: { items: CategoryCoverItem[] }) {
  const search = useSearchParams();
  const sk = search.get('sk');
  const api = (url: string) => (sk ? `${url}${url.includes('?') ? '&' : '?'}sk=${encodeURIComponent(sk)}` : url);

  const [q, setQ] = useState('');
  const [open, setOpen] = useState<CategoryCoverItem | null>(null);
  const [walls, setWalls] = useState<WallPick[]>([]);
  const [loadingWalls, setLoadingWalls] = useState(false);
  const [wallsLoaded, setWallsLoaded] = useState('');
  const [savingName, setSavingName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [localItems, setLocalItems] = useState(items);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return localItems;
    return localItems.filter((item) => item.name.toLowerCase().includes(term) || item.source.toLowerCase().includes(term));
  }, [q, localItems]);

  async function saveCover(name: string, cover_url: string | null) {
    setSavingName(name);
    setError('');
    try {
      const res = await fetch(api('/api/admin/category-cover'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cover_url }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed.');
      // On reset (null) fall back to the stored auto cover so the card and the
      // grid never keep showing the stale custom image.
      const withFallback = (cover: string, autoCover: string) => cover_url || autoCover || cover;
      setLocalItems((current) =>
        current.map((item) =>
          item.name === name ? { ...item, cover: withFallback(cover_url ?? '', item.autoCover ?? ''), custom: Boolean(cover_url) } : item,
        ),
      );
      setOpen((current) =>
        current && current.name === name
          ? { ...current, cover: withFallback(cover_url ?? '', current.autoCover ?? ''), custom: Boolean(cover_url) }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Save failed.');
    } finally {
      setSavingName('');
    }
  }

  async function openPicker(item: CategoryCoverItem) {
    setOpen(item);
    setError('');
    setWalls([]);
    setWallsLoaded('');
    setLoadingWalls(true);
    try {
      const res = await fetch(`/api/wallpapers?category=${encodeURIComponent(item.name)}&page=1&perPage=60`, { cache: 'no-store' });
      const data = await res.json();
      const picks: WallPick[] = (data?.data ?? [])
        .map((wall: { id?: string; image_url?: string; thumb_url?: string; title?: string }) => ({
          id: String(wall.id ?? ''),
          url: String(wall.image_url ?? '').trim(),
          thumb: String(wall.thumb_url || wall.image_url || ''),
          title: String(wall.title ?? ''),
        }))
        .filter((pick: WallPick) => pick.url && pick.url.startsWith('https://'));
      setWalls(picks);
      setWallsLoaded(picks.length ? `${picks.length} wallpapers` : 'Koi wallpaper nahi mila is category mein.');
    } catch {
      setError('Wallpapers load nahi ho sake.');
    } finally {
      setLoadingWalls(false);
    }
  }

  async function handleUploadFile(file: File | undefined, name: string) {
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
      await saveCover(name, result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search categories…"
          maxLength={80}
          className="w-full sm:w-72 rounded-xl bg-white/[0.045] border border-white/10 px-4 py-2.5 text-sm outline-none focus:border-accent2/60 placeholder:text-white/25"
        />
        <span className="text-xs text-white/40">{filtered.length} categories</span>
      </div>

      {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-white/35">Koi category nahi mili.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => openPicker(item)}
              className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] text-left transition hover:border-accent/50"
            >
              {item.cover ? (
                <img src={imgUrl(item.cover)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-accent/25 to-accent2/10 grid place-items-center text-xs text-white/40">No cover</div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3">
                <p className="font-display font-bold text-sm leading-tight truncate">{item.name}</p>
                <p className="text-[10px] text-white/45 mt-0.5">
                  {item.custom ? '⭐ custom cover' : `${item.count} walls · auto`}
                </p>
              </div>
              <span className="absolute top-2 right-2 rounded-full bg-black/55 backdrop-blur px-2 py-0.5 text-[10px] text-accent2 opacity-0 group-hover:opacity-100 transition">Change</span>
            </button>
          ))}
        </div>
      )}

      {/* ---- picker modal ---- */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(null)}>
          <div
            className="w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-3xl border border-white/10 bg-[#101019] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-white/[0.07]">
              <div className="min-w-0">
                <p className="text-[10px] font-display tracking-[0.28em] uppercase text-accent2">Custom cover</p>
                <h3 className="mt-1 font-display font-bold text-xl truncate">{open.name}</h3>
                <p className="text-xs text-white/40 mt-0.5">Neeche kisi wallpaper par click karo (set), device se upload karo, ya reset karo.</p>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="grid place-items-center w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/15 text-white/60 text-lg transition">×</button>
            </div>

            <div className="px-6 py-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center border-b border-white/[0.07]">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || savingName === open.name}
                className="rounded-xl bg-accent2/90 hover:bg-accent2 disabled:opacity-60 text-black font-display font-bold px-4 py-2 text-sm transition"
              >
                {uploading ? 'Uploading…' : '⬆ Upload own image'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                className="hidden"
                onChange={(e) => {
                  handleUploadFile(e.target.files?.[0], open.name);
                  if (e.target.value) e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={savingName === open.name}
                onClick={async () => {
                  if (confirm(`“${open.name}” ka custom cover hata kar auto cover par wapas karein?`)) {
                    await saveCover(open.name, null);
                    setOpen(null);
                  }
                }}
                className="rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-50 text-white/60 px-4 py-2 text-sm transition"
              >
                Reset to default
              </button>
              <span className="text-xs text-white/35">
                {savingName === open.name ? 'Saving…' : open.custom ? 'Custom cover set hai' : 'Abhi auto cover hai'}
              </span>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {loadingWalls ? (
                <p className="text-sm text-white/40">Loading wallpapers…</p>
              ) : wallsLoaded.startsWith('Koi') ? (
                <p className="text-sm text-white/35">{wallsLoaded}</p>
              ) : walls.length ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {walls.map((wall) => {
                    const selected = open.custom && open.cover === wall.url;
                    return (
                      <button
                        key={wall.id || wall.url}
                        type="button"
                        title={wall.title}
                        onClick={() => saveCover(open.name, wall.url)}
                        className={`relative aspect-[4/3] overflow-hidden rounded-xl border-2 transition ${selected ? 'border-accent2 ring-1 ring-accent2/50' : 'border-white/10 hover:border-white/40'}`}
                      >
                        <img src={imgUrl(wall.thumb)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        {selected && <span className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-accent2 text-black text-xs font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-white/35">{wallsLoaded}</p>
              )}
            </div>

            <div className="px-6 py-3 border-t border-white/[0.07] text-xs text-white/35 flex items-center justify-between">
              <span>Jis par click karoge wohi cover ban jayega aur site par fauran dikhega.</span>
              <button type="button" onClick={() => setOpen(null)} className="font-display text-accent2">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
