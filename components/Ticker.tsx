const ITEMS = [
  '4K ULTRA HD',
  'BOUNDED DROPS',
  'AMOLED BLACK',
  'ANIME PICKS',
  'NATURE SERIES',
  'AI ART LAB',
  'MINIMAL SETS',
  'SPACE ARCHIVE',
  'ZERO CLUTTER',
  'API-SYNCED',
];

export default function Ticker() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <div className="relative -rotate-1 my-2 border-y border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden py-3.5 select-none">
      <div className="flex w-max animate-marqueeX" style={{ animationDuration: '36s' }}>
        {[...row, ...row].map((t, i) => (
          <span key={i} className="flex items-center gap-6 pr-6 font-display text-sm tracking-[0.28em] text-white/50 whitespace-nowrap">
            {t}
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent2" fill="currentColor">
              <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z" />
            </svg>
          </span>
        ))}
      </div>
    </div>
  );
}
