"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { supabaseSyncDb } from "@/lib/sync/db";
import { runQuotationsSync } from "@/lib/sync/run";
import { quotationSourceFromEnv } from "@/lib/sync/source";

export async function setSyncEnabled(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const enabled = formData.get("enabled") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_setting", {
    p_key: "sync_enabled",
    p_value: enabled,
  });
  if (error) return { status: "error", message: "Impostazione non salvata." };
  revalidatePath("/admin/listone");
  return {
    status: "success",
    message: enabled ? "Sync automatico attivo." : "Sync automatico disattivato.",
  };
}

/** Runs the same job the cron runs, with the admin's own session. */
export async function runSyncNow(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  void formData;
  const supabase = await createClient();
  const outcome = await runQuotationsSync(quotationSourceFromEnv(), supabaseSyncDb(supabase));
  revalidatePath("/admin/listone");
  switch (outcome.status) {
    case "applied":
      return {
        status: "success",
        message: `Sync eseguito: ${String(outcome.stats.rows ?? "?")} righe, ${String(outcome.stats.new ?? 0)} nuovi, ${String(outcome.stats.out_of_list ?? 0)} fuori lista.`,
      };
    case "skipped":
      return {
        status: "error",
        message:
          outcome.reason === "disabled"
            ? "Il sync automatico è disattivato."
            : "Nessuna sorgente configurata (QUOTATIONS_SOURCE_URL): usa l'upload manuale.",
      };
    default:
      return { status: "error", message: `Sync non riuscito: ${outcome.error}` };
  }
}
