import { cn } from "@/lib/utils";

/** Provisional wordmark + hexagonal emblem (final artwork lands in M7). */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <polygon
          points="32,6 54,19 54,45 32,58 10,45 10,19"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-primary"
        />
        <line
          x1="16"
          y1="46"
          x2="48"
          y2="18"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="text-primary/60"
        />
        <text
          x="32"
          y="39"
          textAnchor="middle"
          fontWeight="700"
          fontSize="20"
          fill="currentColor"
          className="text-foreground"
        >
          SL
        </text>
      </svg>
      {!compact && (
        <span className="font-display text-lg font-bold tracking-wide uppercase">
          Super<span className="text-primary">Lega</span>
        </span>
      )}
    </span>
  );
}
