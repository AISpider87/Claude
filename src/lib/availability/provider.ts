/**
 * Where the availability/lineup feed comes from.
 *
 * The only implementation today is API-Football (api-sports.io, direct host,
 * free plan: 100 requests/day). It is pluggable like `QuotationSource` so the
 * orchestrator can be tested without the network — which is also the only way
 * it has been tested so far: api-sports.io is unreachable from the dev network,
 * so every assumption about the payload shape is written down in docs/SYNC.md
 * and must be verified in production through Admin → Indisponibili.
 *
 * Hard rules: at most `RequestBudget.max` HTTP calls per run (3), a 10 s
 * timeout and a size cap per call, tolerant parsing (unknown or missing fields
 * never throw), and the API key never appears in a log line or an error.
 */

import { z } from "zod";

export const API_FOOTBALL_PROVIDER = "api-football";
export const SERIE_A_LEAGUE_ID = 135;
export const SOURCE_NAME = "API-Football";
export const SOURCE_URL = "https://www.api-football.com/";

const BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

export interface ProviderInjury {
  externalId: number | null;
  playerName: string;
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

export interface AvailabilityProvider {
  readonly name: string;
  readonly season: number;
  readonly budget: RequestBudget;
  /** Remaining daily quota as the provider last reported it, when it does. */
  readonly rateLimitRemaining: number | null;
  injuries(): Promise<ProviderInjury[]>;
  fixtures(next: number): Promise<ProviderFixture[]>;
  lineups(fixtureId: number): Promise<ProviderLineupEntry[]>;
}

/** Raised when the provider answered with a non-empty `errors` field. */
export class ProviderError extends Error {}

/** Raised instead of making the call that would blow the daily quota. */
export class BudgetExceededError extends Error {}

/** Hard cap on the HTTP calls one run may make (free plan: 100 requests/day). */
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
 * Serie A season as API-Football counts it: the starting year. A season runs
 * July→June, so from July on it is the current year. `API_FOOTBALL_SEASON`
 * overrides it (the free plan only covers some seasons — see docs/SYNC.md).
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

// ---------------------------------------------------------------------------
// tolerant schemas: anything unexpected is dropped, never thrown
// ---------------------------------------------------------------------------
const num = z.number().nullish();
const str = z.string().nullish();

const envelopeSchema = z.object({
  errors: z.unknown().optional(),
  results: z.number().nullish(),
  response: z.array(z.unknown()).nullish(),
});

const teamRefSchema = z.object({ id: num, name: str }).nullish();

const injurySchema = z.object({
  player: z.object({ id: num, name: str, type: str, reason: str }).nullish(),
  team: teamRefSchema,
  fixture: z.object({ id: num, date: str }).nullish(),
});

const fixtureSchema = z.object({
  fixture: z.object({ id: num, date: str, status: z.object({ short: str }).nullish() }).nullish(),
  teams: z.object({ home: teamRefSchema, away: teamRefSchema }).nullish(),
});

const lineupPlayerSchema = z.object({
  player: z.object({ id: num, name: str, pos: str }).nullish(),
});

const lineupSchema = z.object({
  team: teamRefSchema,
  startXI: z.array(lineupPlayerSchema).nullish(),
  substitutes: z.array(lineupPlayerSchema).nullish(),
});

/**
 * `errors` is an object (`{"token": "…"}`) on some failures and an empty array
 * on success. Anything non-empty means the call failed; the message is passed
 * on verbatim so the admin sees exactly what the provider said.
 */
export function errorMessages(errors: unknown): string[] {
  if (errors == null) return [];
  if (typeof errors === "string") return errors.trim() ? [errors.trim()] : [];
  if (Array.isArray(errors)) return errors.map((e) => String(e)).filter((e) => e.trim().length > 0);
  if (typeof errors === "object") {
    return Object.entries(errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`);
  }
  return [];
}

export interface ApiFootballOptions {
  season?: number;
  leagueId?: number;
  budget?: RequestBudget;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * API-Football (v3, direct host). The key travels in `x-apisports-key` and is
 * never interpolated into a URL, a log line or an error message.
 */
export function apiFootballProvider(key: string, opts: ApiFootballOptions = {}) {
  const season = opts.season ?? currentSeason();
  const leagueId = opts.leagueId ?? SERIE_A_LEAGUE_ID;
  const budget = opts.budget ?? new RequestBudget(3);
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? BASE_URL;
  let rateLimitRemaining: number | null = null;

  async function call(path: string, params: Record<string, string | number>): Promise<unknown[]> {
    budget.spend(path);
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { "x-apisports-key": key, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // Never echo the exception as-is: it can carry the request (and the key).
      throw new ProviderError(
        `${path}: rete non raggiungibile (${e instanceof Error ? e.name : "errore"})`,
      );
    }
    const remaining =
      res.headers.get("x-ratelimit-requests-remaining") ?? res.headers.get("X-RateLimit-Remaining");
    const parsedRemaining = Number.parseInt(remaining ?? "", 10);
    if (Number.isFinite(parsedRemaining)) rateLimitRemaining = parsedRemaining;
    if (!res.ok) throw new ProviderError(`${path}: HTTP ${res.status}`);

    const text = await readCapped(res, MAX_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new ProviderError(`${path}: risposta non JSON`);
    }
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) throw new ProviderError(`${path}: risposta inattesa`);
    const errors = errorMessages(envelope.data.errors);
    if (errors.length > 0) throw new ProviderError(`${path}: ${errors.join(" · ")}`);
    return envelope.data.response ?? [];
  }

  return {
    name: API_FOOTBALL_PROVIDER,
    season,
    budget,
    get rateLimitRemaining() {
      return rateLimitRemaining;
    },

    async injuries(): Promise<ProviderInjury[]> {
      const rows = await call("/injuries", { league: leagueId, season });
      return rows.flatMap((row) => {
        const parsed = injurySchema.safeParse(row);
        if (!parsed.success) return [];
        const { player, team, fixture } = parsed.data;
        const playerName = player?.name?.trim() ?? "";
        if (!playerName) return [];
        return [
          {
            externalId: player?.id ?? null,
            playerName,
            type: player?.type?.trim() ?? "",
            reason: player?.reason?.trim() ?? "",
            teamId: team?.id ?? null,
            teamName: team?.name?.trim() ?? "",
            fixtureId: fixture?.id ?? null,
            fixtureDate: fixture?.date ?? null,
          },
        ];
      });
    },

    async fixtures(next: number): Promise<ProviderFixture[]> {
      const rows = await call("/fixtures", { league: leagueId, season, next });
      return rows.flatMap((row) => {
        const parsed = fixtureSchema.safeParse(row);
        if (!parsed.success) return [];
        const f = parsed.data.fixture;
        const id = f?.id ?? null;
        const kickoff = f?.date?.trim() ?? "";
        if (id == null || !kickoff || Number.isNaN(Date.parse(kickoff))) return [];
        return [
          {
            id,
            kickoff,
            status: f?.status?.short?.trim() ?? "",
            homeName: parsed.data.teams?.home?.name?.trim() ?? "",
            awayName: parsed.data.teams?.away?.name?.trim() ?? "",
          },
        ];
      });
    },

    async lineups(fixtureId: number): Promise<ProviderLineupEntry[]> {
      const rows = await call("/fixtures/lineups", { fixture: fixtureId });
      const out: ProviderLineupEntry[] = [];
      for (const row of rows) {
        const parsed = lineupSchema.safeParse(row);
        if (!parsed.success) continue;
        const teamName = parsed.data.team?.name?.trim() ?? "";
        const push = (list: unknown, state: "starting" | "bench") => {
          const entries = Array.isArray(list) ? list : [];
          for (const entry of entries) {
            const p = lineupPlayerSchema.safeParse(entry);
            const name = p.success ? (p.data.player?.name?.trim() ?? "") : "";
            if (!name) continue;
            out.push({
              externalId: p.success ? (p.data.player?.id ?? null) : null,
              playerName: name,
              teamName,
              state,
            });
          }
        };
        push(parsed.data.startXI, "starting");
        push(parsed.data.substitutes, "bench");
      }
      return out;
    },
  } satisfies AvailabilityProvider;
}

/** Reads the body up to `max` bytes and aborts past it. */
async function readCapped(res: Response, max: number): Promise<string> {
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

/**
 * The configured provider, or null when no key is set: without a key the whole
 * feature is simply off and the manual statuses keep working.
 */
export function availabilityProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): AvailabilityProvider | null {
  const key = env.API_FOOTBALL_KEY?.trim();
  if (!key) return null;
  return apiFootballProvider(key, { season: currentSeason(new Date(), env) });
}
