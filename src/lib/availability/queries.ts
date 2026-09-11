import "server-only";
import { API_FOOTBALL_PROVIDER } from "@/lib/availability/provider";
import type { UnmatchedName } from "@/lib/availability/run";
import { createClient } from "@/lib/supabase/server";
import type { PlayerLineup } from "@/lib/supabase/database.types";

/** A lineup is news only around its kick-off; after that it is just history. */
export const LINEUP_WINDOW_HOURS = 12;

/**
 * Lineup state of the given players, keyed by player id. Rows whose kick-off is
 * further away than `LINEUP_WINDOW_HOURS` (or already well past) are dropped
 * here, so the pages never show a stale "Titolare".
 */
export async function getPlayerLineups(
  playerIds: number[],
  now: Date = new Date(),
): Promise<Map<number, PlayerLineup>> {
  const map = new Map<number, PlayerLineup>();
  if (playerIds.length === 0) return map;
  const supabase = await createClient();
  for (let i = 0; i < playerIds.length; i += 500) {
    const { data } = await supabase
      .from("player_lineup_status")
      .select("*")
      .in("player_id", playerIds.slice(i, i + 500));
    for (const row of data ?? []) {
      if (isLineupVisible(row.kickoff, now)) map.set(row.player_id, row);
    }
  }
  return map;
}

/** Between two hours after the kick-off and twelve hours before it. */
export function isLineupVisible(kickoff: string | null, now: Date = new Date()): boolean {
  if (!kickoff) return false;
  const at = Date.parse(kickoff);
  if (!Number.isFinite(at)) return false;
  const delta = at - now.getTime();
  return delta <= LINEUP_WINDOW_HOURS * 3600_000 && delta >= -2 * 3600_000;
}

export interface AvailabilityRunSummary {
  status?: string;
  provider?: string;
  season?: number;
  requests?: number;
  rate_limit_remaining?: number | null;
  errors?: string[];
  unmatched?: UnmatchedName[];
  fixture?: { id: number; kickoff: string; label: string } | null;
  finished_at?: string;
  statuses_applied?: number;
  statuses_kept_manual?: number;
  statuses_cleared?: number;
  lineups?: number;
  mappings?: number;
  synced_at?: string;
}

export interface AvailabilityFeedState {
  /** A key is configured on this deployment (otherwise the feed is simply off). */
  configured: boolean;
  syncedAt: string | null;
  lastRun: AvailabilityRunSummary | null;
}

/** Admin only (league_settings is admin-readable): the state of the last run. */
export async function getAvailabilityFeedState(): Promise<AvailabilityFeedState> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_settings")
    .select("key, value")
    .in("key", ["availability_synced_at", "availability_last_run"]);
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const syncedAt = byKey.get("availability_synced_at");
  const lastRun = byKey.get("availability_last_run");
  return {
    configured: Boolean(process.env.API_FOOTBALL_KEY?.trim()),
    syncedAt: typeof syncedAt === "string" ? syncedAt : null,
    lastRun:
      lastRun && typeof lastRun === "object" && !Array.isArray(lastRun)
        ? (lastRun as AvailabilityRunSummary)
        : null,
  };
}

export interface ExternalMapRow {
  provider: string;
  external_id: number;
  external_name: string | null;
  player_id: number;
  player_name: string;
  team: string;
  role_classic: string;
  confidence: "auto" | "confirmed";
  created_at: string;
}

/** Admin only: the provider-id ↔ listone bindings, confirmed ones first. */
export async function listExternalMap(
  provider: string = API_FOOTBALL_PROVIDER,
): Promise<ExternalMapRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_external_map", { p_provider: provider });
  if (error) return [];
  return data ?? [];
}
