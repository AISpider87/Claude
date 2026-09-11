/**
 * What every availability provider has in common: the contract the job talks
 * to, the request budget, the tolerant HTTP helpers and the diagnostics.
 *
 * Nothing here knows about a specific vendor — `api-football.ts` and `bsd.ts`
 * implement `AvailabilityProvider`, `provider.ts` picks one from the env.
 *
 * Hard rules, whoever the provider is: at most `RequestBudget.max` HTTP calls
 * per run, a 10 s timeout and a size cap per call, tolerant parsing (unknown or
 * missing fields never throw), and the API key never appears in a URL, a log
 * line, an error or a diagnostics sample.
 */

export const TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
/** How much of a raw body the admin gets to see per call (chars). */
export const SAMPLE_CHARS = 1500;
/** How many calls are kept for the diagnostics panel. */
export const SAMPLE_LIMIT = 8;

/** The four states a roster can show. */
export type StatusKind = "injured" | "doubtful" | "suspended" | "unavailable";

export interface ProviderInjury {
  externalId: number | null;
  playerName: string;
  /**
   * The kind, when the provider's own vocabulary is precise enough to decide
   * it (BSD). Left out by API-Football, whose free text `run.ts` maps itself.
   */
  kind?: StatusKind;
  /** "Missing Fixture" | "Questionable" (free text in practice). */
  type: string;
  /** "Injury", "Suspended", "Knee Injury", "Coach Decision"… (free text). */
  reason: string;
  teamId: number | null;
  teamName: string;
  fixtureId: number | null;
  fixtureDate: string | null;
}

export interface ProviderFixture {
  id: number;
  /** ISO 8601 kick-off, as the API returns it. */
  kickoff: string;
  /** "NS", "1H", "FT"… empty when the API omits it. */
  status: string;
  homeName: string;
  awayName: string;
}

export interface ProviderLineupEntry {
  externalId: number | null;
  playerName: string;
  teamName: string;
  state: "starting" | "bench";
}

/** One raw HTTP answer, redacted, for the admin to read while wiring a provider. */
export interface ProviderSample {
  /** Which capability asked: "injuries", "fixtures", "lineups". */
  endpoint: string;
  /** The URL as called, with any key/token replaced by `***`. */
  url: string;
  status: number;
  /** The first `SAMPLE_CHARS` characters of the body, redacted. */
  body: string;
}

export interface AvailabilityProvider {
  readonly name: string;
  /** Shown in the UI and stored as the source of a status ("API-Football"). */
  readonly label: string;
  /** Where the admin reads the provider's own documentation. */
  readonly docsUrl: string;
  readonly season: number;
  readonly budget: RequestBudget;
  /** Remaining daily quota as the provider last reported it, when it does. */
  readonly rateLimitRemaining: number | null;
  /** Rows the provider received but could not read (unknown shape). */
  readonly unparsed: number;
  injuries(): Promise<ProviderInjury[]>;
  fixtures(next: number): Promise<ProviderFixture[]>;
  lineups(fixtureId: number): Promise<ProviderLineupEntry[]>;
  /** The raw answers of this run, redacted: the only way to fix a wrong shape. */
  lastSamples(): ProviderSample[];
  /**
   * What the provider learnt about itself this run, in plain Italian, for the
   * admin panel: the routes it found and chose, a league value it had to
   * substitute, a capability no route matched.
   */
  readonly notes: string[];
  /**
   * Paths and routes that answered this run, to be remembered for the next one,
   * or null when there is nothing to learn (a provider with fixed paths). The
   * shape is the provider's own business; it is stored as-is in
   * `league_settings.availability_endpoints` and handed back on the next run.
   */
  resolvedEndpoints(): Record<string, unknown> | null;
}

/** Raised when the provider answered with a non-empty `errors` field. */
export class ProviderError extends Error {}

/** Raised instead of making the call that would blow the daily quota. */
export class BudgetExceededError extends Error {}

/** Hard cap on the HTTP calls one run may make. */
export class RequestBudget {
  private spent = 0;

  constructor(readonly max = 3) {}

  get used() {
    return this.spent;
  }

  get left() {
    return Math.max(0, this.max - this.spent);
  }

  /** Books one call, or refuses: the caller must skip that endpoint. */
  spend(what: string) {
    if (this.spent >= this.max) {
      throw new BudgetExceededError(`budget esaurito (${this.max} richieste): ${what} saltata`);
    }
    this.spent += 1;
  }
}

/**
 * Serie A season as the providers count it: the starting year. A season runs
 * July→June, so from July on it is the current year. `API_FOOTBALL_SEASON`
 * overrides it (API-Football's free plan only covers some seasons — see
 * docs/SYNC.md).
 */
export function currentSeason(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): number {
  const override = Number.parseInt(env.API_FOOTBALL_SEASON?.trim() ?? "", 10);
  if (Number.isFinite(override) && override >= 2000 && override <= 2100) return override;
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= 7 ? year : year - 1;
}

/**
 * Removes anything that looks like a credential before the text is shown to
 * the admin or written to the database: the configured keys themselves first
 * (exact match, whatever they look like), then the usual query parameters and
 * header echoes, then any long opaque token.
 */
export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (!value || value.length < 6) continue;
    out = out.split(value).join("***");
  }
  return (
    out
      // key=…, api_key: "…", "token":"…", Authorization: Bearer …
      .replace(
        /((?:api[-_]?key|apikey|key|token|secret|authorization|bearer)\s*[=:]\s*)"?[\w.\-]{6,}"?/gi,
        '$1"***"',
      )
      .replace(/Bearer\s+[\w.\-]{6,}/gi, "Bearer ***")
      // anything that still looks like a long opaque credential
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "***")
  );
}

/** Collects the raw answers of one run, redacted and capped. */
export class SampleLog {
  private readonly rows: ProviderSample[] = [];

  constructor(private readonly secrets: (string | undefined)[] = []) {}

  add(endpoint: string, url: string, status: number, body: string) {
    if (this.rows.length >= SAMPLE_LIMIT) this.rows.shift();
    this.rows.push({
      endpoint,
      url: redactSecrets(stripQuerySecrets(url), this.secrets),
      status,
      body: redactSecrets(body, this.secrets).slice(0, SAMPLE_CHARS),
    });
  }

  all(): ProviderSample[] {
    return [...this.rows];
  }
}

/** Hard cap on what the diagnostics may store, whatever the provider answered. */
export const MAX_SAMPLE_BYTES = 4 * 1024;

/**
 * Keeps the diagnostics under `MAX_SAMPLE_BYTES`: whole samples first, then the
 * body of the last one that fits. The admin only needs the beginning of each
 * answer to see the shape.
 */
export function capSamples<T extends { body: string }>(samples: T[], max = MAX_SAMPLE_BYTES): T[] {
  const size = (rows: unknown) => new TextEncoder().encode(JSON.stringify(rows)).length;
  const out: T[] = [];
  for (const sample of samples) {
    if (size([...out, sample]) <= max) {
      out.push(sample);
      continue;
    }
    // No room for the whole answer: keep as much of its beginning as fits.
    const room = max - size([...out, { ...sample, body: "" }]);
    if (room > 40) out.push({ ...sample, body: sample.body.slice(0, room - 1) });
    break;
  }
  return out;
}

/** Replaces the value of every credential-looking query parameter with `***`. */
export function stripQuerySecrets(url: string): string {
  try {
    const parsed = new URL(url);
    for (const [k] of [...parsed.searchParams]) {
      if (/key|token|secret|auth|apikey/i.test(k)) parsed.searchParams.set(k, "***");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Reads the body up to `max` bytes and aborts past it. */
export async function readCapped(res: Response, max: number = MAX_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new ProviderError("risposta troppo grande");
  if (!res.body) {
    const text = await res.text();
    if (text.length > max) throw new ProviderError("risposta troppo grande");
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new ProviderError("risposta troppo grande");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The remaining-quota header, whichever spelling the provider uses. */
export function readRateLimit(res: Response): number | null {
  for (const name of [
    "x-ratelimit-requests-remaining",
    "x-ratelimit-remaining",
    "ratelimit-remaining",
    "x-rate-limit-remaining",
  ]) {
    const parsed = Number.parseInt(res.headers.get(name) ?? "", 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// tolerant readers: every provider answers in its own shape
// ---------------------------------------------------------------------------

/** The keys a payload may hide its rows under, besides the root. */
const LIST_KEYS = ["data", "response", "results", "items", "rows", "records"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The array of rows inside an answer, wherever it is: the root itself, or
 * `data` / `response` / `results` / `items`, one nesting level deep
 * (`{data:{items:[…]}}` happens).
 */
export function rowsOf(payload: unknown, depth = 2): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload) || depth <= 0) return [];
  for (const key of LIST_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  for (const key of LIST_KEYS) {
    const value = payload[key];
    if (isRecord(value)) {
      const nested = rowsOf(value, depth - 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** Follows a dotted path (`player.name`) without ever throwing. */
export function at(row: unknown, path: string): unknown {
  let current: unknown = row;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * The first non-empty string among the given paths. A path that lands on an
 * object also accepts its `name` (so `team` works for both `"Inter"` and
 * `{name:"Inter"}`).
 */
export function pickString(row: unknown, paths: string[]): string {
  for (const path of paths) {
    const value = at(row, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (isRecord(value)) {
      const name = value.name ?? value.fullName ?? value.displayName;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return "";
}

/** The first finite integer among the given paths, or null. */
export function pickInt(row: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = at(row, path);
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^\d{1,15}$/.test(value.trim())) {
      return Number.parseInt(value, 10);
    }
  }
  return null;
}

/** The first boolean-ish value among the given paths, or null when absent. */
export function pickBool(row: unknown, paths: string[]): boolean | null {
  for (const path of paths) {
    const value = at(row, path);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["true", "yes", "y", "1", "start", "starter", "starting", "startxi"].includes(v)) {
        return true;
      }
      if (["false", "no", "n", "0", "bench", "sub", "substitute"].includes(v)) return false;
    }
  }
  return null;
}

/** The array at the first of the given paths that holds one, or []. */
export function pickArray(row: unknown, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = at(row, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}
