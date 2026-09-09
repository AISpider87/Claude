import { z } from "zod";

export const emailSchema = z.email({ error: "Inserisci un indirizzo email valido." }).trim();

export const passwordSchema = z
  .string()
  .min(8, { error: "La password deve avere almeno 8 caratteri." })
  .max(72, { error: "La password è troppo lunga." });

/** League codes are case-insensitive and ignore surrounding whitespace. */
export const leagueCodeSchema = z
  .string()
  .trim()
  .min(4, { error: "Inserisci il codice della lega." })
  .max(64)
  .transform((v) => v.toUpperCase());

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, { error: "Il nome deve avere almeno 2 caratteri." })
  .max(40, { error: "Il nome è troppo lungo." });

export const signUpSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  leagueCode: leagueCodeSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Inserisci la password." }),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const updatePasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    error: "Le password non coincidono.",
    path: ["confirm"],
  });

export type FormState<TFields extends string = string> =
  | {
      status: "idle" | "error" | "success";
      message?: string;
      errors?: Partial<Record<TFields, string[]>>;
    }
  | undefined;
