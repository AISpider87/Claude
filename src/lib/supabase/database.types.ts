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
export type TransactionKind =
  | "swap"
  | "free_swap"
  | "sell"
  | "buy"
  | "free_release"
  | "admin_assign"
  | "admin_remove"
  | "admin_credits"
  | "reversal";
export type AcquiredVia = "initial_import" | "admin" | "swap" | "free_swap" | "buy" | "reversal";
export type ReleasedVia = "swap" | "free_swap" | "sell" | "free_release" | "admin" | "reversal";

export type RateLimitBucket = "market" | "import" | "export" | "email" | "admin";
export type NotificationStatus = "sent" | "partial" | "failed" | "skipped";

type ProfileRow = {
  user_id: string;
  display_name: string;
  role: ProfileRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type NotificationRow = {
  id: string;
  kind: string;
  subject: string;
  recipients: number;
  status: NotificationStatus;
  detail: string | null;
  created_by: string | null;
  created_at: string;
};

type AdminUserRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: ProfileRole;
  is_active: boolean;
  created_at: string;
  team_id: string | null;
  team_name: string | null;
};

type AuditEntryRow = {
  id: number;
  created_at: string;
  user_id: string | null;
  display_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  payload: Json | null;
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
      notifications: ReadOnlyTable<NotificationRow>;
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
      admin_upsert_team: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_short_name?: string | null;
          p_color_primary?: string | null;
          p_color_secondary?: string | null;
        };
        Returns: string;
      };
      admin_set_team_owner: {
        Args: { p_team_id: string; p_user_id: string | null };
        Returns: undefined;
      };
      admin_set_team_credits: {
        Args: { p_team_id: string; p_credits: number; p_note?: string | null };
        Returns: undefined;
      };
      admin_assign_player: {
        Args: { p_team_id: string; p_player_id: number; p_price: number; p_note?: string | null };
        Returns: string;
      };
      admin_remove_player: {
        Args: { p_team_id: string; p_player_id: number; p_refund?: number; p_note?: string | null };
        Returns: string;
      };
      create_rosters_import: {
        Args: {
          p_file_name: string | null;
          p_file_path: string | null;
          p_payload: Json;
          p_stats: Json;
        };
        Returns: string;
      };
      apply_rosters_import: { Args: { p_import_id: string }; Returns: Json };
      team_roster_summary: { Args: { p_team_id: string }; Returns: Json };
      current_market_session: { Args: Record<string, never>; Returns: MarketSessionRow | null };
      admin_create_session: {
        Args: {
          p_name: string;
          p_opens_at: string;
          p_closes_at: string;
          p_extra_budget?: number | null;
        };
        Returns: string;
      };
      admin_update_session: {
        Args: {
          p_id: string;
          p_name: string;
          p_opens_at: string;
          p_closes_at: string;
          p_extra_budget: number;
        };
        Returns: undefined;
      };
      admin_delete_session: { Args: { p_id: string }; Returns: undefined };
      open_market_session: { Args: { p_id: string }; Returns: undefined };
      close_market_session: { Args: { p_id: string }; Returns: Json };
      validate_rosters: { Args: Record<string, never>; Returns: Json };
      sync_market_sessions: { Args: Record<string, never>; Returns: Json };
      swap_player: {
        Args: { p_team_id: string; p_player_out: number; p_player_in: number };
        Returns: string;
      };
      free_swap_player: {
        Args: { p_team_id: string; p_player_out: number; p_player_in: number };
        Returns: string;
      };
      sell_player: { Args: { p_team_id: string; p_player_id: number }; Returns: string };
      buy_player: { Args: { p_team_id: string; p_player_id: number }; Returns: string };
      release_out_of_list: { Args: { p_team_id: string; p_player_id: number }; Returns: string };
      team_market_state: { Args: { p_team_id: string }; Returns: Json };
      reverse_transaction: { Args: { p_tx_id: string; p_reason: string }; Returns: string };
      consume_rate_limit: { Args: { p_bucket: RateLimitBucket }; Returns: undefined };
      consume_anonymous_attempt: {
        Args: { p_bucket: "login" | "signup" | "reset"; p_key: string };
        Returns: undefined;
      };
      admin_list_users: { Args: Record<string, never>; Returns: AdminUserRow[] };
      admin_notification_recipients: {
        Args: Record<string, never>;
        Returns: { email: string; display_name: string }[];
      };
      admin_audit_log: { Args: { p_limit?: number }; Returns: AuditEntryRow[] };
      log_notification: {
        Args: {
          p_kind: string;
          p_subject: string;
          p_recipients: number;
          p_status: NotificationStatus;
          p_detail: string | null;
        };
        Returns: undefined;
      };
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
export type Notification = Tables<"notifications">;
export type AdminUser = AdminUserRow;
export type AuditEntry = AuditEntryRow;
