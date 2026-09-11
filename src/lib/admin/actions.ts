"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

const ADMIN_MESSAGES: Record<string, string> = {
  CANNOT_DEMOTE_SELF: "Non puoi togliere il ruolo admin a te stesso.",
  CANNOT_DEACTIVATE_SELF: "Non puoi disattivare il tuo account.",
  USER_NOT_FOUND: "Utente non trovato.",
  INVALID_ROLE: "Ruolo non valido.",
  INVALID_SETTING: "Valore non valido per questa impostazione.",
  INVALID_STATUS: "Stato non valido.",
  PLAYER_NOT_FOUND: "Calciatore non trovato nel listone.",
  UNKNOWN_SETTING: "Impostazione sconosciuta.",
  RATE_LIMITED: "Troppe modifiche in poco tempo: riprova tra un minuto.",
  FORBIDDEN: "Operazione riservata all'admin.",
};

function adminMessage(message: string | undefined, fallback: string) {
  const text = message ?? "";
  for (const [code, msg] of Object.entries(ADMIN_MESSAGES)) {
    if (text.includes(code)) return msg;
  }
  return fallback;
}

async function throttle() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("consume_rate_limit", { p_bucket: "admin" });
  return error ? adminMessage(error.message, "Troppe richieste, riprova tra poco.") : null;
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
const userRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["admin", "manager"]),
});

export async function setUserRole(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const limited = await throttle();
  if (limited) return { status: "error", message: limited };
  const parsed = userRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { status: "error", message: "Dati non validi." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    target_user: parsed.data.userId,
    new_role: parsed.data.role,
  });
  if (error)
    return { status: "error", message: adminMessage(error.message, "Modifica non riuscita.") };
  revalidatePath("/admin/utenti");
  return {
    status: "success",
    message: parsed.data.role === "admin" ? "Promosso ad admin." : "Ora è un manager.",
  };
}

const userActiveSchema = z.object({
  userId: z.uuid(),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export async function setUserActive(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const limited = await throttle();
  if (limited) return { status: "error", message: limited };
  const parsed = userActiveSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return { status: "error", message: "Dati non validi." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_active", {
    target_user: parsed.data.userId,
    active: parsed.data.active,
  });
  if (error)
    return { status: "error", message: adminMessage(error.message, "Modifica non riuscita.") };
  revalidatePath("/admin/utenti");
  revalidatePath("/admin/squadre");
  return {
    status: "success",
    message: parsed.data.active ? "Account riattivato." : "Account disattivato.",
  };
}

// ---------------------------------------------------------------------------
// league settings
// ---------------------------------------------------------------------------
const intField = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `${label}: inserisci un numero.` })
    .int({ error: `${label}: numero intero.` })
    .min(min, { error: `${label}: minimo ${min}.` })
    .max(max, { error: `${label}: massimo ${max}.` });

const settingsSchema = z.object({
  initial_budget: intField(0, 100000, "Budget iniziale"),
  season_swap_limit: intField(0, 1000, "Limite cambi"),
  session_extra_budget: intField(0, 1000, "Budget extra"),
  market_ops_per_minute: intField(1, 100, "Operazioni al minuto"),
  quotation_change_alert_threshold: intField(0, 100, "Soglia variazioni"),
  composition_P: intField(0, 50, "Portieri"),
  composition_D: intField(0, 50, "Difensori"),
  composition_C: intField(0, 50, "Centrocampisti"),
  composition_A: intField(0, 50, "Attaccanti"),
  sync_enabled: z.enum(["on"]).optional(),
  notifications_enabled: z.enum(["on"]).optional(),
});

export async function saveLeagueSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const limited = await throttle();
  if (limited) return { status: "error", message: limited };
  const raw: Record<string, FormDataEntryValue | undefined> = {};
  for (const key of Object.keys(settingsSchema.shape)) raw[key] = formData.get(key) ?? undefined;
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const d = parsed.data;

  const updates: [string, unknown][] = [
    ["initial_budget", d.initial_budget],
    ["season_swap_limit", d.season_swap_limit],
    ["session_extra_budget", d.session_extra_budget],
    ["market_ops_per_minute", d.market_ops_per_minute],
    ["quotation_change_alert_threshold", d.quotation_change_alert_threshold],
    [
      "roster_composition",
      { P: d.composition_P, D: d.composition_D, C: d.composition_C, A: d.composition_A },
    ],
    ["sync_enabled", d.sync_enabled === "on"],
    ["notifications_enabled", d.notifications_enabled === "on"],
  ];
  const supabase = await createClient();
  for (const [key, value] of updates) {
    const { error } = await supabase.rpc("admin_set_setting", {
      p_key: key,
      p_value: value as never,
    });
    if (error) {
      return {
        status: "error",
        message: `${adminMessage(error.message, "Salvataggio non riuscito")} (${key}).`,
      };
    }
  }
  revalidatePath("/admin/impostazioni");
  revalidatePath("/admin/listone");
  revalidatePath("/mercato");
  revalidatePath("/rosa");
  return { status: "success", message: "Impostazioni salvate." };
}

const leagueCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, { error: "Almeno 4 caratteri." })
    .max(64, { error: "Massimo 64 caratteri." })
    .regex(/^[A-Za-z0-9-]+$/, { error: "Solo lettere, numeri e trattini." }),
});

export async function setLeagueCode(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const limited = await throttle();
  if (limited) return { status: "error", message: limited };
  const parsed = leagueCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_setting", {
    p_key: "league_code",
    p_value: parsed.data.code.toUpperCase(),
  });
  if (error)
    return { status: "error", message: adminMessage(error.message, "Salvataggio non riuscito.") };
  revalidatePath("/admin/impostazioni");
  return { status: "success", message: "Codice lega aggiornato: comunicalo ai nuovi iscritti." };
}

// ---------------------------------------------------------------------------
// player availability (injured, doubtful, suspended, unavailable)
// ---------------------------------------------------------------------------
const playerStatusSchema = z.object({
  playerId: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, { error: "Scegli un calciatore dal listone." }),
  kind: z.enum(["injured", "doubtful", "suspended", "unavailable", "ok"]),
  note: z.string().trim().max(200, { error: "Massimo 200 caratteri." }).optional(),
  sourceName: z.string().trim().max(60, { error: "Massimo 60 caratteri." }).optional(),
  sourceUrl: z
    .union([
      z.literal(""),
      z
        .url({ error: "Indirizzo non valido (deve iniziare con https://)." })
        // z.url() accepts javascript: and data:, which would be rendered as a
        // link in every manager's roster: only http(s) may be stored.
        .refine((value) => /^https?:\/\//i.test(value), {
          error: "Indirizzo non valido (deve iniziare con https://).",
        }),
    ])
    .optional(),
});

export async function setPlayerStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const limited = await throttle();
  if (limited) return { status: "error", message: limited };
  const parsed = playerStatusSchema.safeParse({
    playerId: formData.get("playerId"),
    kind: formData.get("kind"),
    note: formData.get("note") ?? "",
    sourceName: formData.get("sourceName") ?? "",
    sourceUrl: formData.get("sourceUrl") ?? "",
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_player_status", {
    p_player_id: d.playerId,
    p_kind: d.kind,
    p_note: d.note || null,
    p_source_name: d.sourceName || null,
    p_source_url: d.sourceUrl || null,
  });
  if (error)
    return { status: "error", message: adminMessage(error.message, "Salvataggio non riuscito.") };
  revalidatePath("/admin/indisponibili");
  revalidatePath("/rosa");
  revalidatePath("/mercato");
  return {
    status: "success",
    message: d.kind === "ok" ? "Stato rimosso: il calciatore torna disponibile." : "Stato salvato.",
  };
}
