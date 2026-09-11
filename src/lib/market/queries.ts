import "server-only";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { MarketSession, Player, Transaction } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export async function getCurrentSession(): Promise<MarketSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_market_session");
  return data && data.id ? data : null;
}

export async function getNextScheduledSession(): Promise<MarketSession | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("market_sessions")
    .select("*")
    .eq("status", "scheduled")
    .order("opens_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function listSessions(): Promise<MarketSession[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("market_sessions")
    .select("*")
    .order("opens_at", { ascending: false });
  return data ?? [];
}

export async function getSession(id: string): Promise<MarketSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("market_sessions").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export interface FreeAgentOption {
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  qtA: number;
}

/** Free agents frozen at the session opening, still active in the listone. */
export async function getSessionFreeAgents(sessionId: string): Promise<FreeAgentOption[]> {
  const supabase = await createClient();
  const ids = await fetchAll(() =>
    supabase
      .from("session_free_agents")
      .select("player_id")
      .eq("session_id", sessionId)
      .order("player_id"),
  );
  if (ids.length === 0) return [];
  const players: Player[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500).map((r) => r.player_id);
    const { data } = await supabase
      .from("players")
      .select("*")
      .in("id", chunk)
      .eq("status", "active");
    players.push(...(data ?? []));
  }
  return players
    .map((p) => ({ id: p.id, name: p.name, team: p.team, role: p.role_classic, qtA: p.qt_a }))
    .sort((a, b) => b.qtA - a.qtA || a.name.localeCompare(b.name));
}

/** Free agents right now (for free swaps): active players owned by nobody. */
export async function getCurrentFreeAgents(): Promise<FreeAgentOption[]> {
  const supabase = await createClient();
  const rows = await fetchAll(() => supabase.from("free_agents").select("*").order("id"));
  return rows
    .map((p) => ({ id: p.id, name: p.name, team: p.team, role: p.role_classic, qtA: p.qt_a }))
    .sort((a, b) => b.qtA - a.qtA || a.name.localeCompare(b.name));
}

export interface TeamMarketState {
  /** Missing players per role vs the composition (negative = over the composition). */
  slots: Record<RoleClassic, number>;
  /** Free releases not yet compensated: purchases for these do not count. */
  freeSlots: Record<RoleClassic, number>;
  /** Operations of the open session not yet final, and how many purchases among them will count. */
  pending: { operations: number; swaps: number };
}

const ZERO: Record<RoleClassic, number> = { P: 0, D: 0, C: 0, A: 0 };

export async function getTeamMarketState(teamId: string): Promise<TeamMarketState> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_market_state", { p_team_id: teamId });
  const v = (data ?? {}) as {
    slots?: Record<string, number>;
    free_slots?: Record<string, number>;
    pending?: { operations?: number; swaps?: number };
  };
  const pick = (m: Record<string, number> | undefined): Record<RoleClassic, number> => ({
    P: Number(m?.P ?? 0),
    D: Number(m?.D ?? 0),
    C: Number(m?.C ?? 0),
    A: Number(m?.A ?? 0),
  });
  return {
    slots: data ? pick(v.slots) : ZERO,
    freeSlots: data ? pick(v.free_slots) : ZERO,
    pending: {
      operations: Number(v.pending?.operations ?? 0),
      swaps: Number(v.pending?.swaps ?? 0),
    },
  };
}

export async function getMarketSettings() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_settings")
    .select("key, value")
    .in("key", ["season_swap_limit", "sale_price_rule", "free_swap_refund_rule"]);
  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    swapLimit: Number(map.get("season_swap_limit") ?? 20) || 20,
    saleRule: (map.get("sale_price_rule") ?? "current_quotation") as
      "current_quotation" | "price_paid",
    freeSwapRule: (map.get("free_swap_refund_rule") ?? "price_paid") as
      "current_quotation" | "price_paid",
  };
}

export interface LedgerRow extends Transaction {
  teamName: string;
  playerOutName: string | null;
  playerInName: string | null;
  reversed: boolean;
}

/** Pending operations of a team in the open session, oldest first. */
export async function listPendingOperations(teamId: string): Promise<LedgerRow[]> {
  const rows = await listTransactions({ teamId, limit: 100, status: "pending" });
  return rows.reverse();
}

export async function listTransactions(
  options: {
    limit?: number;
    sessionId?: string;
    teamId?: string;
    status?: "pending" | "confirmed";
  } = {},
): Promise<LedgerRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.sessionId) query = query.eq("session_id", options.sessionId);
  if (options.teamId) query = query.eq("team_id", options.teamId);
  if (options.status) query = query.eq("status", options.status);
  const { data: rows } = await query;
  if (!rows?.length) return [];

  const teamIds = [...new Set(rows.map((r) => r.team_id))];
  const playerIds = [
    ...new Set(
      rows.flatMap((r) => [r.player_out_id, r.player_in_id]).filter((x): x is number => x != null),
    ),
  ];
  const txIds = rows.map((r) => r.id);
  const [{ data: teams }, { data: players }, { data: reversals }] = await Promise.all([
    supabase.from("teams").select("id, name").in("id", teamIds),
    playerIds.length
      ? supabase.from("players").select("id, name").in("id", playerIds)
      : Promise.resolve({ data: [] as { id: number; name: string }[] }),
    supabase.from("transactions").select("reversal_of").in("reversal_of", txIds),
  ]);
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const playerName = new Map((players ?? []).map((p) => [p.id, p.name]));
  const reversed = new Set((reversals ?? []).map((r) => r.reversal_of));

  return rows.map((r) => ({
    ...r,
    teamName: teamName.get(r.team_id) ?? "—",
    playerOutName: r.player_out_id
      ? (playerName.get(r.player_out_id) ?? `#${r.player_out_id}`)
      : null,
    playerInName: r.player_in_id ? (playerName.get(r.player_in_id) ?? `#${r.player_in_id}`) : null,
    reversed: reversed.has(r.id),
  }));
}
