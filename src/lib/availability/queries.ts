import "server-only";
import {
  API_FOOTBALL_PROVIDER,
  PROVIDER_DOCS,
  PROVIDER_KEY_VAR,
  PROVIDER_LABEL,
  selectedProviderName,
  type ProviderSample,
} from "@/lib/availability/provider";
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
  provider_label?: string;
  season?: number;
  requests?: number;
  requests_max?: number;
  unparsed?: number;
  diagnostics?: boolean;
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

/** The raw answers of the last diagnosed run, as the admin sees them. */
export interface AvailabilitySamples {
  provider: string;
  savedAt: string | null;
  samples: ProviderSample[];
}

export interface AvailabilityFeedState {
  /** A key is configured on this deployment (otherwise the feed is simply off). */
  configured: boolean;
  /** Which provider this deployment is set to use ("bsd", "api-football"). */
  provider: string | null;
  /** Its name for the UI ("Big Balls Sports Data"). */
  providerLabel: string;
  providerDocs: string | null;
  /** The env var that must hold its key, for the "not configured" message. */
  keyVar: string | null;
  syncedAt: string | null;
  lastRun: AvailabilityRunSummary | null;
  /** Paths discovered by the candidate search (BSD), key → path. */
  endpoints: Record<string, string>;
  samples: AvailabilitySamples | null;
}

/** Admin only (league_settings is admin-readable): the state of the last run. */
export async function getAvailabilityFeedState(): Promise<AvailabilityFeedState> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_settings")
    .select("key, value")
    .in("key", [
      "availability_synced_at",
      "availability_last_run",
      "availability_endpoints",
      "availability_last_samples",
    ]);
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const syncedAt = byKey.get("availability_synced_at");
  const lastRun = byKey.get("availability_last_run");
  const provider = selectedProviderName();
  const keyVar = provider ? PROVIDER_KEY_VAR[provider] : null;
  return {
    configured: Boolean(keyVar && process.env[keyVar]?.trim()),
    provider,
    providerLabel: provider ? (PROVIDER_LABEL[provider] ?? provider) : "nessun fornitore",
    providerDocs: provider ? (PROVIDER_DOCS[provider] ?? null) : null,
    keyVar: keyVar ?? null,
    syncedAt: typeof syncedAt === "string" ? syncedAt : null,
    lastRun:
      lastRun && typeof lastRun === "object" && !Array.isArray(lastRun)
        ? (lastRun as AvailabilityRunSummary)
        : null,
    endpoints: readEndpoints(byKey.get("availability_endpoints")),
    samples: readSamples(byKey.get("availability_last_samples")),
  };
}

function readEndpoints(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * The stored samples, defensively: they are written by the job, but the admin
 * page must never break on a row that does not look like one.
 */
function readSamples(value: unknown): AvailabilitySamples | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const list = Array.isArray(row.samples) ? row.samples : [];
  const samples = list.flatMap((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return [];
    const entry = s as Record<string, unknown>;
    return [
      {
        endpoint: String(entry.endpoint ?? ""),
        url: String(entry.url ?? ""),
        status: Number(entry.status ?? 0),
        body: String(entry.body ?? ""),
      },
    ];
  });
  if (samples.length === 0) return null;
  return {
    provider: typeof row.provider === "string" ? row.provider : "",
    savedAt: typeof row.saved_at === "string" ? row.saved_at : null,
    samples,
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
  provider: string = selectedProviderName() ?? API_FOOTBALL_PROVIDER,
): Promise<ExternalMapRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_external_map", { p_provider: provider });
  if (error) return [];
  return data ?? [];
}
