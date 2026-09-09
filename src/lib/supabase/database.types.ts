/**
 * Database types for the Supabase client.
 *
 * Maintained by hand from supabase/migrations (the CLI generator needs Docker,
 * unavailable in the dev sandbox). Regenerate with
 * `supabase gen types typescript --linked --schema public` once a project is linked
 * (Fase 3) and diff against this file.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type RoleClassic = "P" | "D" | "C" | "A";
export type ProfileRole = "admin" | "manager";
export type PlayerStatus = "active" | "out_of_list";
export type ImportKind = "quotations" | "rosters";
export type ImportSource = "manual" | "auto";
export type ImportStatus = "previewed" | "applied" | "failed";
export type SessionStatus = "scheduled" | "open" | "closed";
export type TransactionKind = "swap" | "free_swap" | "admin_assign" | "admin_remove" | "reversal";
export type AcquiredVia = "initial_import" | "admin" | "swap" | "free_swap" | "reversal";
export type ReleasedVia = "swap" | "free_swap" | "admin" | "reversal";

type ProfileRow = {
  user_id: string;
  display_name: string;
  role: ProfileRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type LeagueSettingRow = {
  key: string;
  value: Json;
  updated_by: string | null;
  updated_at: string;
};

type PlayerRow = {
  id: number;
  name: string;
  team: string;
  role_classic: RoleClassic;
  role_mantra: string | null;
  qt_a: number;
  qt_i: number;
  diff: number;
  qt_a_m: number | null;
  qt_i_m: number | null;
  diff_m: number | null;
  fvm: number | null;
  fvm_m: number | null;
  status: PlayerStatus;
  out_of_list_at: string | null;
  created_at: string;
  updated_at: string;
};

type ImportRow = {
  id: string;
  kind: ImportKind;
  source: ImportSource;
  file_name: string | null;
  file_path: string | null;
  status: ImportStatus;
  payload: Json | null;
  stats: Json;
  error: string | null;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
};

type PlayerQuotationRow = {
  import_id: string;
  player_id: number;
  qt_a: number;
  qt_i: number;
  diff: number;
  qt_a_m: number | null;
  qt_i_m: number | null;
  diff_m: number | null;
  fvm: number | null;
  fvm_m: number | null;
  recorded_at: string;
};

type TeamRow = {
  id: string;
  name: string;
  short_name: string;
  color_primary: string;
  color_secondary: string;
  owner_id: string | null;
  credits: number;
  swaps_used: number;
  created_at: string;
  updated_at: string;
};

type RosterPlayerRow = {
  id: string;
  team_id: string;
  player_id: number;
  price_paid: number;
  acquired_at: string;
  acquired_via: AcquiredVia;
  released_at: string | null;
  released_via: ReleasedVia | null;
};

type MarketSessionRow = {
  id: string;
  name: string;
  opens_at: string;
  closes_at: string;
  status: SessionStatus;
  extra_budget: number;
  extra_budget_applied: boolean;
  opened_at: string | null;
  closed_at: string | null;
  validation_report: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SessionFreeAgentRow = {
  session_id: string;
  player_id: number;
};

type TransactionRow = {
  id: string;
  team_id: string;
  session_id: string | null;
  kind: TransactionKind;
  player_out_id: number | null;
  player_out_price: number | null;
  player_in_id: number | null;
  player_in_price: number | null;
  credits_delta: number;
  counts_toward_limit: boolean;
  note: string | null;
  reversal_of: string | null;
  created_by: string | null;
  created_at: string;
};

type AuditLogRow = {
  id: number;
  user_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  payload: Json | null;
  created_at: string;
};

/** Domain tables are read-only from the client: writes go through functions. */
type ReadOnlyTable<Row> = {
  Row: Row;
  Insert: never;
  Update: never;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: ReadOnlyTable<ProfileRow>;
      league_settings: ReadOnlyTable<LeagueSettingRow>;
      players: ReadOnlyTable<PlayerRow>;
      imports: ReadOnlyTable<ImportRow>;
      player_quotations: ReadOnlyTable<PlayerQuotationRow>;
      teams: ReadOnlyTable<TeamRow>;
      roster_players: ReadOnlyTable<RosterPlayerRow>;
      market_sessions: ReadOnlyTable<MarketSessionRow>;
      session_free_agents: ReadOnlyTable<SessionFreeAgentRow>;
      transactions: ReadOnlyTable<TransactionRow>;
      audit_log: ReadOnlyTable<AuditLogRow>;
    };
    Views: {
      free_agents: { Row: PlayerRow; Relationships: [] };
    };
    Functions: {
      set_user_role: { Args: { target_user: string; new_role: ProfileRole }; Returns: undefined };
      set_user_active: { Args: { target_user: string; active: boolean }; Returns: undefined };
      update_my_display_name: { Args: { new_name: string }; Returns: undefined };
      admin_set_setting: { Args: { p_key: string; p_value: Json }; Returns: undefined };
      create_quotations_import: {
        Args: {
          p_source: ImportSource;
          p_file_name: string | null;
          p_file_path: string | null;
          p_payload: Json;
          p_stats: Json;
        };
        Returns: string;
      };
      apply_quotations_import: { Args: { p_import_id: string }; Returns: Json };
      fail_import: { Args: { p_import_id: string; p_error: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Player = Tables<"players">;
export type Profile = Tables<"profiles">;
export type Team = Tables<"teams">;
export type Import = Tables<"imports">;
export type MarketSession = Tables<"market_sessions">;
export type RosterPlayer = Tables<"roster_players">;
export type Transaction = Tables<"transactions">;
