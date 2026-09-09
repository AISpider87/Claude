import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { SyncDb } from "@/lib/sync/run";

/** SyncDb backed by a Supabase client (service role for cron, admin session for "run now"). */
export function supabaseSyncDb(supabase: SupabaseClient<Database>): SyncDb {
  return {
    async ping() {
      const { error } = await supabase.from("league_settings").select("key").limit(1);
      if (error) throw error;
    },
    async isSyncEnabled() {
      const { data } = await supabase
        .from("league_settings")
        .select("value")
        .eq("key", "sync_enabled")
        .maybeSingle();
      return data?.value !== false;
    },
    async loadCurrentPlayers() {
      return fetchAll(() =>
        supabase
          .from("players")
          .select(
            "id, name, team, role_classic, role_mantra, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m, status",
          )
          .order("id"),
      );
    },
    async createImport({ fileName, payload, stats }) {
      const { data, error } = await supabase.rpc("create_quotations_import", {
        p_source: "auto",
        p_file_name: fileName,
        p_file_path: null,
        p_payload: payload as Json,
        p_stats: stats as Json,
      });
      if (error || !data) throw error ?? new Error("create import failed");
      return data;
    },
    async applyImport(importId) {
      const { data, error } = await supabase.rpc("apply_quotations_import", {
        p_import_id: importId,
      });
      if (error) throw new Error(error.message);
      return (data ?? {}) as Record<string, unknown>;
    },
    async failImport(importId, message) {
      await supabase.rpc("fail_import", { p_import_id: importId, p_error: message });
    },
  };
}
