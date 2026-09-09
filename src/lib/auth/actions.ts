"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/auth/redirect";
import {
  resetRequestSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type FormState,
} from "@/lib/auth/schemas";

const GENERIC_ERROR = "Qualcosa è andato storto. Riprova tra poco.";

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    leagueCode: formData.get("leagueCode"),
  });
  if (!parsed.success) {
    return { status: "error", errors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data: codeOk, error: codeError } = await supabase.rpc("validate_league_code", {
    code: parsed.data.leagueCode,
  });
  if (codeError) return { status: "error", message: GENERIC_ERROR };
  if (!codeOk) {
    return { status: "error", errors: { leagueCode: ["Codice lega non valido."] } };
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/rosa`,
    },
  });
  if (error) {
    return { status: "error", message: "Registrazione non riuscita. Controlla i dati e riprova." };
  }

  redirect("/verifica-email");
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { status: "error", errors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "Devi prima confermare l'email: controlla la tua casella.",
      };
    }
    return { status: "error", message: "Email o password non corretti." };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", errors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reimposta-password`,
  });

  // Same answer whether or not the address exists: no account enumeration.
  return {
    status: "success",
    message: "Se l'indirizzo è registrato riceverai un'email con le istruzioni.",
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { status: "error", errors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      status: "error",
      message: "Link scaduto o non valido. Richiedi di nuovo il recupero password.",
    };
  }

  redirect("/rosa");
}
