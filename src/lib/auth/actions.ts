"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/auth/redirect";
import { withWelcome } from "@/lib/auth/welcome";
import { throttleAnonymous } from "@/lib/auth/throttle";
import {
  resetRequestSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type FormState,
} from "@/lib/auth/schemas";

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
  const limited = await throttleAnonymous("signup");
  if (limited) return { status: "error", message: limited };

  // The league code is enforced by the database trigger on auth.users, so the
  // gate holds even for direct calls to the Auth API.
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName, league_code: parsed.data.leagueCode },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/rosa`,
    },
  });
  if (error) {
    if (error.code === "weak_password") {
      return { status: "error", errors: { password: ["Scegli una password più robusta."] } };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { status: "error", message: "Troppi tentativi. Riprova tra qualche minuto." };
    }
    const text = error.message.toLowerCase();
    if (text.includes("sending") && text.includes("email")) {
      return {
        status: "error",
        message:
          "Registrazione bloccata: il server non riesce a inviare l'email di conferma. Avvisa l'admin (configurazione SMTP).",
      };
    }
    if (text.includes("already registered") || error.code === "user_already_exists") {
      return {
        status: "error",
        errors: { email: ["Questa email è già registrata: usa Accedi o Recupera password."] },
      };
    }
    // The signup trigger rejects unknown league codes ("Database error saving new user").
    if (text.includes("database error") || text.includes("league")) {
      return {
        status: "error",
        errors: { leagueCode: ["Codice lega non valido."] },
        message: "Registrazione non riuscita: controlla il codice lega e riprova.",
      };
    }
    return {
      status: "error",
      message: `Registrazione non riuscita (${error.message}). Se il problema continua, avvisa l'admin.`,
    };
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
  const limited = await throttleAnonymous("login", parsed.data.email);
  if (limited) return { status: "error", message: limited };

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

  // The destination plays the sign-in cinematic once (LoginIntro clears the flag).
  redirect(withWelcome(safeNext(formData.get("next"))));
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
  const limited = await throttleAnonymous("reset");
  if (limited) return { status: "error", message: limited };

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
    if (error.code === "same_password") {
      return {
        status: "error",
        errors: { password: ["La nuova password è uguale a quella attuale."] },
      };
    }
    if (error.code === "weak_password") {
      return { status: "error", errors: { password: ["Scegli una password più robusta."] } };
    }
    return {
      status: "error",
      message: "Link scaduto o non valido. Richiedi di nuovo il recupero password.",
    };
  }

  redirect("/rosa");
}
