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
import {
  chooseRoute,
  parseRouteIndex,
  pickSerieA,
  requiredParams,
} from "@/lib/availability/bsd-discovery";
import { availabilityProviderFromEnv, selectedProviderName } from "@/lib/availability/provider";
import { MAX_SAMPLE_BYTES, RequestBudget, capSamples } from "@/lib/availability/shared";
import { runAvailabilitySync, type AvailabilityDb } from "@/lib/availability/run";
import type { ListonePlayer } from "@/lib/import/name-matching";

const FIXTURES = path.resolve(__dirname, "../fixtures");
const KEY = "bsd-secret-key-0123456789";

/** The static candidates this file leans on, by name rather than by position. */
const T = {
  v1Injuries: "/v1/injuries?sport={sport}&league={league}",
  footballInjuries: "/football/injuries?league={league}",
  soccerInjuries: "/v1/soccer/injuries?league={league}",
  footballLineups: "/football/fixtures/{fixture}/lineups",
} as const;

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
    const parsed = new URL(url);
    const withQuery = `${parsed.pathname}${parsed.search}`;
    // The most specific key wins, so a fixture can answer one thing to
    // `/v1/injuries` and another to `/v1/injuries?sport=soccer&league=serie-a`.
    const match = Object.entries(byPath)
      .filter(([p]) => p === parsed.pathname || p === withQuery)
      .sort((a, b) => b[0].length - a[0].length)[0];
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

    // The real order: first guess, then the provider's own route list (which
    // does not answer either, here), then the remaining guesses.
    expect(fetcher.urls.map((u) => new URL(u).pathname)).toEqual([
      "/v1/injuries", // the route the live API really has, with sport+league
      "/openapi.json", // no answer: ask the provider for its route list
      "/v1/",
      "/v1/injuries", // the same route without the sport
      "/v1/football/injuries",
      "/football/injuries", // this one answers
    ]);
    expect(rows.map((r) => r.playerName)).toEqual(["Romelu Lukaku", "Alessandro Bastoni"]);
    expect(provider.resolvedEndpoints()).toEqual({ injuries: T.footballInjuries, routes: {} });
  });

  it("goes straight to the path it was given, without trying the others", async () => {
    const { provider, fetcher } = make(
      { "/football/injuries": { body: await fixture("injuries-root") } },
      { endpoints: { templates: { injuries: T.footballInjuries }, routes: {} } },
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
    // First call: four candidates plus the two discovery attempts. Second
    // call: the four candidates only — the route list is asked once per run.
    expect(fetcher.urls).toHaveLength(BSD_CANDIDATES.injuries.length * 2 + 2);
  });

  it("refuses a 200 that is not JSON and keeps looking", async () => {
    const { provider } = make({
      "/v1/football/injuries": { body: "<html>login</html>" },
      "/v1/soccer/injuries": { body: await fixture("injuries-root") },
    });
    const rows = await provider.injuries();
    expect(rows).toHaveLength(2);
    expect(provider.resolvedEndpoints()).toEqual({ injuries: T.soccerInjuries, routes: {} });
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
    ).toEqual({ templates: { injuries: "/v1/football/injuries" }, routes: {} });
    // The new shape, and the old one, and nonsense.
    expect(
      parseEndpoints({
        routes: {
          injuries: {
            path: "/v1/soccer/injuries",
            params: { league: "league_id" },
            league: "it-serie-a",
          },
          fixtures: { path: "nope" },
        },
      }),
    ).toEqual({
      templates: {},
      routes: {
        injuries: {
          path: "/v1/soccer/injuries",
          params: { league: "league_id" },
          league: "it-serie-a",
        },
      },
    });
    expect(parseEndpoints(null)).toEqual({ templates: {}, routes: {} });
    expect(parseEndpoints("boh")).toEqual({ templates: {}, routes: {} });
  });
});

describe("self-discovery", () => {
  /**
   * In production every candidate answers 404 with
   * `"Browse every endpoint at GET /v1/ or the OpenAPI spec at GET /openapi.json"`,
   * so the provider reads that list instead of guessing further.
   */
  async function discovering(extra: Record<string, Answer> = {}) {
    return make({
      "/openapi.json": { body: await fixture("openapi") },
      "/v1/soccer/injuries": { body: await fixture("injuries-root") },
      "/v1/soccer/fixtures": { body: await fixture("fixtures") },
      "/v1/soccer/fixtures/1208002/lineups": { body: await fixture("lineups-startxi") },
      ...extra,
    });
  }

  it("reads the route list and calls the injuries route it names", async () => {
    const { provider, fetcher } = await discovering();
    const rows = await provider.injuries();

    expect(fetcher.urls.map((u) => new URL(u).pathname)).toEqual([
      "/v1/injuries", // the first guess, 404 in this fake
      "/openapi.json", // the route list the 404 body points at
      "/v1/soccer/injuries", // what the list says
    ]);
    // `league_id`, not `league`, and the slug the spec's enum accepts.
    expect(fetcher.urls.at(-1)).toBe(
      "https://api.bigballsdata.com/v1/soccer/injuries?league_id=it-serie-a",
    );
    expect(rows.map((r) => r.playerName)).toEqual(["Romelu Lukaku", "Alessandro Bastoni"]);
  });

  it("declares what it found and what it substituted", async () => {
    const { provider } = await discovering();
    await provider.injuries();
    await provider.fixtures(10);
    expect(provider.notes[0]).toBe(
      "rotte trovate: 8 da /openapi.json · scelte: /v1/soccer/injuries (league_id), /v1/soccer/fixtures (league_id, season, status)",
    );
    expect(provider.notes.join(" ")).toContain('"serie-a" sostituita con "it-serie-a"');
  });

  it("sends only the parameters the spec declares", async () => {
    const { provider, fetcher } = await discovering();
    await provider.fixtures(10);
    // season and status exist on this route; they would not be sent otherwise.
    expect(fetcher.urls.at(-1)).toBe(
      "https://api.bigballsdata.com/v1/soccer/fixtures?league_id=it-serie-a&season=2026&status=upcoming",
    );
  });

  it("fills a {fixtureId} path template for the lineups", async () => {
    const { provider, fetcher } = await discovering();
    const entries = await provider.lineups(1208002);
    expect(fetcher.urls.at(-1)).toBe(
      "https://api.bigballsdata.com/v1/soccer/fixtures/1208002/lineups",
    );
    expect(entries).toHaveLength(4);
  });

  it("caches the routes, so the next run costs one request per capability", async () => {
    const first = await discovering();
    await first.provider.injuries();
    const cached = first.provider.resolvedEndpoints();
    expect(cached).toMatchObject({
      routes: {
        injuries: {
          path: "/v1/soccer/injuries",
          params: { league: "league_id" },
          league: "it-serie-a",
        },
      },
    });

    const second = await discovering();
    const reused = bsdProvider(KEY, {
      fetchImpl: second.fetcher.impl,
      season: 2026,
      endpoints: parseEndpoints(cached),
    });
    await reused.injuries();
    expect(second.fetcher.urls).toEqual([
      "https://api.bigballsdata.com/v1/soccer/injuries?league_id=it-serie-a",
    ]);
    expect(reused.resolvedEndpoints()).toBeNull(); // nothing new to store
  });

  it("discovers again when a cached route starts answering 404", async () => {
    // The old route is gone; the list now names another one.
    const { provider, fetcher } = await discovering();
    const stored = parseEndpoints({
      routes: { injuries: { path: "/v1/soccer/injuries-old", params: { league: "league_id" } } },
    });
    const stale = bsdProvider(KEY, {
      fetchImpl: fetcher.impl,
      season: 2026,
      endpoints: stored,
    });
    const rows = await stale.injuries();

    expect(fetcher.urls.map((u) => new URL(u).pathname)).toEqual([
      "/v1/soccer/injuries-old", // cached, now 404
      "/v1/injuries", // first guess, 404
      "/openapi.json", // the list again
      "/v1/soccer/injuries", // the route that exists today
    ]);
    expect(rows).toHaveLength(2);
    expect(stale.resolvedEndpoints()).toMatchObject({
      routes: { injuries: { path: "/v1/soccer/injuries" } },
    });
    void provider;
  });

  it("falls back to the static candidates when the list is unreadable", async () => {
    const { provider, fetcher } = make({
      "/openapi.json": { body: '{"hello":"world"}' },
      "/v1/": { body: "<html>nope</html>" },
      "/v1/soccer/injuries": { body: await fixture("injuries-root") },
    });
    const rows = await provider.injuries();
    expect(rows).toHaveLength(2);
    // Third candidate, reached after the unusable list.
    expect(fetcher.urls.at(-1)).toContain("/v1/soccer/injuries?league=serie-a");
    expect(provider.notes.join(" ")).toContain("formato non riconosciuto");
  });

  it("says which words it looked for when no route matches", async () => {
    const { provider } = make({
      "/openapi.json": {
        body: JSON.stringify({ paths: { "/v1/soccer/standings": { get: {} } } }),
      },
    });
    await expect(provider.injuries()).rejects.toThrow(/endpoint non trovato/);
    expect(provider.notes.join(" · ")).toContain(
      "nessuna rotta per indisponibili: cercate injur, unavailab, sideline, absence, absent",
    );
    expect(provider.notes[0]).toContain("nessuna scelta");
  });

  it("never goes over the budget, discovery included", async () => {
    // Nothing answers at all: every candidate of every capability, the two
    // discovery attempts and the corrections must still stop at the budget.
    const budget = new RequestBudget(12);
    const { provider, fetcher } = make({}, { budget });
    for (const run of [
      () => provider.injuries(),
      () => provider.fixtures(10),
      () => provider.lineups(1),
    ]) {
      await expect(run()).rejects.toThrow(/endpoint non trovato|budget esaurito/);
    }
    expect(budget.used).toBe(12);
    expect(budget.left).toBe(0);
    expect(fetcher.urls).toHaveLength(12);
  });

  it("reads a route list that is not an OpenAPI document at all", () => {
    expect(parseRouteIndex(["GET /v1/soccer/injuries", "/v1/soccer/fixtures"])).toEqual([
      { path: "/v1/soccer/injuries", methods: ["GET"], params: [] },
      { path: "/v1/soccer/fixtures", methods: ["GET"], params: [] },
    ]);
    expect(
      parseRouteIndex({
        routes: [{ path: "/v1/soccer/injuries", method: "get", params: ["league", "team"] }],
      })[0],
    ).toMatchObject({ path: "/v1/soccer/injuries", methods: ["GET"] });
    expect(parseRouteIndex({ "/v1/soccer/lineups": { methods: ["GET"] } })[0]?.path).toBe(
      "/v1/soccer/lineups",
    );
    // Nothing recognisable: no discovery, and the candidates take over.
    expect(parseRouteIndex({ hello: "world" })).toEqual([]);
    expect(parseRouteIndex(null)).toEqual([]);
    expect(parseRouteIndex("boh")).toEqual([]);
  });

  it("never chooses a route that cannot name the fixture, nor a non-GET one", () => {
    const routes = parseRouteIndex({
      paths: {
        "/v1/soccer/lineups": { get: { parameters: [{ name: "team_id", in: "query" }] } },
        "/v1/soccer/injuries": { post: {} },
      },
    });
    expect(chooseRoute(routes, "lineups", "serie-a")).toBeNull();
    expect(chooseRoute(routes, "injuries", "serie-a")).toBeNull();
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

describe("the live API's own answers", () => {
  const BARE = "/v1/injuries";
  const WITH_PARAMS = "/v1/injuries?sport=soccer&league=serie-a";

  /** A previous run cached `/v1/injuries` with no parameters at all. */
  const bareRoute = { templates: {}, routes: { injuries: { path: BARE, params: {} } } };

  it("adds the parameters an HTTP 400 says are required, and remembers them", async () => {
    const { provider, fetcher } = make(
      {
        [BARE]: { status: 400, body: await fixture("bad-request") },
        [WITH_PARAMS]: { body: await fixture("injuries-root") },
      },
      { endpoints: bareRoute },
    );
    const rows = await provider.injuries();

    expect(fetcher.urls).toEqual([
      "https://api.bigballsdata.com/v1/injuries",
      "https://api.bigballsdata.com/v1/injuries?sport=soccer&league=serie-a",
    ]);
    expect(rows).toHaveLength(2);
    // Next run goes straight there, with the names the API itself asked for.
    expect(provider.resolvedEndpoints()).toMatchObject({
      routes: { injuries: { path: BARE, params: { sport: "sport", league: "league" } } },
    });
  });

  it("reads the parameter names out of any phrasing", () => {
    expect(
      requiredParams('{"error":{"message":"sport or league query param is required"}}'),
    ).toEqual(["sport", "league"]);
    expect(requiredParams("league and season parameters are required")).toEqual([
      "league",
      "season",
    ]);
    expect(requiredParams('{"message":"Missing required parameter: sport"}')).toEqual(["sport"]);
    expect(requiredParams('{"error":{"message":"not found"}}')).toEqual([]);
    expect(requiredParams("<html>502</html>")).toEqual([]);
  });

  it("asks /v1/leagues what it calls Serie A when ours is refused", async () => {
    const { provider, fetcher } = make(
      {
        "/v1/injuries?league=serie-a": { status: 400, body: await fixture("league-unknown") },
        "/v1/leagues": { body: await fixture("leagues") },
        "/v1/injuries?league=it-serie-a": { body: await fixture("injuries-root") },
      },
      {
        endpoints: {
          templates: {},
          routes: { injuries: { path: BARE, params: { league: "league" } } },
        },
      },
    );
    const rows = await provider.injuries();

    expect(fetcher.urls.map((u) => new URL(u).pathname + new URL(u).search)).toEqual([
      "/v1/injuries?league=serie-a",
      "/v1/leagues?sport=soccer",
      "/v1/injuries?league=it-serie-a",
    ]);
    expect(rows).toHaveLength(2);
    expect(provider.notes.join(" · ")).toContain(
      '"serie-a" sostituita con "it-serie-a" (Serie A, da /v1/leagues)',
    );
    // Cached, so no other run has to ask again.
    expect(provider.resolvedEndpoints()).toMatchObject({ league: "it-serie-a" });
  });

  it("prefers the Italian Serie A over the Brazilian one", async () => {
    const rows = JSON.parse(await fixture("leagues")) as { data: unknown[] };
    expect(pickSerieA(rows.data)).toEqual({ id: "it-serie-a", label: "Serie A" });
    expect(pickSerieA([{ id: "x", name: "Premier League" }])).toBeNull();
  });

  it("tries the other spelling of the sport once, and keeps the one that works", async () => {
    const { provider, fetcher } = make(
      {
        "/v1/injuries?sport=soccer": { status: 400, body: '{"error":{"message":"unknown sport"}}' },
        "/v1/injuries?sport=football": { body: await fixture("injuries-root") },
      },
      {
        endpoints: {
          templates: {},
          routes: { injuries: { path: BARE, params: { sport: "sport" } } },
        },
      },
    );
    expect(await provider.injuries()).toHaveLength(2);
    expect(fetcher.urls.map((u) => new URL(u).pathname + new URL(u).search)).toEqual([
      "/v1/injuries?sport=soccer",
      "/v1/leagues?sport=soccer", // the league is checked first, and 404s here
      "/v1/injuries?sport=football",
    ]);
    expect(provider.resolvedEndpoints()).toMatchObject({ sport: "football" });
  });

  it("reads /v1/matches rows in either shape", async () => {
    for (const name of ["matches-snake", "matches-nested"]) {
      const { provider } = make({ "/v1/matches": { body: await fixture(name) } });
      const fixtures = await provider.fixtures(10);
      expect(fixtures.slice(0, 2), name).toEqual([
        {
          id: 1208002,
          kickoff: "2026-09-12T16:00:00.000Z",
          status: name === "matches-snake" ? "scheduled" : "NS",
          homeName: "Inter",
          awayName: "Napoli",
        },
        {
          id: 1208003,
          kickoff: name === "matches-snake" ? "2026-09-12T18:45:00Z" : "2026-09-12T18:45:00+00:00",
          status: name === "matches-snake" ? "scheduled" : "NS",
          homeName: "Roma",
          awayName: "Milan",
        },
      ]);
    }
  });

  it("reads the line-ups of /v1/stored_matches/{id}/lineups", async () => {
    const { provider, fetcher } = make({
      "/v1/stored_matches/1208002/lineups": { body: await fixture("stored-lineups") },
    });
    expect(await provider.lineups(1208002)).toEqual([
      { externalId: 2870, playerName: "Nicolo Barella", teamName: "Inter", state: "starting" },
      { externalId: null, playerName: "Alessandro Bastoni", teamName: "Inter", state: "starting" },
      { externalId: 1100, playerName: "Josep Martinez", teamName: "Inter", state: "bench" },
      { externalId: null, playerName: "Romelu Lukaku", teamName: "Napoli", state: "starting" },
    ]);
    // First candidate, no discovery needed: it is the route the API really has.
    expect(fetcher.urls).toHaveLength(1);
  });

  it("lists the keys of the first row when rows arrive but none can be read", async () => {
    const { provider } = make({
      "/v1/injuries?sport=soccer&league=serie-a": { body: await fixture("unreadable") },
    });
    expect(await provider.injuries()).toEqual([]);
    expect(provider.unparsed).toBe(2);
    expect(provider.notes.join(" · ")).toContain(
      "indisponibili: 2 righe ricevute, nessuna leggibile · chiavi della prima riga: evt, prsn, sq, st, upd",
    );
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
    expect(fetcher.urls.at(-1)).toContain("/football/fixtures/1208002/lineups");
    expect(provider.resolvedEndpoints()).toEqual({ lineups: T.footballLineups, routes: {} });
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

    // Every attempt is kept: the guesses, the two discovery calls, the answer,
    // and the `/v1/leagues` check that an empty answer triggers.
    expect(samples.map((s2) => `${s2.endpoint}:${s2.status}`)).toEqual([
      "injuries:404",
      "discovery:404",
      "discovery:404",
      "injuries:404",
      "injuries:404",
      "injuries:200",
      "leagues:404",
    ]);
    expect(samples.find((s2) => s2.status === 200)!.body).toContain('"echo"');
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
    const sample = provider.lastSamples().find((s2) => s2.status === 200)!;
    expect(sample.body).toHaveLength(1500);
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
    expect(out.requests_max).toBe(24);
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
          injuries: T.footballInjuries,
          fixtures: "/v1/football/fixtures?league={league}&status=upcoming",
          lineups: "/v1/football/lineups?fixture={fixture}",
          routes: {},
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
    // Every call of the run, guesses and route list included, in order.
    expect(saved.samples.map((s) => s.endpoint)).toEqual([
      "injuries",
      "discovery",
      "discovery",
      "injuries",
      "injuries",
      "fixtures",
      "fixtures",
      "fixtures",
    ]);

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
