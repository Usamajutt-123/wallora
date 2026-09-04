import Link from 'next/link';

/** Shared shell for About / DMCA / Privacy / Terms / Contact / Disclaimer —
 *  clean prose-first layout using the global .blog-prose typography. */
export default function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-28 pb-24">
      <p className="font-display text-[11px] tracking-[0.35em] text-accent2/90 uppercase">{eyebrow}</p>
      <h1 className="mt-3 font-display font-bold text-4xl sm:text-5xl leading-tight">{title}</h1>
      {updated && <p className="mt-3 text-sm text-white/40">Last updated: {updated}</p>}
      {intro && <p className="mt-5 text-lg text-white/60 leading-relaxed">{intro}</p>}
      <div className="blog-prose mt-10 text-white/75 leading-relaxed">{children}</div>
      <Link
        href="/"
        className="mt-14 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm hover:border-accent2/50 hover:text-accent2 transition"
      >
        ← Back to wallpapers
      </Link>
    </main>
  );
}
