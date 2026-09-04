'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Category } from '@/lib/types';

const GROUPS: { key: string; label: string; emoji: string; match: (c: Category) => boolean }[] = [
  { key: 'animepixels', label: 'Anime', emoji: '🎌', match: (c) => c.source === 'animepixels' },
  { key: 'wallhaven', label: 'Curated Shelves', emoji: '✦', match: (c) => c.source === 'wallhaven' },
  { key: 'rest', label: 'All Categories', emoji: '◈', match: (c) => c.source === 'nexwall' || c.source === 'manual' || c.source === 'demo' },
];

function catHref(c: Category) {
  return `/search?category=${encodeURIComponent(c.name)}`;
}

export default function NavbarInner({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);

  // lock body scroll while the mobile menu is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className="fixed top-0 inset-x-0 z-40">
      <div className="mx-auto max-w-7xl px-3 sm:px-6">
        <nav className="mt-3 relative flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0a0a12]/90 backdrop-blur-2xl px-3 sm:px-4 py-2.5 shadow-[0_8px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/5">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0 group" onClick={() => setOpen(false)}>
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent2 text-black transition-transform group-hover:rotate-6">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5.5 6.5 18 12 8.5 17.5 18 21 5.5" />
              </svg>
            </span>
            <span className="font-display font-bold text-lg tracking-[0.18em]">
              WALLORA
              <span className="ml-2 hidden sm:inline-block align-middle text-[10px] font-sans font-semibold tracking-widest text-black bg-accent2 rounded-full px-2 py-0.5">
                4K
              </span>
            </span>
          </Link>

          {/* ===== Desktop links ===== */}
          <div className="hidden md:flex items-center gap-1 mx-auto text-sm text-white/70">
            <Link href="/#trending" className="px-3 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition">
              Trending
            </Link>
            <Link href="/#browse" className="px-3 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition">
              Browse
            </Link>

            {/* ---- Categories dropdown (hover) ---- */}
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition">
                Categories
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 transition-transform group-hover:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {/* hover bridge + panel */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 pt-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                <div className="w-[460px] max-w-[90vw] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0c0c15] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.85)] ring-1 ring-white/5">
                  {GROUPS.map((g) => {
                    const items = categories.filter(g.match);
                    if (!items.length) return null;
                    return (
                      <div key={g.key} className="mb-3 last:mb-0">
                        <p className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.25em] text-white/35">
                          {g.emoji} {g.label}
                        </p>
                        <div className="grid grid-cols-2">
                          {items.map((c) => (
                            <Link
                              key={c.id}
                              href={catHref(c)}
                              className="px-2.5 py-1.5 rounded-lg text-[13px] text-white/70 hover:text-white hover:bg-white/5 transition truncate"
                            >
                              {c.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <Link href="/categories" className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 py-2 text-xs font-display tracking-widest text-accent2 hover:bg-accent/20 transition">
                    VIEW CATEGORIES PAGE →
                  </Link>
                </div>
              </div>
            </div>

            <Link href="/blog" className="px-3 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition">
              Blog
            </Link>
          </div>

          {/* Search */}
          <form action="/search" className="ml-auto md:ml-0 flex items-center glass rounded-full pl-3 pr-1 py-1 w-40 sm:w-56 focus-within:border-accent/60 transition">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/50 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              name="q"
              placeholder="Search walls…"
              className="bg-transparent outline-none text-sm px-2 w-full placeholder:text-white/35"
            />
            <button className="shrink-0 w-7 h-7 grid place-items-center rounded-full bg-accent text-black hover:bg-accent2 transition" aria-label="Search">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>

          {/* ===== Mobile hamburger ===== */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="md:hidden grid place-items-center w-9 h-9 rounded-full glass text-white/80 hover:text-accent2 transition"
          >
            {open ? (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h10" />
              </svg>
            )}
          </button>

          {/* ===== Mobile menu panel ===== */}
          {open && (
            <div className="md:hidden absolute top-[calc(100%+10px)] inset-x-0 rounded-2xl border border-white/10 bg-[#0c0c15] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.85)] ring-1 ring-white/5 max-h-[calc(100svh-110px)] overflow-y-auto">
              {/* quick links */}
              <div className="grid grid-cols-2 gap-1.5 mb-4">
                {[
                  ['🏠 Home', '/'],
                  ['🔥 Trending', '/#trending'],
                  ['🧭 Browse', '/#browse'],
                  ['📝 Blog', '/blog'],
                  ['🗂 All categories', '/categories'],
                ].map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3.5 py-2.5 text-sm text-white/80 hover:text-accent2 hover:border-accent2/30 transition"
                  >
                    {label}
                  </Link>
                ))}
              </div>

              {/* every category, grouped */}
              {GROUPS.map((g) => {
                const items = categories.filter(g.match);
                if (!items.length) return null;
                return (
                  <div key={g.key} className="mb-3 last:mb-0">
                    <p className="px-1 pb-1.5 text-[10px] uppercase tracking-[0.25em] text-white/35">
                      {g.emoji} {g.label}
                    </p>
                    <div className="grid grid-cols-2 gap-x-1">
                      {items.map((c) => (
                        <Link
                          key={c.id}
                          href={catHref(c)}
                          onClick={() => setOpen(false)}
                          className="px-2.5 py-2 rounded-lg text-[13px] text-white/70 hover:text-white hover:bg-white/5 transition truncate"
                        >
                          {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </nav>
      </div>

      {/* backdrop tap-to-close */}
      {open && <div className="md:hidden fixed inset-0 -z-10" onClick={() => setOpen(false)} />}
    </header>
  );
}
