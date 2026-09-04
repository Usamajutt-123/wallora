'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import LogoutButton from './LogoutButton';

const iconCls = 'w-5 h-5';
const NAV = [
  {
    href: '/admin',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="8" height="10" rx="2" />
        <rect x="13" y="3" width="8" height="6" rx="2" />
        <rect x="13" y="11" width="8" height="10" rx="2" />
        <rect x="3" y="15" width="8" height="6" rx="2" />
      </svg>
    ),
  },
  {
    href: '/admin/wallpapers',
    label: 'Wallpapers',
    icon: (
      <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="9" cy="9" r="1.6" />
        <path d="m21 15-4.5-4.5L7 20" />
      </svg>
    ),
  },
  {
    href: '/admin/blogs',
    label: 'Blog posts',
    icon: (
      <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M7 8h10M7 12h10M7 16h6" />
      </svg>
    ),
  },
  {
    href: '/admin/ads',
    label: 'Ad Slots',
    icon: (
      <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z" />
        <path d="M14 8.5a4.5 4.5 0 0 1 0 7M17 6a8 8 0 0 1 0 12" />
      </svg>
    ),
  },
  {
    href: '/admin/sync',
    label: 'API Sync',
    icon: (
      <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" />
      </svg>
    ),
  },
  {
    href: '/admin/categories',
    label: 'Category covers',
    icon: (
      <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    ),
  },
];

/** Sidebar that preserves the ?sk= token when cookies are iframe-blocked. */
export default function AdminNav() {
  const sk = useSearchParams().get('sk');
  const href = (base: string) => (sk ? `${base}?sk=${encodeURIComponent(sk)}` : base);

  return (
    <>
      <p className="hidden lg:block px-3 pt-2 pb-3 text-[10px] font-display tracking-[0.35em] text-white/35 uppercase">
        Control room
      </p>
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={href(n.href)}
          className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-white/65 hover:text-white hover:bg-white/[0.06] transition whitespace-nowrap"
        >
          {n.icon}
          {n.label}
        </Link>
      ))}
      <div className="hidden lg:block my-2 h-px bg-white/[0.07]" />
      <Link
        href="/"
        className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-white/65 hover:text-accent2 transition whitespace-nowrap"
      >
        <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18-3-3.5-3-14.5 0-18Z" />
        </svg>
        View site
      </Link>
      <LogoutButton />
    </>
  );
}
