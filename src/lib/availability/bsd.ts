/**
 * Big Balls Sports Data (bigballsdata.com) — the default availability provider.
 *
 * Chosen because API-Football's free plan answers "Free plans do not have
 * access to this season, try from 2022 to 2024" for Serie A 2026/27, while BSD
 * offers a free tier (no card, ~1000 requests/day) that covers the current
 * season. See docs/DECISIONS.md.
 *
 * The dev network blocks bigballsdata.com, so neither the exact paths nor the
 * exact payload shape could be verified from here. Three defences, so that one
 * real run in production is enough to settle it:
 *
 *  1. **self-discovery** — the API answers an unknown path with
 *     "Browse every endpoint at GET /v1/ or the OpenAPI spec at
 *     GET /openapi.json", so the job reads that list and picks the right route
 *     by keyword, with the parameter names the spec itself declares
 *     (src/lib/availability/bsd-discovery.ts);
 *  2. **candidate paths** — a short list of plausible paths per capability,
 *     tried in order, for the case where there is no route list to read;
 *     whatever works — a discovered route or a candidate — is remembered in
 *     `league_settings.availability_endpoints`, so the next run goes straight
 *     to it (one request per capability, zero discovery);
 *  3. **diagnostics** — every attempt (path, status, first 1500 chars of the
 *     body, key redacted), discovery included, is kept in `lastSamples()` and
 *     shown to the admin in Admin → Indisponibili → "Mostra risposta grezza".
 *
 * The parsing is deliberately shape-tolerant: rows may sit at the root or under
 * `data` / `response` / `results` / `items`, and every field is read from a
 * list of plausible names. A row nobody can read is skipped and counted in
 * `unparsed` — never guessed.
 */

import {
  CAPABILITY_KEYWORDS,
  DISCOVERY_PATHS,
  chooseRoute,
  parseRouteIndex,
  type BsdCapability,
  type BsdEndpoints,
  type BsdRoute,
  type DiscoveredRoute,
  type RouteChoice,
} from "@/lib/availability/bsd-discovery";
import {
  MAX_BYTES,
  ProviderError,
  RequestBudget,
  SampleLog,
  TIMEOUT_MS,
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

/**
 * ~1000 requests/day, so a first run can afford to look around: the route list
 * (1-2 calls) plus every candidate of every capability still fits. Once the
 * routes are cached a run costs 2-3 calls.
 */
export const BSD_BUDGET = 16;

export { parseEndpoints } from "@/lib/availability/bsd-discovery";
export type { BsdCapability, BsdEndpoints, BsdRoute } from "@/lib/availability/bsd-discovery";

/** What the admin reads instead of the English capability name. */
export const CAPABILITY_LABEL: Record<BsdCapability, string> = {
  injuries: "indisponibili",
  fixtures: "calendario",
  lineups: "formazioni",
};

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
  /** Routes and paths that worked on a previous run, from `league_settings`. */
  endpoints?: BsdEndpoints;
  /** Skip the route list (tests that only exercise the static candidates). */
  discovery?: boolean;
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
  const templates: Partial<Record<BsdCapability, string>> = { ...opts.endpoints?.templates };
  const routes: Partial<Record<BsdCapability, BsdRoute>> = { ...opts.endpoints?.routes };
  const useDiscovery = opts.discovery !== false;

  let learned = false;
  let rateLimitRemaining: number | null = null;
  let unparsed = 0;

  // what discovery found, for the cache, the notes and the next capability
  let discoveryDone = false;
  let discovered: DiscoveredRoute[] | null = null;
  let discoverySource = "";
  const chosen: Partial<Record<BsdCapability, RouteChoice>> = {};
  const missed = new Set<BsdCapability>();
  const substitutions: string[] = [];
  const discoveryProblems: string[] = [];

  /** One GET, recorded in the diagnostics whatever happens. Null = no good. */
  async function fetchJson(
    what: string,
    url: string,
    tried: string[],
    label: string,
  ): Promise<unknown | null> {
    budget.spend(label);
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
      tried.push(`${label} → rete non raggiungibile`);
      return null;
    }
    const remaining = readRateLimit(res);
    if (remaining !== null) rateLimitRemaining = remaining;

    const text = await safeBody(res);
    samples.add(what, url, res.status, text);
    if (!res.ok) {
      tried.push(`${label} → HTTP ${res.status}`);
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      tried.push(`${label} → HTTP ${res.status} ma risposta non JSON`);
      return null;
    }
  }

  /**
   * Reads the provider's own route list, once per run. The 404 body points at
   * `/openapi.json` and `/v1/`; an unreadable answer is not an error, it just
   * leaves the static candidates to do the work.
   */
  async function ensureDiscovery(tried: string[]): Promise<void> {
    if (discoveryDone || !useDiscovery) return;
    discoveryDone = true;
    for (const path of DISCOVERY_PATHS) {
      const json = await fetchJson("discovery", `${baseUrl}${path}`, tried, path);
      if (json === null) continue;
      const found = parseRouteIndex(json);
      if (found.length === 0) {
        discoveryProblems.push(`${path}: elenco rotte in un formato non riconosciuto`);
        continue;
      }
      discovered = found;
      discoverySource = path;
      return;
    }
    if (!discovered && discoveryProblems.length === 0) {
      discoveryProblems.push("nessun elenco rotte: /openapi.json e /v1/ non hanno risposto");
    }
  }

  /** The discovered route for one capability, chosen once and remembered. */
  function discoveredRoute(what: BsdCapability): BsdRoute | null {
    if (chosen[what]) return chosen[what]!.route;
    if (!discovered || missed.has(what)) return null;
    const choice = chooseRoute(discovered, what, league);
    if (!choice) {
      missed.add(what);
      return null;
    }
    chosen[what] = choice;
    if (choice.leagueSubstituted) {
      substitutions.push(
        `lega non accettata dalla rotta ${choice.route.path}: "${choice.leagueSubstituted.from}" sostituita con "${choice.leagueSubstituted.to}"`,
      );
    }
    return choice.route;
  }

  /** A discovered route turned into a URL: placeholders first, then the query. */
  function routeUrl(route: BsdRoute, vars: { fixture?: string }): string {
    const leagueValue = route.league ?? league;
    const path = route.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const key2 = name.toLowerCase();
      if (/fixture|match|game/.test(key2) || key2 === "id") {
        return encodeURIComponent(vars.fixture ?? "");
      }
      if (/league|competition|tournament|slug/.test(key2)) return encodeURIComponent(leagueValue);
      if (/season|year/.test(key2)) return encodeURIComponent(String(season));
      return "";
    });
    const url = new URL(`${baseUrl}${path}`);
    if (route.params.league) url.searchParams.set(route.params.league, leagueValue);
    if (route.params.season) url.searchParams.set(route.params.season, String(season));
    if (route.params.fixture && vars.fixture) {
      url.searchParams.set(route.params.fixture, vars.fixture);
    }
    if (route.params.status) url.searchParams.set(route.params.status, "upcoming");
    return url.toString();
  }

  /**
   * One capability, in this order: the cached route, the cached candidate, the
   * first candidate, then — only if all that failed — the provider's own route
   * list, then the remaining candidates. A cached route that has started
   * answering 404 is dropped and discovery runs again.
   */
  async function call(what: BsdCapability, vars: Record<string, string>): Promise<unknown> {
    const tried: string[] = [];
    const done = new Set<string>();

    const attemptRoute = async (route: BsdRoute): Promise<unknown | null> => {
      const url = routeUrl(route, { fixture: vars.fixture });
      if (done.has(url)) return null;
      done.add(url);
      const json = await fetchJson(what, url, tried, url.slice(baseUrl.length));
      if (json === null) return null;
      if (routes[what]?.path !== route.path || routes[what]?.league !== route.league) {
        routes[what] = route;
        learned = true;
      }
      return json;
    };

    const attemptTemplate = async (template: string): Promise<unknown | null> => {
      const path = fill(template, vars);
      const url = `${baseUrl}${path}`;
      if (done.has(url)) return null;
      done.add(url);
      const json = await fetchJson(what, url, tried, path);
      if (json === null) return null;
      if (templates[what] !== template) {
        templates[what] = template;
        learned = true;
      }
      return json;
    };

    // 1. what worked last time
    const cached = routes[what];
    if (cached) {
      const json = await attemptRoute(cached);
      if (json !== null) return json;
      // The route has gone: forget it and look at the list again.
      delete routes[what];
      learned = true;
    }
    const cachedTemplate = templates[what];
    if (cachedTemplate) {
      const json = await attemptTemplate(cachedTemplate);
      if (json !== null) return json;
      delete templates[what];
      learned = true;
    }

    // 2. the first guess, then the provider's own list, then the other guesses
    const candidates = BSD_CANDIDATES[what];
    for (const [index, template] of candidates.entries()) {
      const json = await attemptTemplate(template);
      if (json !== null) return json;
      if (index > 0) continue;
      await ensureDiscovery(tried);
      const route = discoveredRoute(what);
      if (route) {
        const found = await attemptRoute(route);
        if (found !== null) return found;
        // The list named a route that does not answer: do not cache it.
        delete chosen[what];
        missed.add(what);
      }
    }

    throw new ProviderError(
      `${what}: endpoint non trovato (${tried.join(" · ") || "nessun tentativo"})`,
    );
  }

  /**
   * The lines the admin reads under the feed card: what the route list gave,
   * what was chosen, and — when a capability found nothing — which words were
   * looked for, so the admin can paste the route list back to us.
   */
  function summary(): string[] {
    const out: string[] = [];
    if (discovered) {
      const picked = Object.values(chosen as Record<string, RouteChoice>).map(
        (choice) =>
          `${choice.route.path}${choice.paramNames.length > 0 ? ` (${choice.paramNames.join(", ")})` : ""}`,
      );
      out.push(
        `rotte trovate: ${discovered.length}${discoverySource ? ` da ${discoverySource}` : ""}` +
          (picked.length > 0 ? ` · scelte: ${picked.join(", ")}` : " · nessuna scelta"),
      );
    }
    for (const what of missed) {
      const { primary, fallback } = CAPABILITY_KEYWORDS[what];
      out.push(
        `nessuna rotta per ${CAPABILITY_LABEL[what]}: cercate ${[...primary, ...fallback].join(", ")}`,
      );
    }
    out.push(...substitutions, ...discoveryProblems);
    return out;
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
    get notes() {
      return summary();
    },
    /**
     * What to cache for the next run: the legacy per-capability templates
     * (kept so an older deployment still reads them) plus the routes.
     */
    resolvedEndpoints: () => (learned ? { ...templates, routes: { ...routes } } : null),

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
