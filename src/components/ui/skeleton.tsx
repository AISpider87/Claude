import { cn } from "@/lib/utils";

/** Loading placeholder; pair with an sr-only "Caricamento…" on the page. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-[var(--radius-control)]", className)}
      {...props}
    />
  );
}

export function PageSkeleton({
  stats = 0,
  rows = 6,
  title = true,
}: {
  stats?: number;
  rows?: number;
  title?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <span className="sr-only">Caricamento…</span>
      {title && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      )}
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      <div className="surface-lit border-line bg-surface/85 flex flex-col gap-2 rounded-[var(--radius-card)] border p-4 sm:p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
