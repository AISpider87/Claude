import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AdminUser, AuditEntry, Json, Notification } from "@/lib/supabase/database.types";

export async function listUsers(): Promise<AdminUser[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_users");
  return data ?? [];
}

export async function listAuditLog(limit = 200): Promise<AuditEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_audit_log", { p_limit: limit });
  return data ?? [];
}

export async function listNotifications(limit = 30): Promise<Notification[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Editable league settings, with defaults so a missing key still renders. */
export interface LeagueSettings {
  league_code: string;
  initial_budget: number;
  roster_composition: { P: number; D: number; C: number; A: number };
  season_swap_limit: number;
  session_extra_budget: number;
  market_ops_per_minute: number;
  quotation_change_alert_threshold: number;
  sync_enabled: boolean;
  notifications_enabled: boolean;
  updated_at: string | null;
}

const DEFAULTS: LeagueSettings = {
  league_code: "",
  initial_budget: 250,
  roster_composition: { P: 3, D: 7, C: 7, A: 6 },
  season_swap_limit: 20,
  session_extra_budget: 5,
  market_ops_per_minute: 5,
  quotation_change_alert_threshold: 5,
  sync_enabled: true,
  notifications_enabled: true,
  updated_at: null,
};

function asInt(value: Json | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

export async function getLeagueSettings(): Promise<LeagueSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("league_settings").select("key, value, updated_at");
  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  const comp = map.get("roster_composition");
  const composition =
    comp && typeof comp === "object" && !Array.isArray(comp)
      ? {
          P: asInt(comp.P, 3),
          D: asInt(comp.D, 7),
          C: asInt(comp.C, 7),
          A: asInt(comp.A, 6),
        }
      : DEFAULTS.roster_composition;
  const updated = (data ?? [])
    .map((r) => r.updated_at)
    .sort()
    .at(-1);
  return {
    league_code: typeof map.get("league_code") === "string" ? String(map.get("league_code")) : "",
    initial_budget: asInt(map.get("initial_budget"), DEFAULTS.initial_budget),
    roster_composition: composition,
    season_swap_limit: asInt(map.get("season_swap_limit"), DEFAULTS.season_swap_limit),
    session_extra_budget: asInt(map.get("session_extra_budget"), DEFAULTS.session_extra_budget),
    market_ops_per_minute: asInt(map.get("market_ops_per_minute"), DEFAULTS.market_ops_per_minute),
    quotation_change_alert_threshold: asInt(
      map.get("quotation_change_alert_threshold"),
      DEFAULTS.quotation_change_alert_threshold,
    ),
    sync_enabled: map.get("sync_enabled") !== false,
    notifications_enabled: map.get("notifications_enabled") !== false,
    updated_at: updated ?? null,
  };
}

/** True when league emails are enabled and Resend is configured. */
export async function notificationsEnabled(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_settings")
    .select("value")
    .eq("key", "notifications_enabled")
    .maybeSingle();
  return data?.value !== false;
}
