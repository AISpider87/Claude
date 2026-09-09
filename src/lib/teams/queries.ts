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

export interface TeamListItem extends Team {
  ownerName: string | null;
  rosterCount: number;
}

export async function listTeams(): Promise<TeamListItem[]> {
  const supabase = await createClient();
  const [{ data: teams }, { data: profiles }, rosterRows] = await Promise.all([
    supabase.from("teams").select("*").order("name"),
    supabase.from("profiles").select("user_id, display_name"),
    fetchAll(() =>
      supabase.from("roster_players").select("team_id").is("released_at", null).order("id"),
    ),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
  const counts = new Map<string, number>();
  for (const r of rosterRows) counts.set(r.team_id, (counts.get(r.team_id) ?? 0) + 1);
  return (teams ?? []).map((t) => ({
    ...t,
    ownerName: t.owner_id ? (names.get(t.owner_id) ?? null) : null,
    rosterCount: counts.get(t.id) ?? 0,
  }));
}

/** Ids of players owned by at least one team (for the "svincolati" filter). */
export async function getOwnedPlayerIds(): Promise<Set<number>> {
  const supabase = await createClient();
  const rows = await fetchAll(() =>
    supabase.from("roster_players").select("player_id").is("released_at", null).order("id"),
  );
  return new Set(rows.map((r) => r.player_id));
}

export async function getAllPlayers(): Promise<Player[]> {
  const supabase = await createClient();
  return fetchAll(() => supabase.from("players").select("*").order("id"));
}
