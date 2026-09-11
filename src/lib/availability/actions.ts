"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAvailabilityDb } from "@/lib/availability/db";
import { API_FOOTBALL_PROVIDER, availabilityProviderFromEnv } from "@/lib/availability/provider";
import { runAvailabilitySync } from "@/lib/availability/run";
import { requireAdmin } from "@/lib/auth/dal";
import type { FormState } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

function revalidateAll() {
  revalidatePath("/admin/indisponibili");
  revalidatePath("/rosa");
  revalidatePath("/mercato");
}

/**
 * Admin → "Aggiorna adesso": the very same job the schedule runs. It needs the
 * service client because `sync_availability` is closed to everyone else.
 */
export async function runAvailabilityNow(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  void formData;
  const provider = availabilityProviderFromEnv();
  if (!provider) {
    return {
      status: "error",
      message:
        "Nessuna chiave API-Football configurata (API_FOOTBALL_KEY): il feed automatico è spento, restano gli stati manuali.",
    };
  }
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return {
      status: "error",
      message: "Chiave service-role mancante sul server: il feed non può scrivere.",
    };
  }

  const outcome = await runAvailabilitySync(provider, supabaseAvailabilityDb(service));
  revalidateAll();
  const detail = `${outcome.statuses} indisponibili, ${outcome.lineups} in formazione, ${outcome.requests} richieste API`;
  if (outcome.status === "failed") {
    return {
      status: "error",
      message: `Aggiornamento non riuscito (${detail}): ${outcome.errors.join(" · ") || "errore sconosciuto"}`,
    };
  }
  if (outcome.status === "skipped") {
    return {
      status: "error",
      message: "Aggiornamento saltato: listone vuoto o feed non configurato.",
    };
  }
  const warnings = [
    outcome.errors.length > 0 ? `avvisi: ${outcome.errors.join(" · ")}` : "",
    outcome.unmatched.length > 0 ? `${outcome.unmatched.length} nomi da abbinare` : "",
  ].filter(Boolean);
  return {
    status: "success",
    message: `Aggiornato: ${detail}.${warnings.length > 0 ? ` ${warnings.join(" · ")}.` : ""}`,
  };
}

const mapSchema = z.object({
  playerId: z.coerce.number().int().positive(),
  externalId: z.coerce.number().int().positive(),
  externalName: z.string().trim().max(80).optional(),
  provider: z.string().trim().min(1).max(40).default(API_FOOTBALL_PROVIDER),
});

/** Admin: bind an API name to the right listone player once and for all. */
export async function confirmPlayerMap(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = mapSchema.safeParse({
    playerId: formData.get("playerId"),
    externalId: formData.get("externalId"),
    externalName: formData.get("externalName") ?? undefined,
    provider: formData.get("provider") ?? API_FOOTBALL_PROVIDER,
  });
  if (!parsed.success) return { status: "error", message: "Abbinamento non valido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_confirm_player_map", {
    p_player_id: parsed.data.playerId,
    p_provider: parsed.data.provider,
    p_external_id: parsed.data.externalId,
    p_external_name: parsed.data.externalName ?? null,
  });
  if (error) {
    const message = error.message.includes("PLAYER_NOT_FOUND")
      ? "Calciatore non trovato nel listone."
      : error.message.includes("FORBIDDEN")
        ? "Operazione riservata all'admin."
        : "Abbinamento non salvato.";
    return { status: "error", message };
  }
  revalidateAll();
  return {
    status: "success",
    message: "Abbinamento salvato: il prossimo aggiornamento userà questo calciatore.",
  };
}
