import { cn } from "@/lib/utils";

/**
 * SuperLega emblem: hexagonal shield, a tactical diagonal run and the "SL"
 * monogram, monochrome on the primary colour. Original artwork (no club or
 * federation marks); the same shapes feed public/icons via scripts/make-icons.mjs.
 */
export function Emblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="sl-shield" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <g className="text-primary">
        <polygon
          points="32,4 56,18 56,46 32,60 8,46 8,18"
          fill="url(#sl-shield)"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <path
          d="M14 47 L28 33 L36 39 L50 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <circle cx="50" cy="19" r="3" fill="currentColor" opacity="0.8" />
      </g>
      <text
        x="32"
        y="40"
        textAnchor="middle"
        fontFamily="var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="21"
        letterSpacing="-1"
        fill="currentColor"
        className="text-foreground"
      >
        SL
      </text>
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Emblem />
      {!compact && (
        <span className="font-display text-lg font-bold tracking-wide uppercase">
          Super<span className="text-primary">Lega</span>
        </span>
      )}
    </span>
  );
}
