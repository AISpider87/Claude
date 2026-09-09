"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import { parseQuotationsWorkbook } from "@/lib/import/quotations-parser";
import { buildQuotationsPreview } from "@/lib/import/quotations-preview";
import type { Json } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

/** Step 1: parse the uploaded workbook, store it, save a preview and redirect to it. */
export async function previewQuotationsImport(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  {
    const supabase = await createClient();
    const { error } = await supabase.rpc("consume_rate_limit", {
      p_bucket: "import",
      p_max: 5,
      p_window_seconds: 600,
    });
    if (error)
      return {
        status: "error",
        message: "Troppi import in poco tempo: riprova tra qualche minuto.",
      };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Seleziona il file Excel delle quotazioni (.xlsx)." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { status: "error", message: "Il file deve essere un Excel .xlsx di Fantacalcio.it." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { status: "error", message: "Il file supera i 5 MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseQuotationsWorkbook(bytes);
  } catch {
    return { status: "error", message: "File non leggibile: non sembra un Excel valido." };
  }
  if (parsed.rows.length === 0) {
    const detail = parsed.anomalies[0]?.detail ?? "";
    return {
      status: "error",
      message: `Nessun calciatore trovato nel file (${parsed.anomalies[0]?.code ?? "formato sconosciuto"}${detail ? `: ${detail}` : ""}).`,
    };
  }

  const supabase = await createClient();
  let current;
  try {
    current = await fetchAll(() =>
      supabase
        .from("players")
        .select(
          "id, name, team, role_classic, role_mantra, qt_a, qt_i, diff, qt_a_m, qt_i_m, diff_m, fvm, fvm_m, status, updated_at",
        )
        .order("id"),
    );
  } catch {
    return { status: "error", message: "Impossibile leggere il listone attuale. Riprova." };
  }
  const { data: thresholdRow } = await supabase
    .from("league_settings")
    .select("value")
    .eq("key", "quotation_change_alert_threshold")
    .maybeSingle();
  const threshold = Number(thresholdRow?.value ?? 5) || 5;

  const preview = buildQuotationsPreview(parsed, current, threshold);
  // Fingerprint of the listone the admin is looking at; apply refuses if it changed meanwhile.
  const listoneStamp = `${current.length}:${current.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "")}`;

  const filePath = `quotations/${new Date().toISOString().replace(/[:.]/g, "-")}-${safeFileName(file.name)}`;
  const { error: storageError } = await supabase.storage
    .from("imports")
    .upload(filePath, bytes, { contentType: XLSX_MIME, upsert: false });

  const { data: importId, error } = await supabase.rpc("create_quotations_import", {
    p_source: "manual",
    p_file_name: file.name,
    p_file_path: storageError ? null : filePath,
    p_payload: { rows: parsed.rows, out_of_list_ids: parsed.outOfListIds } as unknown as Json,
    p_stats: {
      preview,
      anomalies: parsed.anomalies,
      anomaly_count: parsed.anomalies.length,
      sheets: parsed.sheets,
      title: parsed.title,
      storage_error: storageError?.message ?? null,
      listone_stamp: listoneStamp,
    } as unknown as Json,
  });
  if (error || !importId) {
    return { status: "error", message: "Salvataggio dell'anteprima non riuscito. Riprova." };
  }

  redirect(`/admin/listone/import/${importId}`);
}

function importErrorMessage(code: string | undefined, message: string | undefined) {
  const text = `${code ?? ""} ${message ?? ""}`;
  if (text.includes("IMPORT_TOO_SMALL")) {
    return "Il file contiene troppi pochi calciatori rispetto al listone attuale: import bloccato per sicurezza.";
  }
  if (text.includes("IMPORT_ALREADY_APPLIED")) return "Questo import è già stato applicato.";
  if (text.includes("IMPORT_DISCARDED"))
    return "Questo import è stato annullato: carica di nuovo il file.";
  if (text.includes("IMPORT_NOT_FOUND")) return "Import non trovato.";
  if (text.includes("FORBIDDEN")) return "Operazione riservata all'admin.";
  return "Import non riuscito. Riprova o contatta chi gestisce l'app.";
}

/** Step 2: apply a previewed import (upsert, snapshots, out-of-list). */
export async function applyQuotationsImport(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const importId = formData.get("importId");
  if (typeof importId !== "string" || !importId) {
    return { status: "error", message: "Import non valido." };
  }

  const supabase = await createClient();
  const { data: imp } = await supabase
    .from("imports")
    .select("stats")
    .eq("id", importId)
    .maybeSingle();
  const stamp = (imp?.stats as { listone_stamp?: string } | null)?.listone_stamp;
  if (stamp) {
    const current = await fetchAll(() =>
      supabase.from("players").select("id, updated_at").order("id"),
    );
    const now = `${current.length}:${current.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "")}`;
    if (now !== stamp) {
      return {
        status: "error",
        message: "Il listone è cambiato dopo l'anteprima: annulla e carica di nuovo il file.",
      };
    }
  }

  const { error } = await supabase.rpc("apply_quotations_import", { p_import_id: importId });
  if (error) {
    return { status: "error", message: importErrorMessage(error.code, error.message) };
  }

  revalidatePath("/admin/listone");
  revalidatePath("/listone");
  redirect(`/admin/listone/import/${importId}`);
}

export async function discardQuotationsImport(formData: FormData) {
  await requireAdmin();
  const importId = formData.get("importId");
  if (typeof importId === "string" && importId) {
    const supabase = await createClient();
    await supabase.rpc("fail_import", { p_import_id: importId, p_error: "Annullato dall'admin" });
    revalidatePath("/admin/listone");
  }
  redirect("/admin/listone");
}
