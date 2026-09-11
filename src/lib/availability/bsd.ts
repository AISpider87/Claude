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
  conceptOf,
  errorMessageOf,
  parseRouteIndex,
  pickSerieA,
  requiredParams,
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
  pickDate,
  pickString,
  readCapped,
  readRateLimit,
  redactSecrets,
  rowKeys,
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
/** `BSD_SPORT`, and the other spelling to try when the API refuses it. */
export const BSD_DEFAULT_SPORT = "soccer";
export const BSD_FALLBACK_SPORT = "football";

/**
 * ~1000 requests/day, so a first run can afford to look around: the route list
 * (1-2 calls), every candidate of every capability, and the corrections a 400
 * asks for, all still fit. Once the routes are cached a run costs 2-3 calls.
 */
export const BSD_BUDGET = 24;

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
    // The live route list has /v1/injuries, and it answers HTTP 400
    // "sport or league query param is required" when called bare.
    "/v1/injuries?sport={sport}&league={league}",
    "/v1/injuries?league={league}",
    "/v1/football/injuries?league={league}",
    "/football/injuries?league={league}",
    "/v1/soccer/injuries?league={league}",
    "/injuries?league={league}",
  ],
  fixtures: [
    // /v1/matches?league=…&status=… answered 200 with 50 rows.
    "/v1/matches?league={league}&status=upcoming",
    "/v1/matches?sport={sport}&league={league}",
    "/v1/football/fixtures?league={league}&status=upcoming",
    "/football/fixtures?league={league}",
    "/v1/soccer/fixtures?league={league}",
  ],
  lineups: [
    // There is no /v1/matches/{id}/lineups: the line-ups live under
    // stored_matches, and the live players under live-stats.
    "/v1/stored_matches/{fixture}/lineups",
    "/v1/live-stats/{sport}/{fixture}/players",
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
// Every lookup ignores case, underscores and dashes (`home_team` finds
// `homeTeam`), so these lists are about *which* words, not how they are spelt.
const PLAYER_NAME = [
  "player",
  "player_name",
  "athlete",
  "name",
  "full_name",
  "display_name",
  "player.name",
  "athlete.name",
];
const PLAYER_ID = ["player.id", "player_id", "athlete.id", "athlete_id", "id"];
const TEAM_NAME = ["team", "team_name", "club", "squad", "team.name", "club.name"];
const TEAM_ID = ["team.id", "team_id", "club.id", "club_id"];
const STATUS_TEXT = [
  "status",
  "type",
  "injury_status",
  "availability",
  "designation",
  "reason",
  "description",
  "detail",
  "note",
  "comment",
  "injury",
];
const RETURN_DATE = ["expected_return", "return_date", "until", "eta", "expected_return_date"];
const FIXTURE_ID = [
  "id",
  "match_id",
  "fixture_id",
  "game_id",
  "event_id",
  "uuid",
  "match.id",
  "fixture.id",
];
const KICKOFF = [
  "start_time",
  "commence_time",
  "scheduled",
  "scheduled_at",
  "kickoff",
  "kickoff_time",
  "date",
  "datetime",
  "utc_date",
  "start",
  "starts_at",
  "fixture.date",
  "match.start_time",
];
const FIXTURE_STATUS = [
  "status",
  "state",
  "match_status",
  "status.short",
  "status.long",
  "status.type",
  "status.name",
];
const HOME = [
  "home_team",
  "home",
  "teams.home",
  "competitors.0",
  "home_team.name",
  "teams.home.name",
];
const AWAY = [
  "away_team",
  "away",
  "teams.away",
  "competitors.1",
  "away_team.name",
  "teams.away.name",
];
const STARTERS = ["startXI", "starting_xi", "starters", "starting_lineup", "lineup", "starting"];
const BENCH = ["substitutes", "subs", "bench", "substitutions"];
const STARTER_FLAG = ["is_starter", "starter", "starting", "start", "lineup", "startXI"];

export interface BsdOptions {
  baseUrl?: string;
  league?: string;
  sport?: string;
  season?: number;
  budget?: RequestBudget;
  fetchImpl?: typeof fetch;
  /** Routes and paths that worked on a previous run, from `league_settings`. */
  endpoints?: BsdEndpoints;
  /** Skip the route list (tests that only exercise the static candidates). */
  discovery?: boolean;
}

/** Our four concepts, whatever the API decides to call them. */
type Concept = "sport" | "league" | "season" | "fixture" | "status";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(vars[key] ?? `{${key}}`),
  );
}

/** The path of a URL we built, for the cache and the error list. */
function pathOf(url: string, baseUrl: string): string {
  return url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;
}

/**
 * Big Balls Sports Data. The key travels in both `Authorization: Bearer …` and
 * `x-api-key` (which of the two the API wants is unverified; sending both is
 * harmless) and never in a URL, a log line, an error or a sample.
 */
export function bsdProvider(key: string, opts: BsdOptions = {}) {
  const baseUrl = (opts.baseUrl ?? BSD_BASE_URL).replace(/\/+$/, "");
  const season = opts.season ?? currentSeason();
  const budget = opts.budget ?? new RequestBudget(BSD_BUDGET);
  const doFetch = opts.fetchImpl ?? fetch;
  const samples = new SampleLog([key]);
  const templates: Partial<Record<BsdCapability, string>> = { ...opts.endpoints?.templates };
  const routes: Partial<Record<BsdCapability, BsdRoute>> = { ...opts.endpoints?.routes };
  const useDiscovery = opts.discovery !== false;

  // What the API accepted last time wins over what is configured: the admin
  // cannot know the provider's own spelling of "Serie A" or of "soccer".
  let leagueValue = opts.endpoints?.league ?? opts.league ?? BSD_DEFAULT_LEAGUE;
  let sportValue = opts.endpoints?.sport ?? opts.sport ?? BSD_DEFAULT_SPORT;
  const configuredLeague = opts.league ?? BSD_DEFAULT_LEAGUE;
  const configuredSport = opts.sport ?? BSD_DEFAULT_SPORT;

  let learned = false;
  let rateLimitRemaining: number | null = null;
  let unparsed = 0;

  // what discovery found, for the cache, the notes and the next capability
  let discoveryDone = false;
  let discovered: DiscoveredRoute[] | null = null;
  let discoverySource = "";
  let leaguesAsked = false;
  const chosen: Partial<Record<BsdCapability, RouteChoice>> = {};
  const missed = new Set<BsdCapability>();
  const substitutions: string[] = [];
  const discoveryProblems: string[] = [];
  const shapeNotes: string[] = [];

  function valueOf(concept: Concept, fixture?: string): string | null {
    switch (concept) {
      case "sport":
        return sportValue;
      case "league":
        return leagueValue;
      case "season":
        return String(season);
      case "fixture":
        return fixture ?? null;
      case "status":
        return "upcoming";
    }
  }

  interface Answer {
    status: number;
    text: string;
    json: unknown | null;
  }

  /** One GET, recorded in the diagnostics whatever happens. */
  async function fetchOnce(what: string, url: string, tried: string[]): Promise<Answer | null> {
    budget.spend(pathOf(url, baseUrl));
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
      tried.push(`${pathOf(url, baseUrl)} → rete non raggiungibile`);
      return null;
    }
    const remaining = readRateLimit(res);
    if (remaining !== null) rateLimitRemaining = remaining;

    const text = await safeBody(res);
    samples.add(what, url, res.status, text);
    if (!res.ok) {
      const detail = res.status === 400 ? `: ${errorMessageOf(text).slice(0, 120)}` : "";
      tried.push(`${pathOf(url, baseUrl)} → HTTP ${res.status}${detail}`);
      return { status: res.status, text, json: null };
    }
    try {
      return { status: res.status, text, json: JSON.parse(text) as unknown };
    } catch {
      tried.push(`${pathOf(url, baseUrl)} → HTTP ${res.status} ma risposta non JSON`);
      return { status: res.status, text, json: null };
    }
  }

  /**
   * `/v1/leagues?sport=…`, once per run: the API's own list, to find out what
   * it calls Serie A when the configured value is refused.
   */
  async function ensureLeagueId(tried: string[]): Promise<boolean> {
    if (leaguesAsked) return false;
    leaguesAsked = true;
    const url = `${baseUrl}/v1/leagues?sport=${encodeURIComponent(sportValue)}`;
    const answer = await fetchOnce("leagues", url, tried);
    if (!answer?.json) return false;
    const match = pickSerieA(rowsOf(answer.json));
    if (!match || match.id === leagueValue) return false;
    substitutions.push(
      `lega non accettata: "${leagueValue}" sostituita con "${match.id}" (${match.label}, da /v1/leagues)`,
    );
    leagueValue = match.id;
    learned = true;
    return true;
  }

  interface Attempt {
    /** The path, with its own query string, before anything is added. */
    base: string;
    /** Extra parameters, by the API's own name. */
    extra: Record<string, string>;
    /** Which of our concepts each of those names carries. */
    concepts: Partial<Record<Concept, string>>;
    fixture?: string;
  }

  function attemptUrl(attempt: Attempt): string {
    const url = new URL(`${baseUrl}${attempt.base}`);
    for (const [name, value] of Object.entries(attempt.extra)) url.searchParams.set(name, value);
    return url.toString();
  }

  /** Adds the parameters an HTTP 400 asked for. True when anything changed. */
  function addRequired(attempt: Attempt, names: string[]): boolean {
    let changed = false;
    for (const name of names) {
      if (attempt.extra[name] !== undefined) continue;
      const concept = conceptOf(name);
      if (!concept) continue;
      const value = valueOf(concept as Concept, attempt.fixture);
      if (value === null) continue;
      attempt.extra[name] = value;
      attempt.concepts[concept as Concept] = name;
      changed = true;
    }
    return changed;
  }

  /** Re-sends every parameter we already send, with today's values. */
  function refreshValues(attempt: Attempt) {
    for (const [concept, name] of Object.entries(attempt.concepts) as [Concept, string][]) {
      const value = valueOf(concept, attempt.fixture);
      if (value !== null) attempt.extra[name] = value;
    }
  }

  /**
   * One route, with up to three corrections: the parameters a 400 says are
   * missing, the league id from `/v1/leagues`, and the other spelling of the
   * sport. Every correction costs one request and is remembered.
   */
  async function send(
    what: BsdCapability,
    attempt: Attempt,
    tried: string[],
  ): Promise<{ json: unknown; attempt: Attempt; corrected: boolean } | null> {
    let retried400 = false;
    let retriedLeague = false;
    let retriedSport = false;
    const corrected = () => retried400 || retriedLeague || retriedSport;
    let empty: { json: unknown; attempt: Attempt; corrected: boolean } | null = null;

    for (let step = 0; step < 4; step += 1) {
      const answer = await fetchOnce(what, attemptUrl(attempt), tried);
      if (!answer) return empty;

      if (answer.status === 400 && answer.json === null) {
        const names = requiredParams(answer.text);
        if (!retried400 && addRequired(attempt, names)) {
          retried400 = true;
          continue;
        }
        if (!retriedLeague && (await ensureLeagueId(tried))) {
          retriedLeague = true;
          refreshValues(attempt);
          continue;
        }
        if (!retriedSport && sportValue !== BSD_FALLBACK_SPORT) {
          retriedSport = true;
          sportValue = BSD_FALLBACK_SPORT;
          learned = true;
          refreshValues(attempt);
          continue;
        }
        return empty;
      }
      if (answer.json === null) return empty;

      // A 200 with no rows may just be a quiet day — or the wrong league or
      // the wrong sport. One correction each, then we take what we got.
      if (rowsOf(answer.json).length === 0) {
        empty ??= { json: answer.json, attempt, corrected: corrected() };
        if (!retriedSport && attempt.concepts.sport && sportValue !== BSD_FALLBACK_SPORT) {
          retriedSport = true;
          sportValue = BSD_FALLBACK_SPORT;
          learned = true;
          refreshValues(attempt);
          continue;
        }
        if (!retriedLeague && attempt.concepts.league && (await ensureLeagueId(tried))) {
          retriedLeague = true;
          refreshValues(attempt);
          continue;
        }
        return empty;
      }
      return { json: answer.json, attempt, corrected: corrected() };
    }
    return empty;
  }

  /** Known path first (it should answer), then the remaining candidates. */
  function templatesFor(what: BsdCapability): string[] {
    const known = templates[what];
    const rest = BSD_CANDIDATES[what].filter((t) => t !== known);
    return known ? [known, ...rest] : rest;
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
      const answer = await fetchOnce("discovery", `${baseUrl}${path}`, tried);
      if (!answer?.json) continue;
      const found = parseRouteIndex(answer.json);
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
    const choice = chooseRoute(discovered, what, leagueValue);
    if (!choice) {
      missed.add(what);
      return null;
    }
    chosen[what] = choice;
    if (choice.leagueSubstituted) {
      leagueValue = choice.leagueSubstituted.to;
      substitutions.push(
        `lega non accettata dalla rotta ${choice.route.path}: "${choice.leagueSubstituted.from}" sostituita con "${choice.leagueSubstituted.to}"`,
      );
    }
    return choice.route;
  }

  /** A route (discovered or cached) turned into an attempt. */
  function routeAttempt(route: BsdRoute, fixture?: string): Attempt {
    const path = route.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const key2 = name.toLowerCase();
      if (/sport/.test(key2)) return encodeURIComponent(sportValue);
      if (/fixture|match|game|event/.test(key2) || key2 === "id") {
        return encodeURIComponent(fixture ?? "");
      }
      if (/league|competition|tournament|slug/.test(key2)) return encodeURIComponent(leagueValue);
      if (/season|year/.test(key2)) return encodeURIComponent(String(season));
      return "";
    });
    const attempt: Attempt = { base: path, extra: {}, concepts: {}, fixture };
    for (const concept of ["sport", "league", "season", "fixture", "status"] as Concept[]) {
      const name = route.params[concept];
      if (!name) continue;
      const value = valueOf(concept, fixture);
      if (value === null) continue;
      attempt.extra[name] = value;
      attempt.concepts[concept] = name;
    }
    return attempt;
  }

  /** A static candidate turned into an attempt (its query is already written). */
  function templateAttempt(template: string, vars: Record<string, string>): Attempt {
    const path = fill(template, { ...vars, sport: sportValue, league: leagueValue });
    const concepts: Partial<Record<Concept, string>> = {};
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    for (const pair of query.split("&").filter(Boolean)) {
      const name = pair.split("=")[0]!;
      const concept = conceptOf(name);
      if (concept) concepts[concept as Concept] = name;
    }
    return { base: path, extra: {}, concepts, fixture: vars.fixture };
  }

  /** What to store so the next run goes straight to what worked. */
  function remember(what: BsdCapability, attempt: Attempt) {
    const path = attempt.base.split("?")[0]!;
    const params: Record<string, string> = {};
    for (const [concept, name] of Object.entries(attempt.concepts)) params[concept] = name;
    const previous = routes[what];
    const route: BsdRoute = { path, params };
    if (leagueValue !== configuredLeague) route.league = leagueValue;
    if (
      previous?.path !== route.path ||
      JSON.stringify(previous?.params) !== JSON.stringify(params)
    ) {
      routes[what] = route;
      learned = true;
    }
  }

  /**
   * One capability, in this order: the cached route, the cached candidate, the
   * first candidate, then — only if all that failed — the provider's own route
   * list, then the remaining candidates. A cached route that has stopped
   * answering is dropped and discovery runs again.
   */
  async function call(what: BsdCapability, vars: Record<string, string>): Promise<unknown> {
    const tried: string[] = [];
    const done = new Set<string>();

    const run = async (attempt: Attempt, fromRoute: boolean): Promise<unknown | null> => {
      const first = attemptUrl(attempt);
      if (done.has(first)) return null;
      done.add(first);
      const result = await send(what, attempt, tried);
      if (!result) return null;
      // A plain candidate that worked first time is remembered as a template;
      // a route, or a call the API had to correct, is remembered as a route.
      if (fromRoute || result.corrected) remember(what, result.attempt);
      return result.json;
    };

    // 1. what worked last time
    const cached = routes[what];
    if (cached) {
      const json = await run(routeAttempt(cached, vars.fixture), true);
      if (json !== null) return json;
      // The route has gone: forget it and look at the list again.
      delete routes[what];
      learned = true;
    }
    const cachedTemplate = templates[what];
    if (cachedTemplate) {
      const json = await run(templateAttempt(cachedTemplate, vars), false);
      if (json !== null) {
        templates[what] = cachedTemplate;
        return json;
      }
      delete templates[what];
      learned = true;
    }

    // 2. the first guess, then the provider's own list, then the other guesses
    const candidates = templatesFor(what);
    for (const [index, template] of candidates.entries()) {
      const json = await run(templateAttempt(template, vars), false);
      if (json !== null) {
        if (templates[what] !== template) {
          templates[what] = template;
          learned = true;
        }
        return json;
      }
      if (index > 0) continue;
      await ensureDiscovery(tried);
      const route = discoveredRoute(what);
      if (route) {
        const found = await run(routeAttempt(route, vars.fixture), true);
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
   * Rows arrived and none of them could be read: the field names are wrong, and
   * the keys of the first row are exactly what says so — in one line, in the
   * admin panel, without a second round trip.
   */
  function reportShape(what: BsdCapability, rows: unknown[], usable: number) {
    if (rows.length === 0 || usable > 0) return;
    const keys = rowKeys(rows[0]);
    shapeNotes.push(
      `${CAPABILITY_LABEL[what]}: ${rows.length} righe ricevute, nessuna leggibile · chiavi della prima riga: ${
        keys.length > 0 ? redactSecrets(keys.join(", ")) : "(nessuna: la riga non è un oggetto)"
      }`,
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
    // With a capability unmatched, the admin needs the whole list to send back.
    if (discovered && missed.size > 0) {
      const paths = [...new Set(discovered.map((r) => r.path))].sort();
      out.push(`elenco rotte: ${paths.join(" · ")}`);
    }
    out.push(...substitutions, ...shapeNotes, ...discoveryProblems);
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
    resolvedEndpoints: () =>
      learned
        ? {
            ...templates,
            routes: { ...routes },
            // Only what the API taught us: a value equal to the configured one
            // would just freeze today's environment into the database.
            ...(leagueValue !== configuredLeague ? { league: leagueValue } : {}),
            ...(sportValue !== configuredSport ? { sport: sportValue } : {}),
          }
        : null,

    async injuries(): Promise<ProviderInjury[]> {
      const json = await call("injuries", { season: String(season) });
      const out: ProviderInjury[] = [];
      const rows = rowsOf(json);
      for (const row of rows) {
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
      reportShape("injuries", rows, out.length);
      return out;
    },

    async fixtures(next: number): Promise<ProviderFixture[]> {
      const json = await call("fixtures", { season: String(season) });
      const out: ProviderFixture[] = [];
      const rows = rowsOf(json);
      for (const row of rows) {
        const id = pickInt(row, FIXTURE_ID);
        const kickoff = pickDate(row, KICKOFF);
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
      reportShape("fixtures", rows, out.length);
      // `next` is honoured client-side: a candidate path may ignore the filter.
      return out
        .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
        .slice(0, Math.max(1, next));
    },

    async lineups(fixtureId: number): Promise<ProviderLineupEntry[]> {
      const json = await call("lineups", { fixture: String(fixtureId) });
      const out: ProviderLineupEntry[] = [];
      const rows = rowsOf(json);
      for (const row of rows) {
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
      reportShape("lineups", rows, out.length);
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

/** The sport as configured: `soccer` by default, `football` as the fallback. */
export function bsdSport(env: Record<string, string | undefined> = process.env): string {
  const value = env.BSD_SPORT?.trim();
  return value && value.length > 0 ? value : BSD_DEFAULT_SPORT;
}

/** Exported for the tests: the league as configured (slug or numeric id). */
export function bsdLeague(env: Record<string, string | undefined> = process.env): string {
  const value = env.BSD_LEAGUE?.trim();
  return value && value.length > 0 ? value : BSD_DEFAULT_LEAGUE;
}
