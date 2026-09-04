import Link from 'next/link';
import { SITE } from '@/lib/product';

const DISCOVER = [
  { label: 'Wallpapers', href: '/' },
  { label: 'Popular', href: '/#trending' },
  { label: 'New Wallpapers', href: '/#browse' },
  { label: 'Categories', href: '/categories' },
  { label: 'Search', href: '/search' },
];

const CATEGORIES_LINKS = ['Anime', 'Gaming', 'Nature', 'Cars', 'Space', 'AMOLED', 'Minimal', '4K'].map((t) => ({
  label: t,
  href: `/search?q=${encodeURIComponent(t)}`,
}));

const COMPANY = [
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'DMCA & Copyright', href: '/dmca' },
];

const LEGAL = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Use', href: '/terms' },
  { label: 'Disclaimer', href: '/disclaimer' },
];

function Col({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="font-display text-xs tracking-[0.3em] text-white/35 mb-4">{title}</p>
      <ul className="space-y-2.5 text-sm text-white/60">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link className="hover:text-accent2 transition" href={l.href}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-white/[0.07] bg-black/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent2 text-black">
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 5.5 6.5 18 12 8.5 17.5 18 21 5.5" />
                </svg>
              </span>
              <span className="font-display font-bold text-lg tracking-[0.18em]">WALLORA</span>
            </div>
            <p className="mt-4 font-display text-sm text-accent2/90 italic">{SITE.tagline}</p>
            <p className="mt-2 text-sm text-white/45 leading-relaxed max-w-xs">{SITE.description}</p>

            {/* Socials — rendered ONLY when real profiles exist */}
            {SITE.socials.length > 0 && (
              <div className="mt-5">
                <p className="font-display text-xs tracking-[0.3em] text-white/35 mb-3">FOLLOW</p>
                <div className="flex gap-3">
                  {SITE.socials.map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs text-white/60 hover:text-accent2 hover:border-accent2/40 transition"
                    >
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Col title="DISCOVER" links={DISCOVER} />
          <Col title="CATEGORIES" links={CATEGORIES_LINKS} />
          <div className="space-y-10">
            <Col title="COMPANY" links={COMPANY} />
            <Col title="LEGAL" links={LEGAL} />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/35">
          <div className="text-center sm:text-left">
            <p>© {year} {SITE.name}. All rights reserved.</p>
            <p className="mt-1">Wallpapers and third-party content remain the property of their respective owners.</p>
          </div>
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {[...LEGAL, { label: 'DMCA', href: '/dmca' }, { label: 'Contact', href: '/contact' }].map((l) => (
              <Link key={l.href + l.label} className="hover:text-accent2 transition" href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
