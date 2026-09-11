import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  apiFootballProvider,
  availabilityProviderFromEnv,
  currentSeason,
  errorMessages,
  RequestBudget,
} from "@/lib/availability/provider";
import {
  imminentFixture,
  mapReason,
  runAvailabilitySync,
  type AvailabilityDb,
  type AvailabilityPayload,
} from "@/lib/availability/run";
import type { ListonePlayer } from "@/lib/import/name-matching";

const FIXTURES = path.resolve(__dirname, "../fixtures");

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, `api-football-${name}.json`), "utf8");
}

/** The listone as the tests need it: two Martinez in Inter, on purpose. */
const LISTONE: ListonePlayer[] = [
  { id: 101, name: "Martinez Jo.", team: "Inter", role_classic: "P", qt_a: 17, status: "active" },
  { id: 102, name: "Martinez Lau.", team: "Inter", role_classic: "A", qt_a: 30, status: "active" },
  { id: 103, name: "Bastoni", team: "Inter", role_classic: "D", qt_a: 18, status: "active" },
  { id: 104, name: "Barella", team: "Inter", role_classic: "C", qt_a: 22, status: "active" },
  { id: 201, name: "Lukaku", team: "Napoli", role_classic: "A", qt_a: 24, status: "active" },
  { id: 301, name: "Dybala", team: "Roma", role_classic: "A", qt_a: 26, status: "active" },
];

const NOW_IMMINENT = new Date("2026-09-12T15:00:00Z"); // one hour before Inter-Napoli
const NOW_QUIET = new Date("2026-09-11T10:00:00Z"); // more than a day before

interface Recorder {
  db: AvailabilityDb;
  payloads: AvailabilityPayload[];
}

function fakeDb(overrides: Partial<AvailabilityDb> = {}): Recorder {
  const payloads: AvailabilityPayload[] = [];
  return {
    payloads,
    db: {
      loadPlayers: async () => LISTONE,
      loadMappings: async () => [],
      applyFeed: async (payload) => {
        payloads.push(payload);
        return { statuses_applied: payload.statuses.length };
      },
      ...overrides,
    },
  };
}

/**
 * A fetch that serves the hand-written fixtures, so the real provider (zod
 * parsing, budget, headers, error handling) is what the tests exercise. The
 * dev network blocks api-sports.io, so this is as close as it gets.
 */
function fakeFetch(
  bodies: Partial<Record<"injuries" | "fixtures" | "lineups", string | (() => Response)>> = {},
) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const which = url.includes("/fixtures/lineups")
      ? "lineups"
      : url.includes("/fixtures")
        ? "fixtures"
        : "injuries";
    const body = bodies[which];
    if (typeof body === "function") return body();
    return new Response(body ?? "{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-requests-remaining": "87",
      },
    });
  }) as typeof fetch;
  return { impl, urls, headers };
}

async function provider(bodies: Parameters<typeof fakeFetch>[0], budget = new RequestBudget(3)) {
  const fetcher = fakeFetch(bodies);
  return {
    fetcher,
    instance: apiFootballProvider("SECRET-KEY", {
      season: 2026,
      budget,
      fetchImpl: fetcher.impl,
    }),
  };
}

describe("mapReason", () => {
  it("maps the provider's free text onto the four kinds we store", () => {
    expect(mapReason("Missing Fixture", "Knee Injury")).toBe("injured");
    expect(mapReason("Missing Fixture", "Injury")).toBe("injured");
    expect(mapReason("Missing Fixture", "Suspended")).toBe("suspended");
    expect(mapReason("Missing Fixture", "Red Card")).toBe("suspended");
    expect(mapReason("Missing Fixture", "Yellow Cards")).toBe("suspended");
    expect(mapReason("Questionable", "Illness")).toBe("doubtful");
    expect(mapReason("Missing Fixture", "Coach Decision")).toBe("unavailable");
    expect(mapReason("Missing Fixture", "National selection")).toBe("unavailable");
    // Nothing recognised at all is still an absence, and "injured" is the
    // honest default for a feed that only lists absentees.
    expect(mapReason("", "")).toBe("injured");
    expect(mapReason(null, undefined)).toBe("injured");
  });
});

describe("currentSeason", () => {
  it("uses the starting year from July on, and lets the env override it", () => {
    expect(currentSeason(new Date("2026-09-11T00:00:00Z"), {})).toBe(2026);
    expect(currentSeason(new Date("2027-06-30T00:00:00Z"), {})).toBe(2026);
    expect(currentSeason(new Date("2027-07-01T00:00:00Z"), {})).toBe(2027);
    expect(currentSeason(new Date("2026-09-11T00:00:00Z"), { API_FOOTBALL_SEASON: "2024" })).toBe(
      2024,
    );
    expect(currentSeason(new Date("2026-09-11T00:00:00Z"), { API_FOOTBALL_SEASON: "boh" })).toBe(
      2026,
    );
  });

  it("has no provider without a key: the feature is simply off", () => {
    expect(availabilityProviderFromEnv({})).toBeNull();
    expect(availabilityProviderFromEnv({ API_FOOTBALL_KEY: "  " })).toBeNull();
    expect(availabilityProviderFromEnv({ API_FOOTBALL_KEY: "k" })?.name).toBe("api-football");
  });
});

describe("imminentFixture", () => {
  it("picks the first kick-off within three hours and ignores finished games", async () => {
    const list = JSON.parse(await fixture("fixtures")) as { response: unknown[] };
    void list;
    const fixtures = [
      {
        id: 1,
        kickoff: "2026-09-12T16:00:00Z",
        status: "NS",
        homeName: "Inter",
        awayName: "Napoli",
      },
      { id: 2, kickoff: "2026-09-12T18:45:00Z", status: "NS", homeName: "Roma", awayName: "Milan" },
    ];
    expect(imminentFixture(fixtures, NOW_IMMINENT)?.id).toBe(1);
    expect(imminentFixture(fixtures, NOW_QUIET)).toBeNull();
    expect(imminentFixture([{ ...fixtures[0]!, status: "FT" }], NOW_IMMINENT)).toBeNull();
  });
});

describe("runAvailabilitySync", () => {
  it("maps, matches and writes a full run with exactly three requests", async () => {
    const { instance, fetcher } = await provider({
      injuries: await fixture("injuries"),
      fixtures: await fixture("fixtures"),
      lineups: await fixture("lineups"),
    });
    const { db, payloads } = fakeDb();
    const out = await runAvailabilitySync(instance, db, () => {}, NOW_IMMINENT);

    expect(out.status).toBe("ok");
    expect(out.errors).toEqual([]);
    expect(out.requests).toBe(3);
    expect(out.rate_limit_remaining).toBe(87);
    expect(fetcher.urls).toHaveLength(3);
    expect(fetcher.urls[0]).toContain("/injuries?league=135&season=2026");
    expect(fetcher.urls[1]).toContain("next=10");
    expect(fetcher.urls[2]).toContain("/fixtures/lineups?fixture=1208002");
    // The key travels in the header and never in the URL.
    expect(fetcher.headers[0]!["x-apisports-key"]).toBe("SECRET-KEY");
    expect(fetcher.urls.join(" ")).not.toContain("SECRET-KEY");

    const payload = payloads[0]!;
    const byPlayer = new Map(payload.statuses.map((s) => [s.player_id, s]));
    expect([...byPlayer.keys()].sort((a, b) => a - b)).toEqual([103, 104, 201, 301]);
    expect(byPlayer.get(201)?.kind).toBe("injured"); // Lukaku, Knee Injury
    expect(byPlayer.get(103)?.kind).toBe("suspended"); // Bastoni, Suspended
    expect(byPlayer.get(104)?.kind).toBe("doubtful"); // Barella, Questionable
    expect(byPlayer.get(301)?.kind).toBe("unavailable"); // Dybala, Coach Decision
    expect(byPlayer.get(201)?.source_name).toBe("API-Football");
    expect(payload.clear_missing).toBe(true);
    expect(payload.provider).toBe("api-football");

    // Lineups of the imminent fixture only, for the players we could match.
    expect(payload.lineups).toEqual([
      {
        player_id: 104,
        state: "starting",
        fixture_id: 1208002,
        kickoff: "2026-09-12T16:00:00+00:00",
      },
      {
        player_id: 201,
        state: "starting",
        fixture_id: 1208002,
        kickoff: "2026-09-12T16:00:00+00:00",
      },
    ]);

    // "Lautaro Martinez" is ambiguous (two Martinez in Inter), the Pisa player
    // is unknown, "Josep Martinez" is ambiguous too: nothing is applied for
    // them and the admin gets the list.
    expect(out.unmatched.map((u) => u.external_id).sort((a, b) => Number(a) - Number(b))).toEqual([
      3000, 4000, 5116,
    ]);
    expect(out.unmatched.find((u) => u.external_id === 3000)?.kind).toBe("ambiguous");
    expect(out.unmatched.find((u) => u.external_id === 4000)?.kind).toBe("not_found");
    // Every match found by name is remembered so the next run does not guess again.
    expect(payload.map.map((m) => m.external_id).sort((a, b) => a - b)).toEqual([
      1100, 2000, 2867, 30411,
    ]);
  });

  it("never calls the lineups endpoint when no fixture is imminent", async () => {
    const { instance, fetcher } = await provider({
      injuries: await fixture("injuries"),
      fixtures: await fixture("fixtures"),
      lineups: await fixture("lineups"),
    });
    const { db, payloads } = fakeDb();
    const out = await runAvailabilitySync(instance, db, () => {}, NOW_QUIET);

    expect(out.status).toBe("ok");
    expect(out.requests).toBe(2);
    expect(fetcher.urls.some((u) => u.includes("/fixtures/lineups"))).toBe(false);
    expect(out.fixture).toBeNull();
    expect(payloads[0]!.lineups).toEqual([]);
  });

  it("never spends more than three requests, whatever happens", async () => {
    const budget = new RequestBudget(3);
    const { instance, fetcher } = await provider(
      {
        injuries: await fixture("injuries"),
        fixtures: await fixture("fixtures"),
        lineups: await fixture("lineups"),
      },
      budget,
    );
    // Burn the budget as if a previous step had already used it…
    budget.spend("test");
    const out = await runAvailabilitySync(instance, fakeDb().db, () => {}, NOW_IMMINENT);
    expect(budget.used).toBe(3);
    expect(fetcher.urls.length).toBeLessThanOrEqual(2);
    expect(out.requests).toBe(3);
    expect(out.errors.join(" ")).toContain("budget esaurito");
  });

  it("reports the provider's own error verbatim and clears nothing", async () => {
    const { instance } = await provider({
      injuries: await fixture("error"),
      fixtures: await fixture("error"),
    });
    const { db, payloads } = fakeDb();
    const out = await runAvailabilitySync(instance, db, () => {}, NOW_QUIET);

    expect(out.status).toBe("failed");
    expect(out.reason).toBe("provider_error");
    expect(out.errors[0]).toContain("Missing application key");
    expect(out.errors[0]).toContain("token");
    // A failed read must never be read as "everybody is fit again".
    expect(payloads[0]!.clear_missing).toBe(false);
    expect(payloads[0]!.statuses).toEqual([]);
    // The run is still recorded, so the admin sees the error in the panel.
    expect(payloads[0]!.run).toMatchObject({ status: "failed" });
  });

  it("surfaces an HTTP failure (bad key, quota) without leaking the key", async () => {
    const { instance } = await provider({
      injuries: () => new Response("nope", { status: 499 }),
      fixtures: () => new Response("nope", { status: 429 }),
    });
    const out = await runAvailabilitySync(instance, fakeDb().db, () => {}, NOW_QUIET);
    expect(out.status).toBe("failed");
    expect(out.errors.join(" ")).toContain("HTTP 499");
    expect(out.errors.join(" ")).toContain("HTTP 429");
    expect(out.errors.join(" ")).not.toContain("SECRET-KEY");
  });

  it("skips without a provider and without a listone, and never throws on a DB error", async () => {
    expect((await runAvailabilitySync(null, fakeDb().db)).status).toBe("skipped");
    expect((await runAvailabilitySync(null, fakeDb().db)).reason).toBe("no_provider");

    const { instance } = await provider({ injuries: await fixture("injuries") });
    const empty = await runAvailabilitySync(
      instance,
      fakeDb({ loadPlayers: async () => [] }).db,
      () => {},
      NOW_QUIET,
    );
    expect(empty).toMatchObject({ status: "skipped", reason: "no_players" });

    const { instance: another } = await provider({
      injuries: await fixture("injuries"),
      fixtures: await fixture("fixtures"),
    });
    const broken = await runAvailabilitySync(
      another,
      fakeDb({
        applyFeed: async () => {
          throw new Error("FORBIDDEN");
        },
      }).db,
      () => {},
      NOW_QUIET,
    );
    expect(broken).toMatchObject({ status: "failed", reason: "db_error" });
    expect(broken.errors.join(" ")).toContain("FORBIDDEN");
  });

  it("uses a known mapping instead of guessing the name again", async () => {
    const { instance } = await provider({
      injuries: await fixture("injuries"),
      fixtures: await fixture("fixtures"),
      lineups: await fixture("lineups"),
    });
    const { db, payloads } = fakeDb({
      // The admin bound "Lautaro Martinez" (3000) to Martinez Lau. by hand.
      loadMappings: async () => [{ external_id: 3000, player_id: 102, confidence: "confirmed" }],
    });
    const out = await runAvailabilitySync(instance, db, () => {}, NOW_IMMINENT);
    const statuses = new Map(payloads[0]!.statuses.map((s) => [s.player_id, s]));
    expect(statuses.get(102)?.kind).toBe("injured");
    expect(out.unmatched.some((u) => u.external_id === 3000)).toBe(false);
    // A confirmed mapping is not re-sent as an "auto" guess.
    expect(payloads[0]!.map.some((m) => m.external_id === 3000)).toBe(false);
  });
});

describe("apiFootballProvider", () => {
  it("refuses a body larger than the cap and a non-JSON answer", async () => {
    const big = await provider({
      injuries: () =>
        new Response("x".repeat(10), {
          status: 200,
          headers: { "content-length": String(5 * 1024 * 1024) },
        }),
    });
    await expect(big.instance.injuries()).rejects.toThrow(/troppo grande/);

    const html = await provider({ injuries: () => new Response("<html>nope</html>") });
    await expect(html.instance.injuries()).rejects.toThrow(/non JSON/);
  });

  it("gives up after the budget and reports it, instead of burning the quota", async () => {
    const budget = new RequestBudget(1);
    const { instance } = await provider({ injuries: "{}", fixtures: "{}" }, budget);
    await instance.injuries();
    await expect(instance.fixtures(10)).rejects.toThrow(/budget esaurito/);
    expect(budget.used).toBe(1);
    expect(budget.left).toBe(0);
  });

  it("reads errors in every shape the API uses", () => {
    expect(errorMessages([])).toEqual([]);
    expect(errorMessages({})).toEqual([]);
    expect(errorMessages(null)).toEqual([]);
    expect(errorMessages({ token: "bad key" })).toEqual(["token: bad key"]);
    expect(errorMessages(["plan limit"])).toEqual(["plan limit"]);
    expect(errorMessages("boom")).toEqual(["boom"]);
  });

  it("tolerates a response with nothing it expects", async () => {
    const { instance } = await provider({
      injuries: JSON.stringify({ response: [{ nothing: true }, null, 42] }),
      fixtures: JSON.stringify({ response: [{ fixture: { id: null } }] }),
      lineups: JSON.stringify({ response: [] }),
    });
    expect(await instance.injuries()).toEqual([]);
    expect(await instance.fixtures(10)).toEqual([]);
    expect(await instance.lineups(1)).toEqual([]);
  });

  it("does not blow up when the network is blocked (dev sandbox)", async () => {
    const fail = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const instance = apiFootballProvider("SECRET-KEY", { fetchImpl: fail, season: 2026 });
    await expect(instance.injuries()).rejects.toThrow(/rete non raggiungibile/);
  });
});
