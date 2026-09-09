import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type {
  PlayerExportRow,
  RosterExportRow,
  TeamExportRow,
  TransactionExportRow,
} from "@/lib/export/workbooks";

export async function loadRostersExport(): Promise<{
  rosters: RosterExportRow[];
  teams: TeamExportRow[];
}> {
  const supabase = await createClient();
  const [teams, rows, players, profiles] = await Promise.all([
    fetchAll(() => supabase.from("teams").select("*").order("name")),
    fetchAll(() =>
      supabase
        .from("roster_players")
        .select("team_id, player_id, price_paid, acquired_at, acquired_via")
        .is("released_at", null)
        .order("acquired_at"),
    ),
    fetchAll(() =>
      supabase.from("players").select("id, name, team, role_classic, qt_a, status").order("id"),
    ),
    fetchAll(() => supabase.from("profiles").select("user_id, display_name").order("user_id")),
  ]);
  const player = new Map(players.map((p) => [p.id, p]));
  const manager = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  const roleOrder: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const rosters: RosterExportRow[] = rows
    .map((r): RosterExportRow | null => {
      const t = teamById.get(r.team_id);
      const p = player.get(r.player_id);
      if (!t || !p) return null;
      return {
        team: t.name,
        shortName: t.short_name,
        manager: t.owner_id ? (manager.get(t.owner_id) ?? null) : null,
        credits: t.credits,
        swapsUsed: t.swaps_used,
        playerId: p.id,
        player: p.name,
        role: p.role_classic,
        serieATeam: p.team,
        qtA: p.qt_a,
        pricePaid: r.price_paid,
        acquiredAt: r.acquired_at,
        acquiredVia: r.acquired_via,
        outOfList: p.status === "out_of_list",
      };
    })
    .filter((r): r is RosterExportRow => r !== null)
    .sort(
      (a, b) =>
        a.team.localeCompare(b.team, "it") ||
        (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) ||
        b.qtA - a.qtA,
    );
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.team_id, (counts.get(r.team_id) ?? 0) + 1);
  const teamRows: TeamExportRow[] = teams.map((t) => ({
    team: t.name,
    shortName: t.short_name,
    manager: t.owner_id ? (manager.get(t.owner_id) ?? null) : null,
    credits: t.credits,
    swapsUsed: t.swaps_used,
    players: counts.get(t.id) ?? 0,
  }));
  return { rosters, teams: teamRows };
}

export async function loadListoneExport(): Promise<PlayerExportRow[]> {
  const supabase = await createClient();
  const [players, owned] = await Promise.all([
    fetchAll(() => supabase.from("players").select("*").order("id")),
    fetchAll(() =>
      supabase.from("roster_players").select("player_id").is("released_at", null).order("id"),
    ),
  ]);
  const owners = new Map<number, number>();
  for (const o of owned) owners.set(o.player_id, (owners.get(o.player_id) ?? 0) + 1);
  const roleOrder: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };
  return players
    .map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      roleClassic: p.role_classic,
      roleMantra: p.role_mantra,
      qtA: p.qt_a,
      qtI: p.qt_i,
      diff: p.diff,
      qtAM: p.qt_a_m,
      qtIM: p.qt_i_m,
      diffM: p.diff_m,
      fvm: p.fvm,
      fvmM: p.fvm_m,
      status: p.status,
      owners: owners.get(p.id) ?? 0,
      updatedAt: p.updated_at,
    }))
    .sort(
      (a, b) =>
        (a.status === "out_of_list" ? 1 : 0) - (b.status === "out_of_list" ? 1 : 0) ||
        (roleOrder[a.roleClassic] ?? 9) - (roleOrder[b.roleClassic] ?? 9) ||
        b.qtA - a.qtA ||
        a.name.localeCompare(b.name, "it"),
    );
}

export async function loadTransactionsExport(): Promise<TransactionExportRow[]> {
  const supabase = await createClient();
  const [rows, teams, players, sessions] = await Promise.all([
    fetchAll(() =>
      supabase.from("transactions").select("*").order("created_at", { ascending: false }),
    ),
    fetchAll(() => supabase.from("teams").select("id, name").order("id")),
    fetchAll(() => supabase.from("players").select("id, name").order("id")),
    fetchAll(() => supabase.from("market_sessions").select("id, name").order("id")),
  ]);
  const team = new Map(teams.map((t) => [t.id, t.name]));
  const player = new Map(players.map((p) => [p.id, p.name]));
  const session = new Map(sessions.map((s) => [s.id, s.name]));
  const reversed = new Set(rows.map((r) => r.reversal_of).filter((x): x is string => !!x));
  return rows.map((r) => ({
    createdAt: r.created_at,
    team: team.get(r.team_id) ?? r.team_id,
    session: r.session_id ? (session.get(r.session_id) ?? null) : null,
    kind: r.kind,
    playerOut: r.player_out_id != null ? (player.get(r.player_out_id) ?? null) : null,
    playerOutPrice: r.player_out_price,
    playerIn: r.player_in_id != null ? (player.get(r.player_in_id) ?? null) : null,
    playerInPrice: r.player_in_price,
    creditsDelta: r.credits_delta,
    countsTowardLimit: r.counts_toward_limit,
    note: r.note,
    reversed: reversed.has(r.id),
  }));
}
