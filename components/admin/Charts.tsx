import { fmt } from '@/lib/utils';

interface Point {
  day: string;
  views: number;
  downloads: number;
}

/** Pure-SVG dual line chart — zero client JS. */
export default function LineChart({ series }: { series: Point[] }) {
  const W = 720;
  const H = 230;
  const PAD = { l: 8, r: 8, t: 18, b: 26 };
  const max = Math.max(1, ...series.map((s) => Math.max(s.views, s.downloads)));

  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, series.length - 1);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);

  const path = (kv: (s: Point) => number) =>
    series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(kv(s)).toFixed(1)}`).join(' ');

  const areaPath = `${path((s) => s.views)} L${x(series.length - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id="fillViews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C6CFF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7C6CFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + f * (H - PAD.t - PAD.b)}
            y2={PAD.t + f * (H - PAD.t - PAD.b)}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="4 6"
          />
        ))}

        <path d={areaPath} fill="url(#fillViews)" />
        <path d={path((s) => s.views)} fill="none" stroke="#7C6CFF" strokeWidth="2.5" strokeLinecap="round" />
        <path d={path((s) => s.downloads)} fill="none" stroke="#C6F432" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 0" />

        {series.map((s, i) => (
          <g key={s.day}>
            <circle cx={x(i)} cy={y(s.views)} r="3" fill="#0A0A10" stroke="#7C6CFF" strokeWidth="2" />
            {i % 2 === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.35)">
                {s.day}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="mt-3 flex items-center gap-6 text-xs text-white/50">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-1 rounded bg-accent" /> Views (peak {fmt(max)})
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-1 rounded bg-accent2" /> Downloads
        </span>
      </div>
    </div>
  );
}

export function SourceBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total ? Math.max(3, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-white/55 mb-1.5">
        <span className="font-display tracking-widest uppercase">{label}</span>
        <span>{fmt(value)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
