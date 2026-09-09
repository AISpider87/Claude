"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: "Colore non valido (es. #38bdf8)." });

const teamSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, { error: "Nome troppo corto." }).max(60),
  shortName: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,4}$/, { error: "Sigla di 2–4 lettere o cifre." })
    .optional()
    .or(z.literal("")),
  colorPrimary: hexColor.optional().or(z.literal("")),
  colorSecondary: hexColor.optional().or(z.literal("")),
});

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

function dbMessage(message: string | undefined, fallback: string) {
  const text = message ?? "";
  if (text.includes("teams_name_key")) return "Esiste già una squadra con questo nome.";
  if (text.includes("teams_short_name")) return "Sigla già usata da un'altra squadra.";
  if (text.includes("INSUFFICIENT_CREDITS")) return "Crediti insufficienti per questo prezzo.";
  if (text.includes("ALREADY_IN_ROSTER")) return "Il calciatore è già in questa rosa.";
  if (text.includes("NOT_IN_ROSTER")) return "Il calciatore non è in questa rosa.";
  if (text.includes("PLAYER_NOT_FOUND")) return "Calciatore non trovato nel listone.";
  if (text.includes("USER_NOT_FOUND")) return "Utente non trovato o disattivato.";
  if (text.includes("FORBIDDEN")) return "Operazione riservata all'admin.";
  return fallback;
}

export async function saveTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = teamSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    shortName: formData.get("shortName") ?? "",
    colorPrimary: formData.get("colorPrimary") ?? "",
    colorSecondary: formData.get("colorSecondary") ?? "",
  });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_upsert_team", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_short_name: parsed.data.shortName || null,
    p_color_primary: parsed.data.colorPrimary || null,
    p_color_secondary: parsed.data.colorSecondary || null,
  });
  if (error || !id) {
    return { status: "error", message: dbMessage(error?.message, "Salvataggio non riuscito.") };
  }
  revalidatePath("/admin/squadre");
  revalidatePath("/squadre");
  if (!parsed.data.id) redirect(`/admin/squadre/${id}`);
  return { status: "success", message: "Squadra salvata." };
}

export async function setTeamOwner(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const teamId = z.uuid().safeParse(formData.get("teamId"));
  const raw = formData.get("userId");
  const userId = raw === "" || raw == null ? null : z.uuid().safeParse(raw);
  if (!teamId.success || (userId && !userId.success)) {
    return { status: "error", message: "Dati non validi." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_team_owner", {
    p_team_id: teamId.data,
    p_user_id: userId ? userId.data : null,
  });
  if (error)
    return { status: "error", message: dbMessage(error.message, "Operazione non riuscita.") };
  revalidatePath("/admin/squadre");
  revalidatePath("/rosa");
  return { status: "success", message: "Manager aggiornato." };
}

export async function setTeamCredits(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      teamId: z.uuid(),
      credits: z.coerce.number().int().min(0, { error: "I crediti non possono essere negativi." }),
      note: z.string().trim().max(200).optional(),
    })
    .safeParse({
      teamId: formData.get("teamId"),
      credits: formData.get("credits"),
      note: formData.get("note") ?? "",
    });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_team_credits", {
    p_team_id: parsed.data.teamId,
    p_credits: parsed.data.credits,
    p_note: parsed.data.note || null,
  });
  if (error)
    return { status: "error", message: dbMessage(error.message, "Operazione non riuscita.") };
  revalidatePath("/admin/squadre");
  revalidatePath("/rosa");
  return { status: "success", message: "Crediti aggiornati." };
}

export async function assignPlayer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      teamId: z.uuid(),
      playerId: z.coerce.number().int().positive({ error: "Scegli un calciatore dalla lista." }),
      price: z.coerce.number().int().min(0, { error: "Prezzo non valido." }),
    })
    .safeParse({
      teamId: formData.get("teamId"),
      playerId: formData.get("playerId"),
      price: formData.get("price"),
    });
  if (!parsed.success) return { status: "error", errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_player", {
    p_team_id: parsed.data.teamId,
    p_player_id: parsed.data.playerId,
    p_price: parsed.data.price,
  });
  if (error)
    return { status: "error", message: dbMessage(error.message, "Assegnazione non riuscita.") };
  revalidatePath("/admin/squadre");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  return { status: "success", message: "Calciatore aggiunto alla rosa." };
}

export async function removePlayer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      teamId: z.uuid(),
      playerId: z.coerce.number().int().positive(),
      refund: z.coerce.number().int().min(0),
    })
    .safeParse({
      teamId: formData.get("teamId"),
      playerId: formData.get("playerId"),
      refund: formData.get("refund") ?? 0,
    });
  if (!parsed.success) return { status: "error", message: "Dati non validi." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove_player", {
    p_team_id: parsed.data.teamId,
    p_player_id: parsed.data.playerId,
    p_refund: parsed.data.refund,
  });
  if (error)
    return { status: "error", message: dbMessage(error.message, "Rimozione non riuscita.") };
  revalidatePath("/admin/squadre");
  revalidatePath("/rosa");
  revalidatePath("/listone");
  return { status: "success", message: "Calciatore rimosso dalla rosa." };
}
