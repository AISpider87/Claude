import { NameMatcher, type ListonePlayer, type NameMatch } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { ParsedRosters, ParsedTeam, RosterAnomaly } from "@/lib/import/rosters-parser";

export interface ResolvedEntry {
  name: string;
  cost: number;
  outOfList: boolean;
  row: number;
  status: NameMatch["status"];
  player: ListonePlayer | null;
  candidates: ListonePlayer[];
}

export interface TeamPreview {
  name: string;
  exists: boolean;
  credits: number;
  total: number;
  entries: ResolvedEntry[];
  roleCounts: Record<RoleClassic, number>;
  unresolved: number;
  /** Composition differs from the league's roster rule. */
  compositionOk: boolean;
}

export interface RostersPreview {
  teams: TeamPreview[];
  anomalies: RosterAnomaly[];
  totalPlayers: number;
  unresolved: number;
  newTeams: number;
  existingTeams: number;
  /** True when every entry matched and every team has the right composition. */
  ready: boolean;
}

/** Payload consumed by apply_rosters_import(). */
export interface RostersPayload {
  teams: { name: string; credits: number; players: { player_id: number; price_paid: number }[] }[];
}

const DEFAULT_COMPOSITION: Record<RoleClassic, number> = { P: 3, D: 7, C: 7, A: 6 };

/** Overrides chosen by the admin for unresolved entries: "<team>|<row>" → player id. */
export type ManualResolutions = Record<string, number>;

export function resolutionKey(teamName: string, row: number) {
  return `${teamName}|${row}`;
}

export function buildRostersPreview(
  parsed: ParsedRosters,
  listone: ListonePlayer[],
  existingTeamNames: string[],
  options: {
    initialBudget?: number;
    composition?: Record<RoleClassic, number>;
    resolutions?: ManualResolutions;
  } = {},
): RostersPreview {
  const initialBudget = options.initialBudget ?? 250;
  const composition = options.composition ?? DEFAULT_COMPOSITION;
  const resolutions = options.resolutions ?? {};
  const matcher = new NameMatcher(listone);
  const byId = new Map(listone.map((p) => [p.id, p]));
  const existing = new Set(existingTeamNames.map((n) => n.trim().toLowerCase()));

  const teams = parsed.teams.map((team) => resolveTeam(team));
  const unresolved = teams.reduce((n, t) => n + t.unresolved, 0);
  const newTeams = teams.filter((t) => !t.exists).length;

  return {
    teams,
    anomalies: parsed.anomalies,
    totalPlayers: teams.reduce((n, t) => n + t.entries.length, 0),
    unresolved,
    newTeams,
    existingTeams: teams.length - newTeams,
    ready:
      teams.length > 0 &&
      unresolved === 0 &&
      teams.every((t) => t.compositionOk) &&
      !parsed.anomalies.some((a) => a.code !== "roster_size"),
  };

  function resolveTeam(team: ParsedTeam): TeamPreview {
    const roleCounts: Record<RoleClassic, number> = { P: 0, D: 0, C: 0, A: 0 };
    const entries: ResolvedEntry[] = team.entries.map((entry) => {
      const forced = resolutions[resolutionKey(team.name, entry.row)];
      const forcedPlayer = forced != null ? (byId.get(forced) ?? null) : null;
      const match = forcedPlayer
        ? { status: "matched" as const, player: forcedPlayer, candidates: [forcedPlayer] }
        : matcher.match(entry.name, entry.outOfList);
      if (match.player) roleCounts[match.player.role_classic]++;
      return { ...entry, status: match.status, player: match.player, candidates: match.candidates };
    });
    // Two rows resolved to the same player (typically a manual resolution) would
    // violate the roster uniqueness rule at apply time: flag the second one.
    const seen = new Set<number>();
    for (const e of entries) {
      if (!e.player) continue;
      if (seen.has(e.player.id)) {
        roleCounts[e.player.role_classic]--;
        e.status = "duplicate";
        e.player = null;
        e.candidates = [];
      } else {
        seen.add(e.player.id);
      }
    }
    const unresolvedCount = entries.filter((e) => !e.player).length;
    const compositionOk =
      unresolvedCount === 0 &&
      (["P", "D", "C", "A"] as const).every((r) => roleCounts[r] === composition[r]);

    return {
      name: team.name,
      exists: existing.has(team.name.trim().toLowerCase()),
      credits: Math.max(0, initialBudget - team.total),
      total: team.total,
      entries,
      roleCounts,
      unresolved: unresolvedCount,
      compositionOk,
    };
  }
}

/** Throws if any entry is still unresolved; callers check `preview.ready` first. */
export function toRostersPayload(preview: RostersPreview): RostersPayload {
  return {
    teams: preview.teams.map((t) => ({
      name: t.name,
      credits: t.credits,
      players: t.entries.map((e) => {
        if (!e.player) throw new Error(`Unresolved entry: ${t.name} / ${e.name}`);
        return { player_id: e.player.id, price_paid: e.cost };
      }),
    })),
  };
}
