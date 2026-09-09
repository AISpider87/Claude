import { cn } from "@/lib/utils";

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
        "border-line bg-surface rounded-[var(--radius-card)] border px-4 py-3",
        className,
      )}
    >
      <p className="text-muted text-xs uppercase">{label}</p>
      <p
        className={cn(
          "font-display tabular mt-1 text-2xl font-semibold",
          tone === "primary" && "text-primary",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}
