/**
 * Big Balls Sports Data provider.
 *
 * bigballsdata.com is unreachable from the dev network, so these tests are the
 * whole verification: the fixtures are hand-written hypotheses about the
 * payload (tests/fixtures/bsd-*.json) and what is actually tested is that the
 * code survives *any* of them — candidate paths, three payload wrappers, field
 * names in several spellings — and never leaks the key into the diagnostics.
 *
 * When the admin runs it for real, Admin → Indisponibili → "Mostra risposta
 * grezza" shows the true shape; correcting it means touching the field lists in
 * src/lib/availability/bsd.ts and the fixtures here.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BSD_CANDIDATES,
  BSD_PROVIDER,
  bsdProvider,
  mapBsdStatus,
  parseEndpoints,
} from "@/lib/availability/bsd";
import { availabilityProviderFromEnv, selectedProviderName } from "@/lib/availability/provider";
import { MAX_SAMPLE_BYTES, RequestBudget, capSamples } from "@/lib/availability/shared";
import { runAvailabilitySync, type AvailabilityDb } from "@/lib/availability/run";
import type { ListonePlayer } from "@/lib/import/name-matching";

const FIXTURES = path.resolve(__dirname, "../fixtures");
const KEY = "bsd-secret-key-0123456789";

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, `bsd-${name}.json`), "utf8");
}

const LISTONE: ListonePlayer[] = [
  { id: 101, name: "Martinez Jo.", team: "Inter", role_classic: "P", qt_a: 17, status: "active" },
  { id: 103, name: "Bastoni", team: "Inter", role_classic: "D", qt_a: 18, status: "active" },
  { id: 104, name: "Barella", team: "Inter", role_classic: "C", qt_a: 22, status: "active" },
  { id: 201, name: "Lukaku", team: "Napoli", role_classic: "A", qt_a: 24, status: "active" },
  { id: 301, name: "Dybala", team: "Roma", role_classic: "A", qt_a: 26, status: "active" },
];

type Answer = { status?: number; body: string; headers?: Record<string, string> };

/**
 * A fetch that answers per exact path, so the candidate search is exercised for
 * real. Anything not listed is a 404 with a JSON error body, exactly like an
 * API that does not know the path.
 */
function fakeFetch(byPath: Record<string, Answer>) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const pathname = new URL(url).pathname;
    const match = Object.entries(byPath).find(([p]) => p === pathname);
    const answer: Answer = match?.[1] ?? {
      status: 404,
      body: '{"error":"not found","path":"unknown"}',
    };
    return new Response(answer.body, {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json", ...(answer.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, urls, headers };
}

function make(byPath: Record<string, Answer>, opts: Parameters<typeof bsdProvider>[1] = {}) {
  const fetcher = fakeFetch(byPath);
  return {
    fetcher,
    provider: bsdProvider(KEY, { fetchImpl: fetcher.impl, season: 2026, ...opts }),
  };
}

function fakeDb(): { db: AvailabilityDb; diagnostics: unknown[] } {
  const diagnostics: unknown[] = [];
  return {
    diagnostics,
    db: {
      loadPlayers: async () => LISTONE,
      loadMappings: async () => [],
      applyFeed: async (payload) => ({ statuses_applied: payload.statuses.length }),
      saveDiagnostics: async (d) => {
        diagnostics.push(d);
      },
    },
  };
}

describe("mapBsdStatus", () => {
  it("maps the Italian and English words onto our four kinds", () => {
    for (const text of ["Squalificato", "Suspended", "suspension", "banned", "ban"]) {
      expect(mapBsdStatus(text)).toBe("suspended");
    }
    for (const text of [
      "Infortunato",
      "Infortunio muscolare",
      "Injured",
      "injury",
      "Knock",
      "Hamstring strain",
      "Ankle sprain",
      "Fracture",
      "After surgery",
    ]) {
      expect(mapBsdStatus(text)).toBe("injured");
    }
    for (const text of [
      "In dubbio",
      "Doubtful",
      "Questionable",
      "Probable",
      "50-50",
      "game-time",
    ]) {
      expect(mapBsdStatus(text)).toBe("doubtful");
    }
    // Anything else non-empty is still an absence the provider is reporting.
    expect(mapBsdStatus("Scelta tecnica")).toBe("unavailable");
    expect(mapBsdStatus("National team duty")).toBe("unavailable");
    // Nothing at all: we refuse to guess.
    expect(mapBsdStatus("")).toBeNull();
    expect(mapBsdStatus("   ")).toBeNull();
    expect(mapBsdStatus(null)).toBeNull();
    expect(mapBsdStatus(undefined)).toBeNull();
    // A suspension is never read as an injury, even when both words appear.
    expect(mapBsdStatus("Squalificato dopo infortunio")).toBe("suspended");
  });
});

describe("candidate paths", () => {
  it("falls back to the second path when the first answers 404, and remembers it", async () => {
    const { provider, fetcher } = make({
      "/football/injuries": { body: await fixture("injuries-root") },
    });
    const rows = await provider.injuries();

    expect(fetcher.urls).toHaveLength(2);
    expect(fetcher.urls[0]).toContain("/v1/football/injuries"); // 404
    expect(fetcher.urls[1]).toContain("/football/injuries"); // 200
    expect(rows.map((r) => r.playerName)).toEqual(["Romelu Lukaku", "Alessandro Bastoni"]);
    expect(provider.resolvedEndpoints()).toEqual({
      injuries: BSD_CANDIDATES.injuries[1],
    });
  });

  it("goes straight to the path it was given, without trying the others", async () => {
    const { provider, fetcher } = make(
      { "/football/injuries": { body: await fixture("injuries-root") } },
      { endpoints: { injuries: BSD_CANDIDATES.injuries[1] } },
    );
    await provider.injuries();
    expect(fetcher.urls).toHaveLength(1);
    expect(fetcher.urls[0]).toContain("/football/injuries?league=serie-a");
    // Nothing new was learnt, so nothing has to be written back.
    expect(provider.resolvedEndpoints()).toBeNull();
  });

  it("reports 'endpoint non trovato' with every status it tried", async () => {
    const { provider, fetcher } = make({
      "/v1/soccer/injuries": { status: 401, body: '{"error":"unauthorized"}' },
    });
    await expect(provider.injuries()).rejects.toThrow(/endpoint non trovato/);
    await expect(provider.injuries()).rejects.toThrow(/HTTP 404[\s\S]*HTTP 401/);
    expect(fetcher.urls).toHaveLength(BSD_CANDIDATES.injuries.length * 2);
  });

  it("refuses a 200 that is not JSON and keeps looking", async () => {
    const { provider } = make({
      "/v1/football/injuries": { body: "<html>login</html>" },
      "/v1/soccer/injuries": { body: await fixture("injuries-root") },
    });
    const rows = await provider.injuries();
    expect(rows).toHaveLength(2);
    expect(provider.resolvedEndpoints()).toEqual({ injuries: BSD_CANDIDATES.injuries[2] });
  });

  it("stops at the budget instead of hammering the free tier", async () => {
    const budget = new RequestBudget(2);
    const { provider, fetcher } = make({}, { budget });
    await expect(provider.injuries()).rejects.toThrow(/budget esaurito/);
    expect(fetcher.urls).toHaveLength(2);
  });

  it("keeps only the paths that look like paths when reading the stored ones", () => {
    expect(
      parseEndpoints({ injuries: "/v1/football/injuries", fixtures: 42, lineups: "javascript:x" }),
    ).toEqual({ injuries: "/v1/football/injuries" });
    expect(parseEndpoints(null)).toEqual({});
    expect(parseEndpoints("boh")).toEqual({});
  });
});

describe("payload shapes", () => {
  it("reads the rows at the root, under `data` and under `response`", async () => {
    for (const [name, expected] of [
      ["injuries-root", ["Romelu Lukaku", "Alessandro Bastoni"]],
      [
        "injuries-data",
        [
          "Romelu Lukaku",
          "Alessandro Bastoni",
          "Nicolo Barella",
          "Paulo Dybala",
          "Giovanni Sconosciuto",
        ],
      ],
      ["injuries-response", ["Romelu Lukaku", "Alessandro Bastoni"]],
    ] as [string, string[]][]) {
      const { provider } = make({ "/v1/football/injuries": { body: await fixture(name) } });
      const rows = await provider.injuries();
      expect(
        rows.map((r) => r.playerName),
        name,
      ).toEqual(expected);
    }
  });

  it("reads the club, the kind and the expected return wherever they are", async () => {
    const { provider } = make({
      "/v1/football/injuries": { body: await fixture("injuries-root") },
    });
    const [lukaku, bastoni] = await provider.injuries();
    expect(lukaku).toMatchObject({
      externalId: 30411,
      teamName: "Napoli",
      teamId: 492,
      kind: "injured",
      reason: "Injured",
      type: "rientro previsto 2026-10-05",
    });
    expect(bastoni).toMatchObject({ teamName: "Internazionale", kind: "suspended" });
  });

  it("skips a row whose status it cannot read and counts it as unparsed", async () => {
    const { provider } = make({
      "/v1/football/injuries": { body: await fixture("injuries-data") },
    });
    const rows = await provider.injuries();
    // Six rows in, five out: "Josep Martinez" has an empty status.
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.playerName === "Josep Martinez")).toBe(false);
    expect(provider.unparsed).toBe(1);
    expect(rows.map((r) => r.kind)).toEqual([
      "injured",
      "suspended",
      "doubtful",
      "unavailable",
      "doubtful",
    ]);
  });

  it("reads the fixtures, drops the unreadable ones and honours `next`", async () => {
    const { provider } = make({ "/v1/football/fixtures": { body: await fixture("fixtures") } });
    const fixtures = await provider.fixtures(10);
    expect(fixtures).toEqual([
      {
        id: 1208002,
        kickoff: "2026-09-12T16:00:00+00:00",
        status: "NS",
        homeName: "Inter",
        awayName: "Napoli",
      },
      {
        id: 1208003,
        kickoff: "2026-09-12T18:45:00+00:00",
        status: "NS",
        homeName: "Roma",
        awayName: "Milan",
      },
    ]);
    expect(provider.unparsed).toBe(1);
    expect(
      (
        await make({
          "/v1/football/fixtures": { body: await fixture("fixtures") },
        }).provider.fixtures(1)
      ).length,
    ).toBe(1);
  });
});

describe("lineups", () => {
  it("reads a startXI/substitutes pair, with entries as objects or bare names", async () => {
    const { provider } = make({
      "/v1/football/lineups": { body: await fixture("lineups-startxi") },
    });
    expect(await provider.lineups(1208002)).toEqual([
      { externalId: 2870, playerName: "Nicolo Barella", teamName: "Inter", state: "starting" },
      { externalId: null, playerName: "Alessandro Bastoni", teamName: "Inter", state: "starting" },
      { externalId: 1100, playerName: "Josep Martinez", teamName: "Inter", state: "bench" },
      { externalId: null, playerName: "Romelu Lukaku", teamName: "Napoli", state: "starting" },
    ]);
  });

  it("reads a flat list with an isStarter flag, and skips a row without one", async () => {
    const { provider } = make({
      "/v1/football/lineups": { body: await fixture("lineups-flags") },
    });
    expect(await provider.lineups(1208002)).toEqual([
      { externalId: 2870, playerName: "Nicolo Barella", teamName: "Inter", state: "starting" },
      { externalId: 1100, playerName: "Josep Martinez", teamName: "Inter", state: "bench" },
      { externalId: null, playerName: "Romelu Lukaku", teamName: "Napoli", state: "starting" },
    ]);
    // Dybala has no flag at all: nobody may call them a starter by default.
    expect(provider.unparsed).toBe(1);
  });

  it("uses the second candidate path for the lineups too", async () => {
    const { provider, fetcher } = make({
      "/football/fixtures/1208002/lineups": { body: await fixture("lineups-startxi") },
    });
    await provider.lineups(1208002);
    expect(fetcher.urls[1]).toContain("/football/fixtures/1208002/lineups");
    expect(provider.resolvedEndpoints()).toEqual({ lineups: BSD_CANDIDATES.lineups[1] });
  });
});

describe("diagnostics", () => {
  it("keeps the raw answers, redacted, and never the key", async () => {
    const { provider, fetcher } = make({
      "/football/injuries": {
        body: JSON.stringify({ data: [], echo: { api_key: KEY, token: KEY } }),
      },
    });
    await provider.injuries();
    const samples = provider.lastSamples();

    expect(samples).toHaveLength(2); // the 404 and the 200
    expect(samples[0]).toMatchObject({ endpoint: "injuries", status: 404 });
    expect(samples[1]!.status).toBe(200);
    expect(samples[1]!.body).toContain('"echo"');
    // The key travels in both headers, and in neither the URL nor the samples.
    expect(fetcher.headers[0]!.authorization).toBe(`Bearer ${KEY}`);
    expect(fetcher.headers[0]!["x-api-key"]).toBe(KEY);
    const dump = JSON.stringify(samples);
    expect(dump).not.toContain(KEY);
    expect(fetcher.urls.join(" ")).not.toContain(KEY);
  });

  it("cuts every body at 1500 characters", async () => {
    const { provider } = make({
      "/v1/football/injuries": {
        body: JSON.stringify({ data: [], pad: "lorem ipsum ".repeat(400) }),
      },
    });
    await provider.injuries();
    expect(provider.lastSamples()[0]!.body).toHaveLength(1500);
  });

  it("never stores more than 4 KB of diagnostics", () => {
    const samples = Array.from({ length: 8 }, (_, i) => ({
      endpoint: "injuries",
      url: `https://api.bigballsdata.com/v1/football/injuries?page=${i}`,
      status: 200,
      body: "lorem ipsum ".repeat(130), // 1560 chars, over the per-call cut
    }));
    const capped = capSamples(samples);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(MAX_SAMPLE_BYTES);
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.length).toBeLessThan(samples.length);
    // Whatever is kept starts at the beginning of the answer: that is where the
    // shape is.
    expect(capped[0]!.body.startsWith("lorem ipsum")).toBe(true);
  });

  it("reads the remaining quota from whichever header the API uses", async () => {
    const { provider } = make({
      "/v1/football/injuries": {
        body: "[]",
        headers: { "x-ratelimit-remaining": "993" },
      },
    });
    await provider.injuries();
    expect(provider.rateLimitRemaining).toBe(993);
  });
});

describe("availabilityProviderFromEnv", () => {
  it("picks bsd by default when its key is set, api-football otherwise", () => {
    expect(selectedProviderName({})).toBeNull();
    expect(selectedProviderName({ BSD_API_KEY: "k" })).toBe("bsd");
    expect(selectedProviderName({ API_FOOTBALL_KEY: "k" })).toBe("api-football");
    // Both keys: bsd wins, because API-Football's free plan refuses 2026/27.
    expect(selectedProviderName({ BSD_API_KEY: "k", API_FOOTBALL_KEY: "k" })).toBe("bsd");
    // The env var decides, whatever the keys say.
    expect(selectedProviderName({ AVAILABILITY_PROVIDER: "api-football", BSD_API_KEY: "k" })).toBe(
      "api-football",
    );
    expect(selectedProviderName({ AVAILABILITY_PROVIDER: "BSD" })).toBe("bsd");
  });

  it("builds the chosen provider, or nothing at all without its key", () => {
    expect(availabilityProviderFromEnv({})).toBeNull();
    expect(availabilityProviderFromEnv({ BSD_API_KEY: "  " })).toBeNull();
    expect(availabilityProviderFromEnv({ AVAILABILITY_PROVIDER: "bsd" })).toBeNull();
    const provider = availabilityProviderFromEnv({ BSD_API_KEY: "k", BSD_LEAGUE: "135" });
    expect(provider?.name).toBe(BSD_PROVIDER);
    expect(provider?.label).toBe("Big Balls Sports Data");
    expect(availabilityProviderFromEnv({ API_FOOTBALL_KEY: "k" })?.name).toBe("api-football");
  });
});

describe("runAvailabilitySync with bsd", () => {
  it("matches the listone, writes the source and saves what it discovered", async () => {
    const { provider } = make({
      "/football/injuries": { body: await fixture("injuries-data") },
      "/v1/football/fixtures": { body: await fixture("fixtures") },
      "/v1/football/lineups": { body: await fixture("lineups-startxi") },
    });
    const { db, diagnostics } = fakeDb();
    const out = await runAvailabilitySync(provider, db, () => {}, new Date("2026-09-12T15:00:00Z"));

    expect(out.status).toBe("ok");
    expect(out.errors).toEqual([]);
    // One injury row with no status, one fixture row with no id.
    expect(out.unparsed).toBe(2);
    expect(out.requests_max).toBe(12);
    expect(out.fixture?.id).toBe(1208002);
    // Lukaku infortunato, Bastoni squalificato, Barella in dubbio, Dybala fuori.
    expect(out.statuses).toBe(4);
    // The unknown "Giovanni Sconosciuto" is offered to the admin, not applied.
    expect(out.unmatched.map((u) => u.name)).toContain("Giovanni Sconosciuto");
    // The discovered path is written back for the next run; no raw body is
    // stored, because the run succeeded and diagnostics were not asked for.
    expect(diagnostics).toEqual([
      {
        provider: "bsd",
        endpoints: {
          injuries: BSD_CANDIDATES.injuries[1],
          fixtures: BSD_CANDIDATES.fixtures[0],
          lineups: BSD_CANDIDATES.lineups[0],
        },
        samples: [],
      },
    ]);
  });

  it("saves the raw answers when the admin asks for them, and always on failure", async () => {
    const withDiagnostics = make({
      "/v1/football/injuries": { body: await fixture("injuries-root") },
      "/v1/football/fixtures": { body: await fixture("fixtures") },
    });
    const ok = fakeDb();
    await runAvailabilitySync(
      withDiagnostics.provider,
      ok.db,
      () => {},
      new Date("2026-09-11T10:00:00Z"),
      { diagnostics: true },
    );
    const saved = ok.diagnostics[0] as { samples: { endpoint: string }[] };
    expect(saved.samples.map((s) => s.endpoint)).toEqual(["injuries", "fixtures"]);

    // Nothing answers: the run fails, and the bodies are kept without asking.
    const broken = make({});
    const failed = fakeDb();
    const out = await runAvailabilitySync(
      broken.provider,
      failed.db,
      () => {},
      new Date("2026-09-11T10:00:00Z"),
    );
    expect(out.status).toBe("failed");
    expect(out.errors.join(" ")).toContain("endpoint non trovato");
    const kept = failed.diagnostics[0] as { samples: unknown[]; endpoints: unknown };
    expect(kept.endpoints).toBeNull();
    expect(kept.samples.length).toBeGreaterThan(0);
    expect(JSON.stringify(kept)).not.toContain(KEY);
  });
});
