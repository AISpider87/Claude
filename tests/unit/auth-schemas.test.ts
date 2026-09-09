import { describe, expect, it } from "vitest";
import {
  leagueCodeSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@/lib/auth/schemas";
import { safeNext } from "@/lib/auth/redirect";

describe("leagueCodeSchema", () => {
  it("normalizes to upper case and trims", () => {
    expect(leagueCodeSchema.parse("  superlega-2026 ")).toBe("SUPERLEGA-2026");
  });

  it("rejects codes that are too short", () => {
    expect(leagueCodeSchema.safeParse("ab").success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const valid = {
    displayName: "Daniele",
    email: "dan@example.com",
    password: "password123",
    leagueCode: "SUPERLEGA",
  };

  it("accepts a valid payload", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("reports Italian field errors", () => {
    const result = signUpSchema.safeParse({ ...valid, password: "short", email: "nope" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("La password deve avere almeno 8 caratteri.");
      expect(messages).toContain("Inserisci un indirizzo email valido.");
    }
  });
});

describe("signInSchema", () => {
  it("requires a password", () => {
    expect(signInSchema.safeParse({ email: "a@b.it", password: "" }).success).toBe(false);
  });
});

describe("updatePasswordSchema", () => {
  it("requires matching passwords", () => {
    const result = updatePasswordSchema.safeParse({ password: "password123", confirm: "other" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["confirm"]);
  });
});

describe("safeNext", () => {
  it("keeps relative in-app paths", () => {
    expect(safeNext("/mercato")).toBe("/mercato");
  });

  it("falls back on external or protocol-relative urls", () => {
    expect(safeNext("https://evil.example")).toBe("/rosa");
    expect(safeNext("//evil.example")).toBe("/rosa");
    expect(safeNext(null)).toBe("/rosa");
  });
});
