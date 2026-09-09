import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-line bg-surface-2 text-foreground",
        primary: "border-primary/40 bg-primary/10 text-primary",
        danger: "border-danger/40 bg-danger/10 text-danger",
        muted: "border-line text-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const ROLE_STYLES: Record<string, string> = {
  P: "border-role-p/50 bg-role-p/15 text-role-p",
  D: "border-role-d/50 bg-role-d/15 text-role-d",
  C: "border-role-c/50 bg-role-c/15 text-role-c",
  A: "border-role-a/50 bg-role-a/15 text-role-a",
};

/** Role badge: colour + letter, never colour alone. */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  return (
    <span
      className={cn(
        "font-display inline-flex size-6 items-center justify-center rounded-md border text-xs font-bold",
        ROLE_STYLES[role] ?? "border-line text-muted",
        className,
      )}
      aria-label={`Ruolo ${role}`}
    >
      {role}
    </span>
  );
}
