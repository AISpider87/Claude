import type { LucideIcon } from "lucide-react";

/** Faint tactical lines behind empty states (decorative). */
function PitchLines() {
  return (
    <svg
      viewBox="0 0 320 160"
      className="text-primary pointer-events-none absolute inset-0 size-full opacity-[0.08]"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="8" y="8" width="304" height="144" rx="4" />
        <line x1="160" y1="8" x2="160" y2="152" />
        <circle cx="160" cy="80" r="26" />
        <rect x="8" y="42" width="48" height="76" />
        <rect x="264" y="42" width="48" height="76" />
        <path d="M56 60a26 26 0 0 1 0 40" />
        <path d="M264 60a26 26 0 0 0 0 40" />
      </g>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 6">
        <path d="M70 130 L150 96 L230 118 L290 40" />
      </g>
    </svg>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-line bg-surface/60 relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[var(--radius-card)] border border-dashed px-6 py-12 text-center">
      <PitchLines />
      <div className="relative flex flex-col items-center gap-3">
        <span className="border-primary/40 bg-primary/10 inline-flex size-14 items-center justify-center rounded-2xl border">
          <Icon className="text-primary size-7" aria-hidden />
        </span>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {description && <p className="text-muted max-w-sm text-sm">{description}</p>}
        {children}
      </div>
    </div>
  );
}
