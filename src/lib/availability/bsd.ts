/**
 * Big Balls Sports Data (bigballsdata.com) — the default availability provider.
 *
 * Chosen because API-Football's free plan answers "Free plans do not have
 * access to this season, try from 2022 to 2024" for Serie A 2026/27, while BSD
 * offers a free tier (no card, ~1000 requests/day) that covers the current
 * season. See docs/DECISIONS.md.
 *
 * Everything here is written blind: the dev network blocks bigballsdata.com, so
 * neither the exact paths nor the exact payload shape could be verified. Two
 * defences, so that one real run in production is enough to fix it:
 *
 *  1. **candidate paths** — each capability has a small list of plausible
 *     paths, tried in order until one answers 200 with JSON; the winner is
 *     remembered in `league_settings.availability_endpoints`, so the next run
 *     goes straight to it (one request per capability);
 *  2. **diagnostics** — every attempt (path, status, first 1500 chars of the
 *     body, key redacted) is kept in `lastSamples()` and shown to the admin in
 *     Admin → Indisponibili → "Mostra risposta grezza".
 *
 * The parsing is deliberately shape-tolerant: rows may sit at the root or under
 * `data` / `response` / `results` / `items`, and every field is read from a
 * list of plausible names. A row nobody can read is skipped and counted in
 * `unparsed` — never guessed.
 */

import {
  MAX_BYTES,
  ProviderError,
  RequestBudget,
  SampleLog,
  TIMEOUT_MS,
  at,
  currentSeason,
  pickArray,
  pickBool,
  pickInt,
  pickString,
  readCapped,
  readRateLimit,
  rowsOf,
  type AvailabilityProvider,
  type ProviderFixture,
  type ProviderInjury,
  type ProviderLineupEntry,
  type StatusKind,
} from "@/lib/availability/shared";

export const BSD_PROVIDER = "bsd";
export const BSD_SOURCE_NAME = "Big Balls Sports Data";
export const BSD_DOCS_URL = "https://bigballsdata.com/";
export const BSD_BASE_URL = "https://api.bigballsdata.com";
export const BSD_DEFAULT_LEAGUE = "serie-a";

/** ~1000 requests/day: a discovery run may try every candidate and still fit. */
export const BSD_BUDGET = 12;

export type BsdCapability = "injuries" | "fixtures" | "lineups";

/**
 * The paths to try, in order, per capability. `{league}` and `{fixture}` are
 * filled in before the call. The first one that answers 200 with JSON wins and
 * is remembered; the others are never called again.
 */
export const BSD_CANDIDATES: Record<BsdCapability, string[]> = {
  injuries: [
    "/v1/football/injuries?league={league}",
    "/football/injuries?league={league}",
    "/v1/soccer/injuries?league={league}",
    "/injuries?league={league}",
  ],
  fixtures: [
    "/v1/football/fixtures?league={league}&status=upcoming",
    "/football/fixtures?league={league}",
    "/v1/soccer/fixtures?league={league}",
  ],
  lineups: [
    "/v1/football/lineups?fixture={fixture}",
    "/football/fixtures/{fixture}/lineups",
    "/v1/soccer/lineups?fixture={fixture}",
  ],
};

// ---------------------------------------------------------------------------
// status text → one of our four kinds
// ---------------------------------------------------------------------------
/**
 * Italian and English, most specific first. A suspension is not an injury, and
 * a doubt is not an absence, so the order matters. Anything non-empty that
 * nothing matches is still an absence the provider is reporting → `unavailable`.
 * Empty or unreadable → null: the row is skipped and counted as unparsed,
 * because a wrong status on somebody's roster is worse than a missing one.
 */
const STATUS_RULES: { kind: StatusKind; test: RegExp }[] = [
  { kind: "suspended", test: /squalif|suspen|sospen|\bban(ned)?\b/i },
  { kind: "injured", test: /infort|injur|knock|strain|sprain|fracture|surgery/i },
  { kind: "doubtful", test: /dubbio|doubt|question|probable|50-?50|game[-\s]?time/i },
];

export function mapBsdStatus(text: string | null | undefined): StatusKind | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  for (const rule of STATUS_RULES) {
    if (rule.test.test(value)) return rule.kind;
  }
  return "unavailable";
}

// ---------------------------------------------------------------------------
// field names we accept, per concept
// ---------------------------------------------------------------------------
const PLAYER_NAME = ["player.name", "player", "name", "playerName", "athlete.name"];
const PLAYER_ID = ["player.id", "playerId", "player_id", "athlete.id", "id"];
const TEAM_NAME = ["team.name", "team", "club", "teamName", "club.name", "team_name"];
const TEAM_ID = ["team.id", "teamId", "team_id", "club.id"];
const STATUS_TEXT = [
  "status",
  "type",
  "injuryStatus",
  "availability",
  "reason",
  "description",
  "injury",
  "detail",
];
const RETURN_DATE = ["expectedReturn", "returnDate", "until", "expected_return", "return_date"];
const FIXTURE_ID = ["id", "fixtureId", "fixture.id", "matchId", "fixture_id", "match_id"];
const KICKOFF = [
  "kickoff",
  "date",
  "startTime",
  "utcDate",
  "datetime",
  "start",
  "kickoff_at",
  "start_time",
  "fixture.date",
];
const FIXTURE_STATUS = ["status", "state", "status.short", "statusShort", "fixture.status.short"];
const HOME = ["home.name", "homeTeam.name", "teams.home.name", "home", "homeTeam", "home_team"];
const AWAY = ["away.name", "awayTeam.name", "teams.away.name", "away", "awayTeam", "away_team"];
const STARTERS = ["startXI", "startingXI", "start_xi", "starters", "lineup", "starting"];
const BENCH = ["substitutes", "bench", "subs", "substitutions"];
const STARTER_FLAG = ["isStarter", "starting", "startXI", "starter", "lineup", "is_starter"];

export interface BsdOptions {
  baseUrl?: string;
  league?: string;
  season?: number;
  budget?: RequestBudget;
  fetchImpl?: typeof fetch;
  /** Paths that worked on a previous run, from `league_settings`. */
  endpoints?: Partial<Record<BsdCapability, string>>;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(vars[key] ?? `{${key}}`),
  );
}

/**
 * Big Balls Sports Data. The key travels in both `Authorization: Bearer …` and
 * `x-api-key` (which of the two the API wants is unverified; sending both is
 * harmless) and never in a URL, a log line, an error or a sample.
 */
export function bsdProvider(key: string, opts: BsdOptions = {}) {
  const baseUrl = (opts.baseUrl ?? BSD_BASE_URL).replace(/\/+$/, "");
  const league = opts.league ?? BSD_DEFAULT_LEAGUE;
  const season = opts.season ?? currentSeason();
  const budget = opts.budget ?? new RequestBudget(BSD_BUDGET);
  const doFetch = opts.fetchImpl ?? fetch;
  const samples = new SampleLog([key]);
  const endpoints: Partial<Record<BsdCapability, string>> = { ...opts.endpoints };
  let learned = false;
  let rateLimitRemaining: number | null = null;
  let unparsed = 0;

  /** Known path first (it should answer), then the remaining candidates. */
  function templatesFor(what: BsdCapability): string[] {
    const known = endpoints[what];
    const rest = BSD_CANDIDATES[what].filter((t) => t !== known);
    return known ? [known, ...rest] : rest;
  }

  async function call(what: BsdCapability, vars: Record<string, string>): Promise<unknown> {
    const tried: string[] = [];
    for (const template of templatesFor(what)) {
      const path = fill(template, vars);
      const url = `${baseUrl}${path}`;
      budget.spend(path);

      let res: Response;
      try {
        res = await doFetch(url, {
          headers: {
            authorization: `Bearer ${key}`,
            "x-api-key": key,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        // Never echo the exception as-is: it can carry the request (and the key).
        const name = e instanceof Error ? e.name : "errore";
        samples.add(what, url, 0, `rete non raggiungibile (${name})`);
        tried.push(`${path} → rete non raggiungibile`);
        continue;
      }
      const remaining = readRateLimit(res);
      if (remaining !== null) rateLimitRemaining = remaining;

      const text = await safeBody(res);
      samples.add(what, url, res.status, text);
      if (!res.ok) {
        tried.push(`${path} → HTTP ${res.status}`);
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        tried.push(`${path} → HTTP ${res.status} ma risposta non JSON`);
        continue;
      }
      if (endpoints[what] !== template) {
        endpoints[what] = template;
        learned = true;
      }
      return json;
    }
    throw new ProviderError(
      `${what}: endpoint non trovato (${tried.join(" · ") || "nessun tentativo"})`,
    );
  }

  return {
    name: BSD_PROVIDER,
    label: BSD_SOURCE_NAME,
    docsUrl: BSD_DOCS_URL,
    season,
    budget,
    get rateLimitRemaining() {
      return rateLimitRemaining;
    },
    get unparsed() {
      return unparsed;
    },
    lastSamples: () => samples.all(),
    resolvedEndpoints: () => (learned ? { ...endpoints } : null),

    async injuries(): Promise<ProviderInjury[]> {
      const json = await call("injuries", { league, season: String(season) });
      const out: ProviderInjury[] = [];
      for (const row of rowsOf(json)) {
        const playerName = pickString(row, PLAYER_NAME);
        const statusText = pickString(row, STATUS_TEXT);
        const kind = mapBsdStatus(statusText);
        if (!playerName || !kind) {
          unparsed += 1;
          continue;
        }
        const back = pickString(row, RETURN_DATE);
        out.push({
          externalId: pickInt(row, PLAYER_ID),
          playerName,
          type: back ? `rientro previsto ${back}` : "",
          reason: statusText,
          kind,
          teamId: pickInt(row, TEAM_ID),
          teamName: pickString(row, TEAM_NAME),
          fixtureId: null,
          fixtureDate: null,
        });
      }
      return out;
    },

    async fixtures(next: number): Promise<ProviderFixture[]> {
      const json = await call("fixtures", { league, season: String(season) });
      const out: ProviderFixture[] = [];
      for (const row of rowsOf(json)) {
        const id = pickInt(row, FIXTURE_ID);
        const kickoff = pickString(row, KICKOFF);
        if (id == null || !kickoff || Number.isNaN(Date.parse(kickoff))) {
          unparsed += 1;
          continue;
        }
        out.push({
          id,
          kickoff,
          status: pickString(row, FIXTURE_STATUS),
          homeName: pickString(row, HOME),
          awayName: pickString(row, AWAY),
        });
      }
      // `next` is honoured client-side: a candidate path may ignore the filter.
      return out
        .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
        .slice(0, Math.max(1, next));
    },

    async lineups(fixtureId: number): Promise<ProviderLineupEntry[]> {
      const json = await call("lineups", { league, fixture: String(fixtureId) });
      const out: ProviderLineupEntry[] = [];
      for (const row of rowsOf(json)) {
        const teamName = pickString(row, TEAM_NAME);
        const starters = pickArray(row, STARTERS);
        const bench = pickArray(row, BENCH);
        if (starters.length > 0 || bench.length > 0) {
          // Shape A: one row per team, with the two lists.
          pushEntries(out, starters, teamName, "starting");
          pushEntries(out, bench, teamName, "bench");
          continue;
        }
        // Shape B: one row per player, with a flag.
        const playerName = pickString(row, PLAYER_NAME);
        const starting = pickBool(row, STARTER_FLAG);
        if (!playerName || starting === null) {
          unparsed += 1;
          continue;
        }
        out.push({
          externalId: pickInt(row, PLAYER_ID),
          playerName,
          teamName,
          state: starting ? "starting" : "bench",
        });
      }
      return out;
    },
  } satisfies AvailabilityProvider;

  /** Entries may be `{player:{…}}`, `{name:…}` or a bare name. */
  function pushEntries(
    out: ProviderLineupEntry[],
    entries: unknown[],
    teamName: string,
    state: "starting" | "bench",
  ) {
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (entry.trim()) out.push({ externalId: null, playerName: entry.trim(), teamName, state });
        else unparsed += 1;
        continue;
      }
      const playerName = pickString(entry, PLAYER_NAME);
      if (!playerName) {
        unparsed += 1;
        continue;
      }
      out.push({
        externalId: pickInt(entry, PLAYER_ID),
        playerName,
        teamName: pickString(entry, TEAM_NAME) || teamName,
        state,
      });
    }
  }
}

/** The body of any answer, for the diagnostics; an unreadable one is empty. */
async function safeBody(res: Response): Promise<string> {
  try {
    return await readCapped(res, MAX_BYTES);
  } catch {
    return "";
  }
}

/** Exported for the tests: the league as configured (slug or numeric id). */
export function bsdLeague(env: Record<string, string | undefined> = process.env): string {
  const value = env.BSD_LEAGUE?.trim();
  return value && value.length > 0 ? value : BSD_DEFAULT_LEAGUE;
}

/** Reads the stored discovery result, ignoring anything that is not a path. */
export function parseEndpoints(value: unknown): Partial<Record<BsdCapability, string>> {
  const out: Partial<Record<BsdCapability, string>> = {};
  for (const what of ["injuries", "fixtures", "lineups"] as BsdCapability[]) {
    const path = at(value, what);
    if (typeof path === "string" && path.startsWith("/") && path.length <= 200) out[what] = path;
  }
  return out;
}
