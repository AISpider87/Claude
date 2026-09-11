/**
 * Self-discovery of the Big Balls Sports Data routes.
 *
 * In production the API answers an unknown path with, verbatim:
 *
 *   {"error":{"code":"route_not_found","message":"No route: GET /v1/football/injuries?league=serie-a."},
 *    "suggested_fix":"No such route. Browse every endpoint at GET /v1/ or the OpenAPI spec at GET /openapi.json."}
 *
 * So the provider itself says where its route list is. Instead of guessing
 * paths for ever, the job reads `GET /openapi.json` (or `GET /v1/`), turns it
 * into a flat list of GET routes with their declared parameters, and picks one
 * per capability by keyword. What it finds is cached in
 * `league_settings.availability_endpoints`, so discovery costs one request the
 * first time and none afterwards.
 *
 * Everything here is pure: no network, no environment — which is also how it
 * is tested (tests/fixtures/bsd-openapi.json), since bigballsdata.com is not
 * reachable from the dev network.
 */

export type BsdCapability = "injuries" | "fixtures" | "lineups";

/** One parameter as the spec declares it. */
export interface DiscoveredParam {
  name: string;
  /** "query" | "path" | … — absent when the document does not say. */
  location: string;
  /** The allowed values, when the spec lists them (league slugs, typically). */
  values: string[];
}

/** One GET route as discovered, whatever document it came from. */
export interface DiscoveredRoute {
  path: string;
  methods: string[];
  params: DiscoveredParam[];
}

/** Our concepts mapped onto the names this route actually declares. */
export interface BsdRouteParams {
  sport?: string;
  league?: string;
  season?: string;
  fixture?: string;
  status?: string;
}

/** A route chosen for one capability, ready to be called and cached. */
export interface BsdRoute {
  path: string;
  params: BsdRouteParams;
  /**
   * The league value to send when the spec's enum does not contain the
   * configured one (e.g. `BSD_LEAGUE=serie-a` but the API wants `it-serie-a`).
   */
  league?: string;
}

/** What the cache holds, old shape (a candidate template) and new (a route). */
export interface BsdEndpoints {
  /** Legacy: the static candidate that worked, per capability. */
  templates: Partial<Record<BsdCapability, string>>;
  routes: Partial<Record<BsdCapability, BsdRoute>>;
  /** The league id/slug the API accepted (from `/v1/leagues` when needed). */
  league?: string;
  /** The sport value the API accepted: `soccer` or `football`. */
  sport?: string;
}

/** Where the provider says its route list is, in the order we try them. */
export const DISCOVERY_PATHS = ["/openapi.json", "/v1/"];

/** The words we look for in a path, per capability, best first. */
export const CAPABILITY_KEYWORDS: Record<BsdCapability, { primary: string[]; fallback: string[] }> =
  {
    injuries: {
      primary: ["injur"],
      // BSD names things its own way: the live index has no "injuries" route,
      // so we also look for availability/status wordings before giving up.
      fallback: [
        "unavailab",
        "sideline",
        "absence",
        "absent",
        "availability",
        "player-status",
        "player_status",
        "playerstatus",
        "suspension",
        "suspended",
        "missing",
        "doubtful",
      ],
    },
    fixtures: {
      primary: ["fixture", "match", "schedule"],
      fallback: ["game", "calendar"],
    },
    lineups: {
      primary: ["lineup", "line-up", "line_up", "formation"],
      fallback: ["squad", "starting", "eleven", "roster", "team-sheet", "teamsheet"],
    },
  };

/**
 * The routes the live API really has (route list of 2026-09-11, 125 routes):
 * a path that matches one of these is the right one for that capability, even
 * when its name does not contain the obvious word — `/v1/live-stats/{sport}/{matchId}/players`
 * is where the line-ups of a running match are.
 */
export const PREFERRED_ROUTES: Record<BsdCapability, RegExp[]> = {
  injuries: [/^\/v\d+\/injuries$/],
  fixtures: [/^\/v\d+\/matches$/],
  lineups: [
    /^\/v\d+\/stored_matches\/\{[^}]+\}\/lineups$/,
    /^\/v\d+\/live-stats\/\{[^}]+\}\/\{[^}]+\}\/players$/,
  ],
};

/** The parameter names we accept for each of our concepts, best first. */
export const PARAM_ALIASES = {
  sport: ["sport", "sport_id", "sportId", "sport_key", "sportKey"],
  league: [
    "league",
    "league_id",
    "leagueId",
    "competition",
    "competition_id",
    "tournament",
    "slug",
  ],
  season: ["season", "season_id", "seasonId", "year"],
  fixture: ["fixture", "fixture_id", "fixtureId", "match", "match_id", "matchId", "game_id"],
  status: ["status", "state"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => (typeof v === "string" || typeof v === "number" ? [String(v)] : []));
}

/** The enum of a parameter, wherever the document keeps it. */
function paramValues(param: Record<string, unknown>): string[] {
  const direct = asStrings(param.enum);
  if (direct.length > 0) return direct;
  const schema = param.schema;
  if (isRecord(schema)) {
    const fromSchema = asStrings(schema.enum);
    if (fromSchema.length > 0) return fromSchema;
    const items = schema.items;
    if (isRecord(items)) return asStrings(items.enum);
  }
  return [];
}

function readParams(value: unknown): DiscoveredParam[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [{ name: entry, location: "query", values: [] }];
    if (!isRecord(entry)) return [];
    const name = entry.name ?? entry.param ?? entry.key;
    if (typeof name !== "string" || !name.trim()) return [];
    const location = typeof entry.in === "string" ? entry.in : "query";
    return [{ name: name.trim(), location, values: paramValues(entry) }];
  });
}

/** `"GET /v1/x"` and `"/v1/x"` both happen in a hand-written index. */
function splitMethodAndPath(text: string): { path: string; methods: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^([A-Za-z]+)\s+(\/\S*)$/.exec(trimmed);
  if (match) return { path: match[2]!, methods: [match[1]!.toUpperCase()] };
  if (trimmed.startsWith("/")) return { path: trimmed.split(/\s/)[0]!, methods: ["GET"] };
  return null;
}

function readEntry(entry: unknown): DiscoveredRoute | null {
  if (typeof entry === "string") {
    const split = splitMethodAndPath(entry);
    return split ? { ...split, params: [] } : null;
  }
  if (!isRecord(entry)) return null;
  const rawPath = entry.path ?? entry.route ?? entry.url ?? entry.endpoint ?? entry.href;
  if (typeof rawPath !== "string" || !rawPath.trim()) return null;
  const split = splitMethodAndPath(rawPath);
  if (!split) return null;
  const declared = [
    ...asStrings(entry.methods),
    typeof entry.method === "string" ? entry.method : "",
  ]
    .filter(Boolean)
    .map((m) => m.toUpperCase());
  return {
    path: split.path,
    methods: declared.length > 0 ? declared : split.methods,
    params: readParams(entry.params ?? entry.parameters ?? entry.query),
  };
}

/**
 * A flat list of routes out of whatever the provider answered: an OpenAPI
 * document (`paths`), an array of strings or objects, `{routes:[…]}`,
 * `{endpoints:[…]}`, or an object keyed by path. An unreadable document gives
 * an empty list, and the caller falls back to the static candidates.
 */
export function parseRouteIndex(payload: unknown): DiscoveredRoute[] {
  const out = new Map<string, DiscoveredRoute>();
  const push = (route: DiscoveredRoute | null) => {
    if (!route || !route.path.startsWith("/") || route.path.length > 300) return;
    const existing = out.get(route.path);
    if (!existing) {
      out.set(route.path, route);
      return;
    }
    // Same path seen twice: keep the richer description.
    if (route.params.length > existing.params.length) out.set(route.path, route);
  };

  // 1. OpenAPI: {"paths": {"/v1/x": {"get": {"parameters": [...]}}}}
  if (isRecord(payload) && isRecord(payload.paths)) {
    for (const [path, item] of Object.entries(payload.paths)) {
      if (!isRecord(item)) continue;
      const shared = readParams(item.parameters);
      const methods = Object.keys(item)
        .filter((k) => ["get", "post", "put", "patch", "delete", "head"].includes(k.toLowerCase()))
        .map((k) => k.toUpperCase());
      const get = item.get;
      const params = isRecord(get) ? [...shared, ...readParams(get.parameters)] : shared;
      push({ path, methods: methods.length > 0 ? methods : ["GET"], params });
    }
    if (out.size > 0) return [...out.values()];
  }

  // 2. A bare list, or one under a key.
  const lists: unknown[] = [];
  if (Array.isArray(payload)) lists.push(payload);
  if (isRecord(payload)) {
    for (const key of ["routes", "endpoints", "paths", "data", "items", "results"]) {
      const value = payload[key];
      if (Array.isArray(value)) lists.push(value);
    }
  }
  for (const list of lists) {
    for (const entry of list as unknown[]) push(readEntry(entry));
  }
  if (out.size > 0) return [...out.values()];

  // 3. An object keyed by path: {"/v1/x": {...}} or {"/v1/x": "description"}.
  if (isRecord(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (!key.startsWith("/")) continue;
      const params = isRecord(value)
        ? readParams(value.params ?? value.parameters ?? value.query)
        : [];
      const methods = isRecord(value) ? asStrings(value.methods).map((m) => m.toUpperCase()) : [];
      push({ path: key, methods: methods.length > 0 ? methods : ["GET"], params });
    }
  }
  return [...out.values()];
}

/** Nothing but letters and digits, lowercased: `Serie A` and `it_serie-a` meet. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findParam(route: DiscoveredRoute, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const found = route.params.find(
      (p) => p.location !== "path" && squash(p.name) === squash(alias),
    );
    if (found) return found.name;
  }
  return undefined;
}

/** The `{placeholder}` of a path that stands for our concept, if any. */
function findPlaceholder(path: string, test: RegExp): string | null {
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    if (test.test(match[1]!)) return match[1]!;
  }
  return null;
}

const LEAGUE_WORDS = /league|competition|tournament|slug|country/i;
const FIXTURE_WORDS = /fixture|match|game|^id$|_id$/i;

/**
 * How well a discovered route fits a capability. Null = not a candidate at all.
 * The scale is arbitrary; only the order matters.
 */
export function scoreRoute(route: DiscoveredRoute, what: BsdCapability): number | null {
  if (route.methods.length > 0 && !route.methods.includes("GET")) return null;
  const path = route.path.toLowerCase();
  // A route we have seen in the live list beats anything the keywords find.
  const preferred = PREFERRED_ROUTES[what].findIndex((re) => re.test(route.path));
  const { primary, fallback } = CAPABILITY_KEYWORDS[what];
  let score: number;
  if (preferred >= 0) score = 400 - 50 * preferred;
  else if (primary.some((word) => path.includes(word))) score = 100;
  else if (fallback.some((word) => path.includes(word))) score = 60;
  else return null;

  if (/football|soccer/.test(path)) score += 20;
  if (findParam(route, PARAM_ALIASES.league) || LEAGUE_WORDS.test(path)) score += 10;

  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  if (what === "lineups") {
    // A lineups route must be able to name the fixture, one way or another.
    const byPath = placeholders.some((p) => FIXTURE_WORDS.test(p));
    const byQuery = findParam(route, PARAM_ALIASES.fixture);
    if (!byPath && !byQuery) return null;
    if (byPath) score += 10;
  } else if (preferred < 0 && placeholders.length > 0) {
    // A template we would have to fill blind is worse than a plain path.
    score -= 15 * placeholders.length;
  }
  if (what === "fixtures" && /upcoming|next|schedule/.test(path)) score += 15;
  // Between two equals, the shorter path is the more general one.
  score -= Math.min(10, Math.floor(path.length / 20));
  return score;
}

export interface RouteChoice {
  route: BsdRoute;
  /** Only for the admin's line in the panel: which parameters we recognised. */
  paramNames: string[];
  /** Set when the spec's league enum forced another value than the configured one. */
  leagueSubstituted?: { from: string; to: string };
}

/**
 * The best route for one capability, with our parameters mapped onto the names
 * it declares. `league` is the configured value; when the spec lists the
 * allowed leagues and ours is not among them, the Serie A entry of that list is
 * used instead and the substitution is reported.
 */
export function chooseRoute(
  routes: DiscoveredRoute[],
  what: BsdCapability,
  league: string,
): RouteChoice | null {
  let best: { route: DiscoveredRoute; score: number } | null = null;
  for (const route of routes) {
    const score = scoreRoute(route, what);
    if (score === null) continue;
    if (!best || score > best.score) best = { route, score };
  }
  if (!best) return null;

  const route = best.route;
  const params: BsdRouteParams = {};
  const sportParam = findParam(route, PARAM_ALIASES.sport);
  if (sportParam) params.sport = sportParam;
  const leagueParam = findParam(route, PARAM_ALIASES.league);
  if (leagueParam) params.league = leagueParam;
  const seasonParam = findParam(route, PARAM_ALIASES.season);
  if (seasonParam) params.season = seasonParam;
  if (what === "lineups") {
    const fixtureParam = findParam(route, PARAM_ALIASES.fixture);
    if (fixtureParam && !findPlaceholder(route.path, FIXTURE_WORDS)) params.fixture = fixtureParam;
  }
  if (what === "fixtures") {
    const statusParam = findParam(route, PARAM_ALIASES.status);
    if (statusParam) params.status = statusParam;
  }

  const choice: RouteChoice = {
    route: { path: route.path, params },
    paramNames: Object.values(params),
  };

  // The spec lists the leagues it accepts and ours is not one of them.
  const declared = leagueParam
    ? (route.params.find((p) => p.name === leagueParam)?.values ?? [])
    : [];
  if (declared.length > 0 && !declared.some((v) => squash(v) === squash(league))) {
    const serieA = declared.find((v) => {
      const s = squash(v);
      return s.includes("serie") && s.includes("a");
    });
    if (serieA) {
      choice.route.league = serieA;
      choice.leagueSubstituted = { from: league, to: serieA };
    }
  }
  return choice;
}

/** The stored cache, tolerant of the old shape (flat `capability: template`). */
export function parseEndpoints(value: unknown): BsdEndpoints {
  const out: BsdEndpoints = { templates: {}, routes: {} };
  if (!isRecord(value)) return out;
  for (const what of ["injuries", "fixtures", "lineups"] as BsdCapability[]) {
    const legacy = value[what];
    if (typeof legacy === "string" && legacy.startsWith("/") && legacy.length <= 300) {
      out.templates[what] = legacy;
    }
  }
  for (const key of ["league", "sport"] as const) {
    const stored = value[key];
    if (typeof stored === "string" && stored.trim() && stored.length <= 60) {
      out[key] = stored.trim();
    }
  }
  const routes = value.routes;
  if (isRecord(routes)) {
    for (const what of ["injuries", "fixtures", "lineups"] as BsdCapability[]) {
      const entry = routes[what];
      if (!isRecord(entry)) continue;
      const path = entry.path;
      if (typeof path !== "string" || !path.startsWith("/") || path.length > 300) continue;
      const params: BsdRouteParams = {};
      if (isRecord(entry.params)) {
        for (const concept of ["sport", "league", "season", "fixture", "status"] as const) {
          const name = entry.params[concept];
          if (typeof name === "string" && name.trim() && name.length <= 60) {
            params[concept] = name.trim();
          }
        }
      }
      const route: BsdRoute = { path, params };
      if (typeof entry.league === "string" && entry.league.trim())
        route.league = entry.league.trim();
      out.routes[what] = route;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// what the API says when a call is missing something
// ---------------------------------------------------------------------------
/** The human message inside an error body, whatever it wraps it in. */
export function errorMessageOf(body: string): string {
  try {
    const json: unknown = JSON.parse(body);
    if (typeof json === "string") return json;
    if (isRecord(json)) {
      const error = json.error;
      const fromError = isRecord(error)
        ? (error.message ?? error.detail ?? error.description)
        : error;
      for (const value of [fromError, json.message, json.detail, json.description]) {
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  } catch {
    // not JSON: the raw body is the message
  }
  return body;
}

const REQUIRED_PATTERNS = [
  // "sport or league query param is required"
  /([\w .,'"`\-]*?)\s(?:query\s|url\s)?param(?:eter)?s?\s(?:is|are)\srequired/i,
  // "Missing required parameter: sport", "required: sport, league"
  /(?:missing|required)[^:]{0,40}:\s*([\w ,'"`\-]+)/i,
];

/**
 * The parameter names an HTTP 400 says are missing. The live API answers
 * `{"error":{"code":"bad_request","message":"sport or league query param is required"}}`,
 * so the retry knows exactly what to add instead of guessing again.
 */
export function requiredParams(body: string): string[] {
  const message = errorMessageOf(body);
  for (const pattern of REQUIRED_PATTERNS) {
    const match = pattern.exec(message);
    if (!match?.[1]) continue;
    const names = match[1]
      .split(/\bor\b|\band\b|[,/]/i)
      .map((name) => name.replace(/["'`]/g, "").trim().toLowerCase())
      .filter((name) => /^[a-z][a-z0-9_.-]{1,40}$/.test(name));
    if (names.length > 0) return [...new Set(names)];
  }
  return [];
}

/** Our concept behind a parameter name the API asked for, if we know one. */
export function conceptOf(name: string): keyof typeof PARAM_ALIASES | "season" | null {
  const squashed = squash(name);
  for (const [concept, aliases] of Object.entries(PARAM_ALIASES)) {
    if (aliases.some((alias) => squash(alias) === squashed)) {
      return concept as keyof typeof PARAM_ALIASES;
    }
  }
  if (/^(sport|sports)/.test(squashed)) return "sport";
  if (/^(league|competition|tournament)/.test(squashed)) return "league";
  if (/^(season|year)/.test(squashed)) return "season";
  if (/^(fixture|match|game|event)/.test(squashed)) return "fixture";
  return null;
}

/** The names a league row may carry, and where its country hides. */
const LEAGUE_NAME_KEYS = [
  "name",
  "slug",
  "title",
  "display_name",
  "full_name",
  "short_name",
  "code",
  "abbreviation",
  "key",
];
const LEAGUE_ID_KEYS = ["id", "league_id", "slug", "key", "code", "uuid"];
const LEAGUE_COUNTRY_KEYS = ["country", "country_name", "country_code", "region", "nation", "area"];

export interface LeagueMatch {
  /** What to send as the league parameter from now on. */
  id: string;
  /** What the API calls it, for the note the admin reads. */
  label: string;
}

function readField(row: unknown, keys: string[]): string {
  if (!isRecord(row)) return "";
  for (const key of keys) {
    for (const actual of Object.keys(row)) {
      if (squash(actual) !== squash(key)) continue;
      const value = row[actual];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (isRecord(value)) {
        const nested = value.name ?? value.code ?? value.slug;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
  }
  return "";
}

/**
 * Serie A among the rows of `/v1/leagues`: the entry whose name or slug reads
 * as "serie a", preferring an Italian one when the row says which country it
 * is. Returns what to send as the league parameter, or null.
 */
export function pickSerieA(rows: unknown[]): LeagueMatch | null {
  let best: { row: unknown; score: number } | null = null;
  for (const row of rows) {
    const name = squash(readField(row, LEAGUE_NAME_KEYS));
    if (!name.includes("serie")) continue;
    let score = name.includes("seriea") ? 100 : 50;
    const country = squash(readField(row, LEAGUE_COUNTRY_KEYS));
    if (country.includes("ital") || country === "it") score += 30;
    if (!best || score > best.score) best = { row, score };
  }
  if (!best) return null;
  const id = readField(best.row, LEAGUE_ID_KEYS);
  const label = readField(best.row, LEAGUE_NAME_KEYS);
  if (!id) return null;
  return { id, label: label || id };
}
