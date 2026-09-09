import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmails } from "@/lib/email/resend";
import { sessionClosedEmail, sessionOpenedEmail } from "@/lib/email/templates";

describe("email templates", () => {
  it("describes an opened session in Italian with the Rome deadline", () => {
    const mail = sessionOpenedEmail({
      sessionName: "Prima sessione",
      closesAt: "2026-09-10T18:00:00.000Z",
      extraBudget: 5,
      freeAgents: 120,
      siteUrl: "https://superlega.example/",
    });
    expect(mail.subject).toBe("SuperLega · mercato aperto: Prima sessione");
    expect(mail.text).toContain("fino a 10/09/2026, 20:00");
    expect(mail.text).toContain("5 crediti extra");
    expect(mail.text).toContain("https://superlega.example/mercato");
    expect(mail.html).toContain("<strong>120</strong>");
  });

  it("escapes HTML in names and lists invalid rosters on close", () => {
    const mail = sessionClosedEmail({
      sessionName: "Sessione <b>2</b>",
      swaps: 14,
      invalidTeams: ["Real Gear Second", "Tettenham"],
      siteUrl: "https://superlega.example",
    });
    expect(mail.html).not.toContain("<b>2</b>");
    expect(mail.html).toContain("&#60;b&#62;2");
    expect(mail.text).toContain("Rose da sistemare: Real Gear Second, Tettenham.");
    expect(mail.text).toContain("https://superlega.example/rosa");
  });

  it("says all rosters are fine when none is invalid", () => {
    const mail = sessionClosedEmail({
      sessionName: "S",
      swaps: 0,
      invalidTeams: [],
      siteUrl: "https://x.test",
    });
    expect(mail.text).toContain("Tutte le rose sono in regola.");
  });
});

describe("sendEmails (Resend batch)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips sending without an API key and reports every message as failed", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchImpl = vi.fn();
    const result = await sendEmails(
      [{ to: "a@x.test", subject: "s", html: "h", text: "t" }],
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 1, error: "RESEND_API_KEY non impostata" });
  });

  it("posts one batch per 100 recipients with a separate recipient per message", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "SuperLega <lega@example.test>");
    const calls: { url: string; body: unknown; auth: string | undefined }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        auth: headers.Authorization,
      });
      return new Response("{}", { status: 200 });
    });
    const messages = Array.from({ length: 150 }, (_, i) => ({
      to: `m${i}@x.test`,
      subject: "s",
      html: "h",
      text: "t",
    }));
    const result = await sendEmails(messages, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ sent: 150, failed: 0, error: undefined });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails/batch");
    expect(calls[0]!.auth).toBe("Bearer re_test");
    const first = calls[0]!.body as { from: string; to: string[] }[];
    expect(first).toHaveLength(100);
    expect(first[0]).toMatchObject({ from: "SuperLega <lega@example.test>", to: ["m0@x.test"] });
    expect((calls[1]!.body as unknown[]).length).toBe(50);
  });

  it("reports provider errors without throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchImpl = vi.fn(async () => new Response("invalid from", { status: 422 }));
    const result = await sendEmails(
      [{ to: "a@x.test", subject: "s", html: "h", text: "t" }],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.error).toContain("Resend 422");
  });
});
