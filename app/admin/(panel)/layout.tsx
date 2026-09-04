import { usingDefaultPassword, urlTokenFallbackActive } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import AdminNav from '@/components/admin/AdminNav';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * NOTE: auth happens per-page via requireAdmin(searchParams) — layouts don't
 * receive searchParams, and cookie-only gating breaks inside iframes that
 * block cookies. Every page in (panel)/ calls requireAdmin first.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-24 pb-16 flex flex-col lg:flex-row gap-6">
      {/* sidebar */}
      <aside className="lg:w-60 shrink-0">
        <div className="glass rounded-3xl p-4 lg:sticky lg:top-24 flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar">
          <Suspense fallback={null}>
            <AdminNav />
          </Suspense>
        </div>
      </aside>

      {/* content */}
      <div className="flex-1 min-w-0">
        {urlTokenFallbackActive() && (
          <div className="mb-6 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200/90 space-y-1">
            <p>
              ⚠ <b>URL-token mode (?sk=) is ON.</b> This puts the session token in the address bar for
              sandboxed-iframe previews only. Disable <code className="bg-black/40 px-1.5 py-0.5 rounded">ADMIN_URL_TOKEN_FALLBACK</code>{' '}
              on your public production site.
            </p>
          </div>
        )}
        {(!isSupabaseConfigured() || usingDefaultPassword()) && (
          <div className="mb-6 rounded-2xl border border-accent2/30 bg-accent2/[0.07] px-5 py-4 text-sm text-accent2/90 space-y-1">
            {!isSupabaseConfigured() && (
              <p>● <b>Demo mode</b> — Supabase keys missing in .env.local. Dashboard is showing sample data.</p>
            )}
            {usingDefaultPassword() && (
              <p>● <b>Admin auth is not configured</b> — create a Supabase admin or set <code className="bg-black/40 px-1.5 py-0.5 rounded">ADMIN_PASSWORD</code>. The development fallback is disabled in production.</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
