import { formatDate } from "@/lib/format";

export interface QuotationPoint {
  recordedAt: string;
  qtA: number;
}

/**
 * Inline SVG line chart of Qt.A over time. Server-rendered, no library: ~10–40
 * points per season. Colours come from CSS tokens so both themes work.
 */
export function QuotationChart({ points, current }: { points: QuotationPoint[]; current: number }) {
  const data = [...points].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  if (data.length < 2) {
    return (
      <p className="text-muted text-sm">
        Storico non ancora disponibile: servono almeno due import delle quotazioni. Quotazione
        attuale: <span className="tabular font-semibold">{current}</span>.
      </p>
    );
  }

  const w = 640;
  const h = 200;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const min = Math.min(...data.map((d) => d.qtA));
  const max = Math.max(...data.map((d) => d.qtA));
  const lo = Math.max(0, min - 2);
  const hi = max + 2;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.qtA).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${(h - pad.b).toFixed(1)} L${x(0).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const first = data[0]!;
  const last = data[data.length - 1]!;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Andamento quotazione da ${first.qtA} a ${last.qtA}`}
        className="h-auto w-full"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeDasharray="3 4"
            />
            <text
              x={pad.l - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {t}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--primary)" opacity="0.12" />
        <path
          d={path}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle key={d.recordedAt} cx={x(i)} cy={y(d.qtA)} r="3.5" fill="var(--primary)">
            <title>
              {formatDate(d.recordedAt)}: {d.qtA}
            </title>
          </circle>
        ))}
        <text x={pad.l} y={h - 8} fontSize="11" fill="var(--text-muted)">
          {formatDate(first.recordedAt)}
        </text>
        <text x={w - pad.r} y={h - 8} fontSize="11" fill="var(--text-muted)" textAnchor="end">
          {formatDate(last.recordedAt)}
        </text>
      </svg>
      <figcaption className="text-muted text-xs">
        {data.length} rilevazioni · minimo {min} · massimo {max}
      </figcaption>
    </figure>
  );
}
