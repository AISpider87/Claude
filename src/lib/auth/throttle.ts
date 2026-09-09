import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

type AnonymousBucket = "login" | "signup" | "reset";

/** Best-effort client address behind Vercel's proxy; "unknown" keeps the limiter working. */
async function clientAddress() {
  const h = await headers();
  // Vercel sets these from the actual connection; x-forwarded-for can be
  // prefixed by the client, so it is only the last resort.
  const trusted = h.get("x-vercel-forwarded-for") || h.get("x-real-ip");
  if (trusted) return trusted.split(",")[0]!.trim();
  const forwarded = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim());
  return forwarded?.at(-1) || "unknown";
}

/**
 * Per-attempt throttle for anonymous auth flows, enforced in the database
 * (login: 10 per 15 minutes per address+email; signup and reset: 5 per hour
 * per address). Returns an Italian message when the caller must wait.
 */
export async function throttleAnonymous(
  bucket: AnonymousBucket,
  email?: string,
): Promise<string | null> {
  const key = email ? `${await clientAddress()}|${email.toLowerCase()}` : await clientAddress();
  const supabase = await createClient();
  const { error } = await supabase.rpc("consume_anonymous_attempt", {
    p_bucket: bucket,
    p_key: key,
  });
  if (!error) return null;
  if (error.message.includes("RATE_LIMITED")) {
    return "Troppi tentativi: aspetta qualche minuto e riprova.";
  }
  // A limiter failure must never lock everyone out; Auth keeps its own limits.
  return null;
}
