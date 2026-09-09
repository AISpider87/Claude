import { Badge, RoleBadge } from "@/components/ui/badge";
import { formatDelta, formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL_SINGULAR } from "@/lib/roles";
import { cn } from "@/lib/utils";

const ROLE_GRADIENT: Record<RoleClassic, string> = {
  P: "from-role-p/25 via-surface to-surface border-role-p/40",
  D: "from-role-d/25 via-surface to-surface border-role-d/40",
  C: "from-role-c/25 via-surface to-surface border-role-c/40",
  A: "from-role-a/25 via-surface to-surface border-role-a/40",
};

const ROLE_STROKE: Record<RoleClassic, string> = {
  P: "stroke-role-p",
  D: "stroke-role-d",
  C: "stroke-role-c",
  A: "stroke-role-a",
};

function initials(name: string) {
  const parts = name
    .replace(/[^\p{L}\s-]/gu, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (first + second).toUpperCase();
}

export type PlayerAvailability = "free" | "owned" | "out_of_list";

/**
 * Trading-card style header for a player: role gradient, initials in a hexagon,
 * tabular quotation figures. No photos or club marks by design (docs/DESIGN.md).
 */
export function PlayerCard({
  name,
  team,
  role,
  roleMantra,
  qtA,
  qtI,
  diff,
  fvm,
  availability,
  ownersCount = 0,
  className,
}: {
  name: string;
  team: string;
  role: RoleClassic;
  roleMantra?: string | null;
  qtA: number;
  qtI: number;
  diff: number;
  fvm: number | null;
  availability: PlayerAvailability;
  ownersCount?: number;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-card)] border bg-gradient-to-br p-5",
        ROLE_GRADIENT[role],
        className,
      )}
      aria-label={`${name}, ${ROLE_LABEL_SINGULAR[role]}, ${team}`}
    >
      <svg
        viewBox="0 0 200 120"
        className="text-foreground pointer-events-none absolute -top-4 -right-6 h-32 w-auto opacity-[0.05]"
        aria-hidden
      >
        <g fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="100" cy="60" r="40" />
          <line x1="100" y1="0" x2="100" y2="120" />
          <path d="M20 90 L70 40 L120 70 L180 20" strokeDasharray="4 6" />
        </g>
      </svg>
      <div className="relative flex items-start gap-4">
        <span
          className="font-display relative inline-flex size-16 shrink-0 items-center justify-center text-xl font-bold"
          aria-hidden
        >
          <svg viewBox="0 0 64 64" className="absolute inset-0 size-full">
            <polygon
              points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5"
              className={cn("fill-surface", ROLE_STROKE[role])}
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
          <span className="relative">{initials(name)}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-2xl font-semibold tracking-tight">{name}</h2>
          <p className="text-muted mt-0.5 flex flex-wrap items-center gap-2 text-sm">
            <RoleBadge role={role} className="size-5 text-[10px]" />
            <span>{ROLE_LABEL_SINGULAR[role]}</span>
            {roleMantra && <span>· Mantra {roleMantra}</span>}
            <span>· {team}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {availability === "out_of_list" ? (
              <Badge variant="danger">fuori lista</Badge>
            ) : availability === "free" ? (
              <Badge variant="primary">svincolato</Badge>
            ) : (
              <Badge variant="muted">
                in {ownersCount} {ownersCount === 1 ? "rosa" : "rose"}
              </Badge>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-muted text-xs uppercase">Qt.A</p>
          <p className="font-display tabular text-primary text-4xl leading-none font-bold">
            {formatInt(qtA)}
          </p>
          <p className="text-muted tabular mt-1 text-xs">
            Qt.I {formatInt(qtI)} · {formatDelta(diff)}
            {fvm != null && ` · FVM ${formatInt(fvm)}`}
          </p>
        </div>
      </div>
    </article>
  );
}
