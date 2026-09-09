import type { LucideIcon } from "lucide-react";

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
    <div className="border-line flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed px-6 py-12 text-center">
      <Icon className="text-primary/70 size-10" aria-hidden />
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && <p className="text-muted max-w-sm text-sm">{description}</p>}
      {children}
    </div>
  );
}
