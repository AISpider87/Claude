import "server-only";
/**
 * Minimal Brevo (ex Sendinblue) transactional client over fetch, no SDK.
 * The league already has a Brevo account with a verified sender (it powers the
 * Supabase Auth SMTP), so the same free account (300 email/day) serves the app
 * at no cost. One call per recipient: nobody sees anyone else's address and the
 * failure of one message never takes the others down.
 */
import { parseSender, type OutgoingEmail, type SendResult } from "@/lib/email/types";

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export function isBrevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim());
}

/** `EMAIL_FROM` keeps its meaning: `Nome <indirizzo>`, verified on Brevo. */
export function brevoSender(): { name: string; email: string } {
  return parseSender(process.env.EMAIL_FROM?.trim() || "SuperLega <no-reply@superlega.local>");
}

/**
 * Brevo answers an error as `{"code":"...","message":"..."}`. Keep the message
 * verbatim (the admin needs to read "Sender email is not valid" as it is) and
 * never echo what we sent, so the API key can never reach the notification log.
 */
async function providerError(res: Response): Promise<string> {
  const body = (await res.text().catch(() => "")).slice(0, 500);
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message : "";
    const code = typeof parsed.code === "string" ? parsed.code : "";
    if (message) detail = code ? `${message} (${code})` : message;
  } catch {
    // not JSON: keep the raw body
  }
  return `Brevo ${res.status}: ${(detail || res.statusText).slice(0, 200)}`;
}

export async function sendBrevoEmails(
  messages: OutgoingEmail[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return { sent: 0, failed: messages.length, error: "BREVO_API_KEY non impostata" };
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const sender = brevoSender();
  let sent = 0;
  let failed = 0;
  let error: string | undefined;
  for (const m of messages) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email: m.to }],
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
        }),
      });
      if (res.ok) {
        sent += 1;
      } else {
        failed += 1;
        error = await providerError(res);
      }
    } catch (e) {
      failed += 1;
      error = e instanceof Error ? e.message : "invio non riuscito";
    }
  }
  return { sent, failed, error };
}
