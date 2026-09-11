import { cn } from "@/lib/utils";

/**
 * Broadcast stat tile: tiny label, big tabular number, a thin lit rule on the
 * left that carries the tone (accent for credits, danger for what is missing).
 */
export function Stat({
  label,
  value,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "primary" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-lit border-line bg-surface relative overflow-hidden rounded-[var(--radius-card)] border px-3 py-2.5",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-0 w-0.5 rounded-full",
          tone === "primary" && "bg-primary",
          tone === "danger" && "bg-danger",
          tone === "neutral" && "bg-line",
        )}
      />
      <p className="text-muted text-[10px] font-semibold tracking-wide uppercase">{label}</p>
      <p
        className={cn(
          "font-display tabular mt-0.5 text-xl leading-tight font-semibold sm:text-2xl",
          tone === "primary" && "text-primary",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}
