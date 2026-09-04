interface Props {
  kicker: string;
  title: string;
  linkHref?: string;
  linkLabel?: string;
}

export default function SectionHeading({ kicker, title, linkHref, linkLabel }: Props) {
  return (
    <div className="flex items-end justify-between gap-4 mb-7">
      <div>
        <p className="text-[11px] font-display font-semibold tracking-[0.35em] text-accent2 uppercase mb-2">
          ✦ {kicker}
        </p>
        <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">{title}</h2>
      </div>
      {linkHref && (
        <a
          href={linkHref}
          className="hidden sm:inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-accent2 transition shrink-0 mb-1"
        >
          {linkLabel ?? 'View all'}
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      )}
    </div>
  );
}
