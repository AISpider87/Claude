import "server-only";
/**
 * Which transactional provider sends the league emails.
 *
 * `EMAIL_PROVIDER` decides explicitly; otherwise Brevo wins when BREVO_API_KEY
 * is set (the league's Brevo account already sends the Supabase Auth emails, so
 * it costs nothing), then Resend, then nobody: with no key configured the
 * notification is logged as "skipped", exactly as before.
 */
import { isBrevoConfigured, sendBrevoEmails } from "@/lib/email/brevo";
import { isResendConfigured, sendResendEmails } from "@/lib/email/resend";
import type { OutgoingEmail, SendResult } from "@/lib/email/types";

export type EmailProvider = "brevo" | "resend";

const LABELS: Record<EmailProvider, string> = { brevo: "Brevo", resend: "Resend" };

export function emailProvider(): EmailProvider | null {
  const choice = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (choice === "brevo") return isBrevoConfigured() ? "brevo" : null;
  if (choice === "resend") return isResendConfigured() ? "resend" : null;
  if (isBrevoConfigured()) return "brevo";
  if (isResendConfigured()) return "resend";
  return null;
}

export function isEmailConfigured(): boolean {
  return emailProvider() !== null;
}

/** "Brevo" / "Resend" for the admin UI, null when nothing is configured. */
export function emailProviderLabel(): string | null {
  const provider = emailProvider();
  return provider ? LABELS[provider] : null;
}

export async function sendEmails(
  messages: OutgoingEmail[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  switch (emailProvider()) {
    case "brevo":
      return sendBrevoEmails(messages, fetchImpl);
    case "resend":
      return sendResendEmails(messages, fetchImpl);
    default:
      return { sent: 0, failed: messages.length, error: "Provider email non configurato" };
  }
}
