"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import { notifyFreeSwap, notifySessionClosed, notifySessionOpened } from "@/lib/email/notify";
import type { FreeSwapKind } from "@/lib/email/templates";
import { createClient } from "@/lib/supabase/server";
import type { RateLimitBucket } from "@/lib/supabase/database.types";
import { zonedLocalToUtc } from "@/lib/time";

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

const MARKET_MESSAGES: Record<string, string> = {
  SESSION_NOT_OPEN: "Nessuna sessione di mercato aperta in questo momento.",
  NOT_IN_ROSTER: "Il calciatore in uscita non è nella tua rosa.",
  PLAYER_NOT_AVAILABLE: "Il calciatore scelto non è disponibile.",
  NOT_FREE_AGENT: "Il calciatore non è tra gli svincolati di questa sessione.",
  ALREADY_IN_ROSTER: "Il calciatore è già nella tua rosa.",
  ROLE_MISMATCH: "Il cambio deve essere tra calciatori dello stesso ruolo.",
  SWAP_LIMIT_REACHED: "Hai esaurito i cambi disponibili per la stagione.",
  INSUFFICIENT_CREDITS: "Crediti insufficienti per questo cambio.",
  NOT_OUT_OF_LIST: "Lo svincolo gratuito vale solo per chi è uscito dalla Serie A.",
  SAME_PLAYER: "Scegli due calciatori diversi.",
  USE_FREE_SWAP: "Questo calciatore è uscito dalla Serie A: usa lo svincolo gratuito.",
  USE_FREE_RELEASE: "Questo calciatore è uscito dalla Serie A: usa lo svincolo gratuito.",
  NO_ROLE_SLOT:
    "Non hai posti liberi in questo ruolo: svincola prima un calciatore dello stesso ruolo.",
  RATE_LIMITED: "Troppe operazioni in poco tempo: aspetta un minuto e riprova.",
  FORBIDDEN: "Non puoi operare su questa squadra.",
  TEAM_NOT_FOUND: "Squadra non trovata.",
  SESSION_NOT_FOUND: "Sessione non trovata.",
  SESSION_NOT_SCHEDULED: "La sessione non è più programmata.",
  SESSION_ALREADY_EXPIRED: "La data di chiusura è già passata: modificala prima di aprire.",
  ANOTHER_SESSION_OPEN: "C'è già una sessione aperta: chiudila prima.",
  SESSION_CLOSED: "La sessione è chiusa e non si può modificare.",
  SESSION_NOT_DELETABLE: "Si possono eliminare solo le sessioni programmate.",
  INVALID_WINDOW: "La chiusura deve essere dopo l'apertura.",
  REASON_REQUIRED: "Indica una motivazione (almeno 3 caratteri).",
  TX_NOT_FOUND: "Operazione non trovata.",
  CANNOT_REVERSE_REVERSAL: "Non si può annullare un annullamento.",
  ALREADY_REVERSED: "Operazione già annullata.",
  IN_PLAYER_NO_LONGER_IN_ROSTER:
    "Il calciatore entrato non è più in rosa: annulla prima le operazioni successive.",
  OUT_PLAYER_ALREADY_IN_ROSTER: "Il calciatore uscito è già tornato in rosa.",
};

function marketMessage(message: string | undefined, fallback: string) {
  const text = message ?? "";
  for (const [code, msg] of Object.entries(MARKET_MESSAGES)) {
    if (text.includes(code)) return msg;
  }
  return fallback;
}

const swapSchema = z.object({
  teamId: z.uuid(),
  // out-of-list placeholders created by the rosters import have negative ids
  playerOut: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, { error: "Scegli il calciatore che esce." }),
  playerIn: z.coerce.number().int().positive({ error: "Scegli il calciatore che entra." }),
});

/** Per-user throttle on attempts; limits per bucket live in the database. */
async function throttle(bucket: RateLimitBucket) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("consume_rate_limit", { p_bucket: bucket });
  return error ? marketMessage(error.message, "Troppe richieste, riprova tra poco.") : null;
}

/** Manager: swap during an open session. */
export async function swapPlayer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const limited = await throttle("market");
  if (limited) return { status: "error", message: limited };
  const parsed = swapSchema.safeParse({
    teamId: formData.get("teamId"),
    playerOut: formData.get("playerOut"),
    playerIn: formData.get("playerIn"),
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("swap_player", {
    p_team_id: parsed.data.teamId,
    p_player_out: parsed.data.playerOut,
    p_player_in: parsed.data.playerIn,
  });
  if (error)
    return { status: "error", message: marketMessage(error.message, "Cambio non riuscito.") };

  revalidatePath("/mercato");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  redirect("/mercato?done=swap");
}

/** Manager: free swap for a player who left Serie A. */
export async function freeSwapPlayer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const limited = await throttle("market");
  if (limited) return { status: "error", message: limited };
  const parsed = swapSchema.safeParse({
    teamId: formData.get("teamId"),
    playerOut: formData.get("playerOut"),
    playerIn: formData.get("playerIn"),
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("free_swap_player", {
    p_team_id: parsed.data.teamId,
    p_player_out: parsed.data.playerOut,
    p_player_in: parsed.data.playerIn,
  });
  if (error)
    return { status: "error", message: marketMessage(error.message, "Cambio non riuscito.") };

  revalidatePath("/mercato");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  redirect("/mercato?done=free_swap");
}

const playerActionSchema = z.object({
  teamId: z.uuid(),
  // out-of-list placeholders created by the rosters import have negative ids
  playerId: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, { error: "Scegli un calciatore." }),
});

type PlayerRpc = "sell_player" | "buy_player" | "release_out_of_list";

async function playerOperation(
  rpc: PlayerRpc,
  done: string,
  formData: FormData,
  /** Free operations of the out-of-list flow also alert the admins by email. */
  notify?: FreeSwapKind,
): Promise<FormState> {
  await requireUser();
  const limited = await throttle("market");
  if (limited) return { status: "error", message: limited };
  const parsed = playerActionSchema.safeParse({
    teamId: formData.get("teamId"),
    playerId: formData.get("playerId"),
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: txId, error } = await supabase.rpc(rpc, {
    p_team_id: parsed.data.teamId,
    p_player_id: parsed.data.playerId,
  });
  if (error)
    return { status: "error", message: marketMessage(error.message, "Operazione non riuscita.") };

  // after the operation is already committed: a mail problem can never undo it
  // (notifyFreeSwap ignores a purchase that counted toward the 20 swaps)
  if (notify && txId) after(() => notifyFreeSwap(notify, txId));

  revalidatePath("/mercato");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  redirect(`/mercato?done=${done}`);
}

/** Manager: release a player during an open session (credits back at the current Qt.A). */
export async function sellPlayer(_prev: FormState, formData: FormData): Promise<FormState> {
  return playerOperation("sell_player", "sell", formData);
}

/** Manager: buy a free agent to fill a hole of the same role. */
export async function buyPlayer(_prev: FormState, formData: FormData): Promise<FormState> {
  return playerOperation("buy_player", "buy", formData, "free_buy");
}

/** Manager: release a player who left Serie A, any time, refund = price paid. */
export async function releaseOutOfList(_prev: FormState, formData: FormData): Promise<FormState> {
  return playerOperation("release_out_of_list", "free_release", formData, "free_release");
}

// ---------------------------------------------------------------------------
// admin: sessions
// ---------------------------------------------------------------------------
const sessionSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, { error: "Nome troppo corto." }).max(80),
  opensAt: z.string().min(1, { error: "Indica l'apertura." }),
  closesAt: z.string().min(1, { error: "Indica la chiusura." }),
  extraBudget: z.coerce.number().int().min(0, { error: "Budget extra non valido." }).max(1000),
});

export async function saveSession(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = sessionSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    extraBudget: formData.get("extraBudget") ?? 5,
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const opens = zonedLocalToUtc(parsed.data.opensAt);
  const closes = zonedLocalToUtc(parsed.data.closesAt);
  if (!opens) return { status: "error", errors: { opensAt: ["Data non valida."] } };
  if (!closes) return { status: "error", errors: { closesAt: ["Data non valida."] } };
  if (closes <= opens) {
    return { status: "error", errors: { closesAt: ["La chiusura deve essere dopo l'apertura."] } };
  }

  const supabase = await createClient();
  const { error } = parsed.data.id
    ? await supabase.rpc("admin_update_session", {
        p_id: parsed.data.id,
        p_name: parsed.data.name,
        p_opens_at: opens.toISOString(),
        p_closes_at: closes.toISOString(),
        p_extra_budget: parsed.data.extraBudget,
      })
    : await supabase.rpc("admin_create_session", {
        p_name: parsed.data.name,
        p_opens_at: opens.toISOString(),
        p_closes_at: closes.toISOString(),
        p_extra_budget: parsed.data.extraBudget,
      });
  if (error)
    return { status: "error", message: marketMessage(error.message, "Salvataggio non riuscito.") };

  revalidatePath("/admin/sessioni");
  revalidatePath("/mercato");
  if (!parsed.data.id) redirect("/admin/sessioni");
  return { status: "success", message: "Sessione salvata." };
}

const idSchema = z.object({ id: z.uuid() });

export async function openSession(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error", message: "Sessione non valida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_market_session", { p_id: parsed.data.id });
  if (error)
    return {
      status: "error",
      // admin-only action: the raw database code helps diagnose an unexpected failure
      message: marketMessage(error.message, `Apertura non riuscita (${error.message}).`),
    };
  after(() => notifySessionOpened(parsed.data.id));
  revalidatePath("/admin/sessioni");
  revalidatePath("/mercato");
  revalidatePath("/rosa");
  return {
    status: "success",
    message: "Sessione aperta: svincolati fotografati e budget extra accreditato.",
  };
}

export async function closeSession(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error", message: "Sessione non valida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_market_session", { p_id: parsed.data.id });
  if (error)
    return {
      status: "error",
      message: marketMessage(error.message, `Chiusura non riuscita (${error.message}).`),
    };
  after(() => notifySessionClosed(parsed.data.id));
  revalidatePath("/admin/sessioni");
  revalidatePath("/mercato");
  redirect(`/admin/sessioni/${parsed.data.id}`);
}

export async function deleteSession(formData: FormData) {
  await requireAdmin();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (parsed.success) {
    const supabase = await createClient();
    await supabase.rpc("admin_delete_session", { p_id: parsed.data.id });
    revalidatePath("/admin/sessioni");
    revalidatePath("/mercato");
  }
  redirect("/admin/sessioni");
}

// ---------------------------------------------------------------------------
// admin: reversal
// ---------------------------------------------------------------------------
export async function reverseTransaction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      txId: z.uuid(),
      reason: z
        .string()
        .trim()
        .min(3, { error: "Indica una motivazione (almeno 3 caratteri)." })
        .max(300),
    })
    .safeParse({ txId: formData.get("txId"), reason: formData.get("reason") });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_transaction", {
    p_tx_id: parsed.data.txId,
    p_reason: parsed.data.reason,
  });
  if (error)
    return { status: "error", message: marketMessage(error.message, "Annullamento non riuscito.") };

  revalidatePath("/admin/operazioni");
  revalidatePath("/mercato");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  return { status: "success", message: "Operazione annullata: creata l'operazione inversa." };
}

/** Manager: undo one of their own pending operations (before the session closes). */
export async function undoPendingOperation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const limited = await throttle("market");
  if (limited) return { status: "error", message: limited };
  const parsed = z.object({ txId: z.uuid() }).safeParse({ txId: formData.get("txId") });
  if (!parsed.success) return { status: "error", message: "Operazione non valida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_pending_operation", { p_tx_id: parsed.data.txId });
  if (error)
    return { status: "error", message: marketMessage(error.message, "Annullamento non riuscito.") };
  revalidatePath("/mercato");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  redirect("/mercato?done=undo");
}
