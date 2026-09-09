import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "border-line bg-surface text-foreground placeholder:text-muted focus-visible:border-primary focus-visible:ring-primary/40 min-h-11 w-full rounded-[var(--radius-control)] border px-3 text-base focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
