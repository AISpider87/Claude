import { Stat } from "@/components/ui/stat";
import { formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { Team } from "@/lib/supabase/database.types";
import type { RosterSummary } from "@/lib/teams/queries";

export function TeamEmblem({ team, size = "md" }: { team: Team; size?: "sm" | "md" | "lg" }) {
  const dim =
    size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-8 text-xs" : "size-12 text-base";
  return (
    <span
      className={`font-display inline-flex shrink-0 items-center justify-center rounded-xl border font-bold ${dim}`}
      style={{
        background: `linear-gradient(135deg, ${team.color_primary}33, ${team.color_secondary})`,
        borderColor: `${team.color_primary}66`,
        color: team.color_primary,
      }}
      aria-hidden
    >
      {team.short_name}
    </span>
  );
}

export function TeamStats({
  team,
  summary,
  composition,
  swapLimit = 20,
}: {
  team: Team;
  summary: RosterSummary;
  composition: Record<RoleClassic, number>;
  swapLimit?: number;
}) {
  const target = Object.values(composition).reduce((a, b) => a + b, 0);
  const complete = summary.count === target;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Crediti" value={formatInt(team.credits)} tone="primary" />
      <Stat label="Valore rosa" value={formatInt(summary.value)} />
      <Stat
        label="Giocatori"
        value={`${formatInt(summary.count)}/${target}`}
        tone={complete ? "neutral" : "danger"}
      />
      <Stat label="Cambi usati" value={`${formatInt(team.swaps_used)}/${swapLimit}`} />
    </div>
  );
}
