"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import type { ListonePlayer } from "@/lib/import/name-matching";
import { parseRostersWorkbook, type ParsedRosters } from "@/lib/import/rosters-parser";
import {
  buildRostersPreview,
  toRostersPayload,
  type ManualResolutions,
  type OutOfListMarks,
} from "@/lib/import/rosters-preview";
import { loadListone, loadRostersPreview, loadSettings } from "@/lib/import/rosters-loader";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

/** Step 1: parse the "Rose" export, match names, save the preview. */
export async function previewRostersImport(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  {
    const supabase = await createClient();
    const { error } = await supabase.rpc("consume_rate_limit", { p_bucket: "import" });
    if (error)
      return {
        status: "error",
        message: "Troppi import in poco tempo: riprova tra qualche minuto.",
      };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Seleziona l'export Excel delle rose (.xlsx)." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { status: "error", message: "Il file deve essere un Excel .xlsx." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { status: "error", message: "Il file supera i 5 MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed: ParsedRosters;
  try {
    parsed = await parseRostersWorkbook(bytes);
  } catch {
    return { status: "error", message: "File non leggibile: non sembra un Excel valido." };
  }
  if (parsed.teams.length === 0) {
    return {
      status: "error",
      message: "Nessuna squadra trovata: serve l'export 'Rose' con le colonne squadra/costo.",
    };
  }

  const supabase = await createClient();
  let listone: ListonePlayer[];
  try {
    listone = await loadListone();
  } catch {
    return {
      status: "error",
      message: "Impossibile leggere il listone. Importa prima le quotazioni.",
    };
  }
  if (listone.length === 0) {
    return { status: "error", message: "Il listone è vuoto: importa prima le quotazioni." };
  }
  const { data: teams } = await supabase.from("teams").select("name");
  const settings = await loadSettings();
  const preview = buildRostersPreview(
    parsed,
    listone,
    (teams ?? []).map((t) => t.name),
    settings,
  );

  const filePath = `rosters/${new Date().toISOString().replace(/[:.]/g, "-")}-${safeFileName(file.name)}`;
  const { error: storageError } = await supabase.storage
    .from("imports")
    .upload(filePath, bytes, { contentType: XLSX_MIME, upsert: false });

  const { data: importId, error } = await supabase.rpc("create_rosters_import", {
    p_file_name: file.name,
    p_file_path: storageError ? null : filePath,
    // The parsed file is stored as-is; the payload for the DB is built at apply time
    // so the admin can still resolve ambiguous names in between.
    p_payload: { teams: [], parsed } as unknown as Json,
    p_stats: {
      preview: summarize(preview),
      anomalies: parsed.anomalies,
      storage_error: storageError?.message ?? null,
    } as unknown as Json,
  });
  if (error || !importId) {
    return { status: "error", message: "Salvataggio dell'anteprima non riuscito. Riprova." };
  }
  redirect(`/admin/squadre/import/${importId}`);
}

function summarize(preview: ReturnType<typeof buildRostersPreview>) {
  return {
    teams: preview.teams.length,
    totalPlayers: preview.totalPlayers,
    unresolved: preview.unresolved,
    newTeams: preview.newTeams,
    existingTeams: preview.existingTeams,
    ready: preview.ready,
  };
}

const resolutionsSchema = z.record(z.string(), z.coerce.number().int().positive());
const outOfListSchema = z.record(z.string(), z.enum(["P", "D", "C", "A", "auto"]));

/**
 * Parses the admin's choices from the confirmation form: "res:<team>|<row>" →
 * player id, "ool:<team>|<row>" → role (or "auto") for names imported as
 * out-of-list placeholders, "ool_all" → every unmatched name is a placeholder.
 */
function readChoices(formData: FormData): {
  resolutions: ManualResolutions;
  outOfList: OutOfListMarks;
  outOfListAll: boolean;
} {
  const res: Record<string, string> = {};
  const ool: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || value === "") continue;
    if (key.startsWith("res:")) res[key.slice(4)] = value;
    else if (key.startsWith("ool:")) ool[key.slice(4)] = value;
  }
  const resolutions = resolutionsSchema.safeParse(res);
  const outOfList = outOfListSchema.safeParse(ool);
  return {
    resolutions: resolutions.success ? resolutions.data : {},
    outOfList: outOfList.success ? outOfList.data : {},
    outOfListAll: formData.get("ool_all") === "1",
  };
}

/** Step 2: apply with the admin's manual resolutions. */
export async function applyRostersImport(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsedId = z.uuid().safeParse(formData.get("importId"));
  if (!parsedId.success) return { status: "error", message: "Import non valido." };
  const importId = parsedId.data;
  const choices = readChoices(formData);
  const loaded = await loadRostersPreview(importId, choices);
  if (!loaded?.preview) return { status: "error", message: "Import non trovato o già applicato." };
  if (!loaded.preview.ready) {
    const roleMissing = loaded.preview.teams.flatMap((t) =>
      t.entries.filter((e) => e.roleMissing).map((e) => `${e.name} (${t.name})`),
    );
    return {
      status: "error",
      message:
        roleMissing.length > 0
          ? `Scegli il ruolo per i fuori lista che non si deduce dalla composizione: ${roleMissing.join(", ")}.`
          : loaded.preview.unresolved > 0
            ? `Ci sono ancora ${loaded.preview.unresolved} nomi da risolvere.`
            : "Alcune squadre non rispettano la composizione 3/7/7/6 o il file ha anomalie bloccanti.",
    };
  }

  const supabase = await createClient();
  // Freeze the resolved payload into a new import row, then apply it atomically.
  const payload = toRostersPayload(loaded.preview);
  const { data: frozenId, error: freezeError } = await supabase.rpc("create_rosters_import", {
    p_file_name: loaded.imp.file_name,
    p_file_path: null,
    p_payload: payload as unknown as Json,
    p_stats: {
      ...((loaded.imp.stats as Record<string, unknown>) ?? {}),
      resolutions: choices.resolutions,
      out_of_list: choices.outOfList,
      out_of_list_all: choices.outOfListAll,
      placeholders: loaded.preview.placeholders,
      supersedes: importId,
    } as unknown as Json,
  });
  if (freezeError || !frozenId) {
    return { status: "error", message: "Salvataggio non riuscito. Riprova." };
  }

  const { error } = await supabase.rpc("apply_rosters_import", { p_import_id: frozenId });
  if (error) {
    await supabase.rpc("fail_import", {
      p_import_id: frozenId,
      p_error: rostersErrorMessage(error.message),
    });
    return { status: "error", message: rostersErrorMessage(error.message) };
  }
  await supabase.rpc("fail_import", {
    p_import_id: importId,
    p_error: "Sostituito dall'import applicato",
  });

  revalidatePath("/admin/squadre");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  redirect(`/admin/squadre/import/${frozenId}`);
}

function rostersErrorMessage(message: string) {
  if (message.includes("PLAYER_NOT_FOUND")) return "Un calciatore non esiste più nel listone.";
  if (message.includes("PLACEHOLDER_ROLE")) return "Ruolo mancante per un calciatore fuori lista.";
  if (message.includes("NEGATIVE_CREDITS")) return "Una squadra avrebbe crediti negativi.";
  if (message.includes("IMPORT_ALREADY_APPLIED")) return "Import già applicato.";
  if (message.includes("SESSION_OPEN"))
    return "C'è una sessione di mercato aperta: chiudila prima di importare le rose.";
  return "Import non riuscito. Riprova.";
}

export async function discardRostersImport(formData: FormData) {
  await requireAdmin();
  const parsedId = z.uuid().safeParse(formData.get("importId"));
  if (parsedId.success) {
    const supabase = await createClient();
    await supabase.rpc("fail_import", {
      p_import_id: parsedId.data,
      p_error: "Annullato dall'admin",
    });
    revalidatePath("/admin/squadre");
  }
  redirect("/admin/squadre");
}
