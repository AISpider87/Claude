import { NameMatcher, type ListonePlayer, type NameMatch } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { ParsedRosters, ParsedTeam, RosterAnomaly } from "@/lib/import/rosters-parser";

export interface ResolvedEntry {
  name: string;
  cost: number;
  outOfList: boolean;
  row: number;
  /** "placeholder": not in the listone, imported as an out-of-list player to release for free. */
  status: NameMatch["status"] | "placeholder";
  player: ListonePlayer | null;
  candidates: ListonePlayer[];
  /** Role of the placeholder (chosen by the admin or inferred from the composition). */
  placeholderRole: RoleClassic | null;
  /** The admin asked for a placeholder but its role could not be inferred. */
  roleMissing: boolean;
}

export interface TeamPreview {
  name: string;
  exists: boolean;
  credits: number;
  total: number;
  entries: ResolvedEntry[];
  roleCounts: Record<RoleClassic, number>;
  unresolved: number;
  /** Entries imported as out-of-list placeholders. */
  placeholders: number;
  /** Composition differs from the league's roster rule. */
  compositionOk: boolean;
}

export interface RostersPreview {
  teams: TeamPreview[];
  anomalies: RosterAnomaly[];
  totalPlayers: number;
  unresolved: number;
  placeholders: number;
  newTeams: number;
  existingTeams: number;
  /** True when every entry matched and every team has the right composition. */
  ready: boolean;
}

/** Payload consumed by apply_rosters_import(). */
export interface RostersPayload {
  teams: { name: string; credits: number; players: RostersPayloadPlayer[] }[];
}

export type RostersPayloadPlayer =
  | { player_id: number; price_paid: number }
  | { placeholder: { name: string; role: RoleClassic }; price_paid: number };

const DEFAULT_COMPOSITION: Record<RoleClassic, number> = { P: 3, D: 7, C: 7, A: 6 };

/** Overrides chosen by the admin for unresolved entries: "<team>|<row>" → player id. */
export type ManualResolutions = Record<string, number>;

/**
 * Entries the admin marks as "left Serie A": "<team>|<row>" → role, or "auto" to
 * infer the role from the gap in the team's composition.
 */
export type OutOfListChoice = RoleClassic | "auto";
export type OutOfListMarks = Record<string, OutOfListChoice>;

const ROLES = ["P", "D", "C", "A"] as const;

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
    outOfList?: OutOfListMarks;
    /** Treat every name not found in the listone as an out-of-list placeholder. */
    outOfListAll?: boolean;
  } = {},
): RostersPreview {
  const initialBudget = options.initialBudget ?? 250;
  const composition = options.composition ?? DEFAULT_COMPOSITION;
  const resolutions = options.resolutions ?? {};
  const outOfList = options.outOfList ?? {};
  const outOfListAll = options.outOfListAll ?? false;
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
    placeholders: teams.reduce((n, t) => n + t.placeholders, 0),
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
      return {
        ...entry,
        status: match.status,
        player: match.player,
        candidates: match.candidates,
        placeholderRole: null,
        roleMissing: false,
      };
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
    markPlaceholders(team.name, entries, roleCounts);
    const unresolvedCount = entries.filter((e) => !e.player && e.status !== "placeholder").length;
    const compositionOk =
      unresolvedCount === 0 && ROLES.every((r) => roleCounts[r] === composition[r]);

    return {
      name: team.name,
      exists: existing.has(team.name.trim().toLowerCase()),
      credits: Math.max(0, initialBudget - team.total),
      total: team.total,
      entries,
      roleCounts,
      unresolved: unresolvedCount,
      placeholders: entries.filter((e) => e.status === "placeholder").length,
      compositionOk,
    };
  }

  /**
   * Names that are not in the listone can be imported as out-of-list placeholders
   * (players who left Serie A after the auction: the manager releases them for
   * free). A row marked "*" in the file is a placeholder by default; the others
   * only when the admin says so. The role comes from the admin or, when the team
   * is short of exactly one role, from the composition.
   */
  function markPlaceholders(
    teamName: string,
    entries: ResolvedEntry[],
    roleCounts: Record<RoleClassic, number>,
  ) {
    const auto: ResolvedEntry[] = [];
    for (const e of entries) {
      if (e.status !== "not_found") continue;
      const choice = outOfList[resolutionKey(teamName, e.row)];
      const wanted = choice ?? (outOfListAll || e.outOfList ? "auto" : null);
      if (wanted === null) continue;
      if (wanted === "auto") {
        auto.push(e);
      } else {
        e.status = "placeholder";
        e.placeholderRole = wanted;
        roleCounts[wanted]++;
      }
    }
    if (auto.length === 0) return;
    const short = ROLES.filter((r) => roleCounts[r] < composition[r]);
    const inferred =
      short.length === 1 && composition[short[0]!] - roleCounts[short[0]!] === auto.length
        ? short[0]!
        : null;
    for (const e of auto) {
      if (inferred) {
        e.status = "placeholder";
        e.placeholderRole = inferred;
        roleCounts[inferred]++;
      } else {
        e.roleMissing = true;
      }
    }
  }
}

/** Throws if any entry is still unresolved; callers check `preview.ready` first. */
export function toRostersPayload(preview: RostersPreview): RostersPayload {
  return {
    teams: preview.teams.map((t) => ({
      name: t.name,
      credits: t.credits,
      players: t.entries.map((e): RostersPayloadPlayer => {
        if (e.status === "placeholder" && e.placeholderRole) {
          return { placeholder: { name: e.name, role: e.placeholderRole }, price_paid: e.cost };
        }
        if (!e.player) throw new Error(`Unresolved entry: ${t.name} / ${e.name}`);
        return { player_id: e.player.id, price_paid: e.cost };
      }),
    })),
  };
}
