import "server-only";
/**
 * Minimal Resend client over fetch (no SDK dependency). Batch endpoint: up to 100
 * messages per call, each with its own recipient so members never see each
 * other's addresses.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: number;
  failed: number;
  error?: string;
}

const BATCH_SIZE = 100;
const ENDPOINT = "https://api.resend.com/emails/batch";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function emailSender(): string {
  return process.env.EMAIL_FROM?.trim() || "SuperLega <onboarding@resend.dev>";
}

export async function sendEmails(
  messages: OutgoingEmail[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: 0, failed: messages.length, error: "RESEND_API_KEY non impostata" };
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const from = emailSender();
  let sent = 0;
  let failed = 0;
  let error: string | undefined;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text })),
        ),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        failed += chunk.length;
        const body = (await res.text().catch(() => "")).slice(0, 200);
        error = `Resend ${res.status}: ${body || res.statusText}`;
      }
    } catch (e) {
      failed += chunk.length;
      error = e instanceof Error ? e.message : "invio non riuscito";
    }
  }
  return { sent, failed, error };
}
