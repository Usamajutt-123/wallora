import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/product';

export const metadata: Metadata = {
  title: 'Contact Wallora',
  description: 'Questions, issues or reports — how to reach the Wallora team.',
};

const MAIL = (email: string, label: string, hint: string) => ({ email, label, hint });

const CHANNELS = [
  MAIL(SITE.emailContact, 'General Questions', 'Anything about the website, features or feedback.'),
  MAIL(SITE.emailDMCA, 'Copyright / DMCA', 'Removal requests — please include the required details.'),
  MAIL(SITE.emailPrivacy, 'Privacy', 'Questions or requests about your personal information.'),
];

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-28 pb-24">
      <p className="font-display text-[11px] tracking-[0.35em] text-accent2/90 uppercase">Get in touch</p>
      <h1 className="mt-3 font-display font-bold text-4xl sm:text-5xl leading-tight">Contact Wallora</h1>
      <p className="mt-5 text-lg text-white/60 leading-relaxed">
        Have a question, found an issue, or need to report something? We&apos;d love to hear from you.
      </p>

      <div className="mt-10 grid gap-4">
        {CHANNELS.map((c) => (
          <a
            key={c.label}
            href={`mailto:${c.email}`}
            className="glass rounded-2xl p-5 flex items-center justify-between gap-4 group hover:border-accent2/40 border border-white/10 transition"
          >
            <div>
              <p className="font-display font-bold tracking-wide">{c.label}</p>
              <p className="mt-1 text-sm text-white/50">{c.hint}</p>
            </div>
            <span className="text-accent2 text-sm font-display tracking-wider group-hover:underline whitespace-nowrap">
              {c.email}
            </span>
          </a>
        ))}
      </div>

      <p className="mt-8 text-sm text-white/50 leading-relaxed">
        For copyright-related requests, please use our{' '}
        <Link className="text-accent2 hover:underline" href="/dmca">DMCA &amp; Copyright</Link> page and include all
        required information.
      </p>
    </main>
  );
}
