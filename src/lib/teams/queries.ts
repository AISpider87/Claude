import "server-only";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { Player, Team } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export interface RosterRow {
  rosterId: string;
  player: Player;
  pricePaid: number;
  acquiredAt: string;
}

export interface RosterSummary {
  count: number;
  value: number;
  paid: number;
  byRole: Record<RoleClassic, number>;
  outOfList: number;
}

import { ROLE_ORDER } from "@/lib/roles";

export { ROLE_LABEL, ROLE_ORDER } from "@/lib/roles";

export async function getRosterComposition(): Promise<Record<RoleClassic, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_settings")
    .select("value")
    .eq("key", "roster_composition")
    .maybeSingle();
  const v = data?.value as Partial<Record<RoleClassic, number>> | null;
  return { P: v?.P ?? 3, D: v?.D ?? 7, C: v?.C ?? 7, A: v?.A ?? 6 };
}

/** Current roster of a team, sorted by role then quotation. */
export async function getTeamRoster(teamId: string): Promise<RosterRow[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("roster_players")
    .select("id, player_id, price_paid, acquired_at")
    .eq("team_id", teamId)
    .is("released_at", null);
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.player_id);
  const { data: players } = await supabase.from("players").select("*").in("id", ids);
  const byId = new Map((players ?? []).map((p) => [p.id, p]));

  return rows
    .flatMap((r) => {
      const player = byId.get(r.player_id);
      return player
        ? [{ rosterId: r.id, player, pricePaid: r.price_paid, acquiredAt: r.acquired_at }]
        : [];
    })
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.player.role_classic) - ROLE_ORDER.indexOf(b.player.role_classic) ||
        b.player.qt_a - a.player.qt_a ||
        a.player.name.localeCompare(b.player.name),
    );
}

export function summarizeRoster(roster: RosterRow[]): RosterSummary {
  const byRole: Record<RoleClassic, number> = { P: 0, D: 0, C: 0, A: 0 };
  let value = 0;
  let paid = 0;
  let outOfList = 0;
  for (const r of roster) {
    byRole[r.player.role_classic]++;
    value += r.player.qt_a;
    paid += r.pricePaid;
    if (r.player.status === "out_of_list") outOfList++;
  }
  return { count: roster.length, value, paid, byRole, outOfList };
}

export async function getMyTeam(userId: string): Promise<Team | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("teams").select("*").eq("owner_id", userId).maybeSingle();
  return data ?? null;
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("teams").select("*").eq("id", teamId).maybeSingle();
  return data ?? null;
}

/** A team as the league sees it: budget and roster size only when visible to the caller. */
export interface TeamListItem {
  id: string;
  name: string;
  short_name: string;
  color_primary: string;
  color_secondary: string;
  owner_id: string | null;
  ownerName: string | null;
  /** null when the caller is not allowed to see it (another manager's team). */
  credits: number | null;
  swaps_used: number | null;
  rosterCount: number | null;
}

/**
 * Every team of the league (names, colours, managers) plus credits and roster
 * size for the teams the caller can read: all of them for the admin, only
 * their own for a manager (rosters are private).
 */
export async function listTeams(): Promise<TeamListItem[]> {
  const supabase = await createClient();
  const [{ data: league }, { data: visible }, rosterRows] = await Promise.all([
    supabase.rpc("league_teams"),
    supabase.from("teams").select("id, credits, swaps_used"),
    fetchAll(() =>
      supabase.from("roster_players").select("team_id").is("released_at", null).order("id"),
    ),
  ]);
  const budgets = new Map((visible ?? []).map((t) => [t.id, t]));
  const counts = new Map<string, number>();
  for (const r of rosterRows) counts.set(r.team_id, (counts.get(r.team_id) ?? 0) + 1);
  return (league ?? []).map((t) => {
    const budget = budgets.get(t.id);
    return {
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      color_primary: t.color_primary,
      color_secondary: t.color_secondary,
      owner_id: t.owner_id,
      ownerName: t.owner_name,
      credits: budget?.credits ?? null,
      swaps_used: budget?.swaps_used ?? null,
      rosterCount: budget ? (counts.get(t.id) ?? 0) : null,
    };
  });
}

/**
 * Ids of players owned by at least one team (for the "svincolati" filter).
 * Derived from the free-agent view, which sees every roster even though the
 * roster rows themselves are private.
 */
export async function getOwnedPlayerIds(): Promise<Set<number>> {
  const supabase = await createClient();
  const [free, active] = await Promise.all([
    fetchAll(() => supabase.from("free_agents").select("id").order("id")),
    fetchAll(() => supabase.from("players").select("id").eq("status", "active").order("id")),
  ]);
  const freeIds = new Set(free.map((p) => p.id));
  return new Set(active.map((p) => p.id).filter((id) => !freeIds.has(id)));
}

export async function getAllPlayers(): Promise<Player[]> {
  const supabase = await createClient();
  return fetchAll(() => supabase.from("players").select("*").order("id"));
}
