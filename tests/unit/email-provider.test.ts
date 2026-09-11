import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendBrevoEmails } from "@/lib/email/brevo";
import { emailProvider, emailProviderLabel, isEmailConfigured } from "@/lib/email/provider";

const KEY = "xkeysib-super-secret-key";

function message(to = "admin@x.test") {
  return { to, subject: "SuperLega · Cambio gratuito: Alpha", html: "<p>h</p>", text: "t" };
}

describe("sendBrevoEmails", () => {
  beforeEach(() => {
    vi.stubEnv("BREVO_API_KEY", KEY);
    vi.stubEnv("EMAIL_FROM", "SuperLega <lega@superlega.test>");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips sending without an API key and reports every message as failed", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    const fetchImpl = vi.fn();
    const result = await sendBrevoEmails([message()], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 1, error: "BREVO_API_KEY non impostata" });
  });

  it("posts one call per recipient with the verified sender and the api-key header", async () => {
    const calls: { url: string; body: Record<string, unknown>; key: string | undefined }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        key: headers["api-key"],
      });
      return new Response("{}", { status: 201 });
    });
    const result = await sendBrevoEmails(
      [message("a@x.test"), message("b@x.test")],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ sent: 2, failed: 0, error: undefined });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(calls[0]!.key).toBe(KEY);
    expect(calls[0]!.body).toMatchObject({
      sender: { name: "SuperLega", email: "lega@superlega.test" },
      to: [{ email: "a@x.test" }],
      subject: "SuperLega · Cambio gratuito: Alpha",
      htmlContent: "<p>h</p>",
      textContent: "t",
    });
    expect(calls[1]!.body).toMatchObject({ to: [{ email: "b@x.test" }] });
  });

  it("reports a partial failure without stopping the other recipients", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response('{"code":"invalid_parameter","message":"Invalid email address"}', {
            status: 400,
          })
        : new Response("{}", { status: 201 });
    });
    const result = await sendBrevoEmails(
      [message("bad"), message("ok@x.test")],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.error).toBe("Brevo 400: Invalid email address (invalid_parameter)");
  });

  it("surfaces the provider error verbatim and never leaks the key", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          '{"code":"invalid_parameter","message":"Sender email is not valid. Please add it in your account."}',
          { status: 400 },
        ),
    );
    const result = await sendBrevoEmails([message()], fetchImpl as unknown as typeof fetch);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.error).toContain("Sender email is not valid. Please add it in your account.");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("keeps a non-JSON error body as it is", async () => {
    const fetchImpl = vi.fn(async () => new Response("Too Many Requests", { status: 429 }));
    const result = await sendBrevoEmails([message()], fetchImpl as unknown as typeof fetch);
    expect(result.error).toBe("Brevo 429: Too Many Requests");
  });

  it("does not throw when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const result = await sendBrevoEmails([message()], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ sent: 0, failed: 1, error: "fetch failed" });
  });

  it("accepts an EMAIL_FROM without a display name", async () => {
    vi.stubEnv("EMAIL_FROM", "lega@superlega.test");
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("{}", { status: 201 });
    });
    await sendBrevoEmails([message()], fetchImpl as unknown as typeof fetch);
    expect(bodies[0]).toMatchObject({
      sender: { name: "The SuperLeague", email: "lega@superlega.test" },
    });
  });
});

describe("provider selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has no provider when no key is configured", () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(emailProvider()).toBeNull();
    expect(isEmailConfigured()).toBe(false);
    expect(emailProviderLabel()).toBeNull();
  });

  it("prefers Brevo when both keys are set and nothing is forced", () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("BREVO_API_KEY", KEY);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(emailProvider()).toBe("brevo");
    expect(emailProviderLabel()).toBe("Brevo");
  });

  it("falls back to Resend when only its key is set", () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(emailProvider()).toBe("resend");
    expect(emailProviderLabel()).toBe("Resend");
  });

  it("obeys EMAIL_PROVIDER when its key is there", () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("BREVO_API_KEY", KEY);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(emailProvider()).toBe("resend");
  });

  it("configures nothing when the forced provider has no key", () => {
    vi.stubEnv("EMAIL_PROVIDER", "brevo");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(emailProvider()).toBeNull();
    expect(isEmailConfigured()).toBe(false);
  });

  it("ignores an unknown EMAIL_PROVIDER and auto-detects", () => {
    vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
    vi.stubEnv("BREVO_API_KEY", KEY);
    vi.stubEnv("RESEND_API_KEY", "");
    expect(emailProvider()).toBe("brevo");
  });
});
