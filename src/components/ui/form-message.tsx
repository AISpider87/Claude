import { cn } from "@/lib/utils";

interface FormMessageProps {
  tone?: "error" | "success" | "info";
  children?: React.ReactNode;
  className?: string;
}

export function FormMessage({ tone = "error", children, className }: FormMessageProps) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius-control)] border px-3 py-2 text-sm",
        tone === "error" && "border-danger/40 bg-danger/10 text-danger",
        tone === "success" && "border-primary/40 bg-primary/10 text-primary",
        tone === "info" && "border-line bg-surface-2 text-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p className="text-danger text-xs" role="alert">
      {errors[0]}
    </p>
  );
}
