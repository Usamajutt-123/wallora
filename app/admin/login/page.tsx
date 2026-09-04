import { usingDefaultPassword } from '@/lib/auth';
import LoginForm from '@/components/admin/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin login', robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <div className="min-h-[80vh] grid place-items-center px-4 pt-20">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-accent2 text-black mb-5">
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5.5 6.5 18 12 8.5 17.5 18 21 5.5" />
            </svg>
          </span>
          <h1 className="font-display font-bold text-3xl tracking-tight">
            WALLORA <span className="text-grad">Control</span>
          </h1>
          <p className="mt-2 text-sm text-white/45">Enter the admin password to open the dashboard.</p>
        </div>
        <LoginForm showDefaultHint={usingDefaultPassword() && process.env.NODE_ENV !== 'production'} />
      </div>
    </div>
  );
}
