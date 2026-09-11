/**
 * API-Football (api-sports.io, v3, direct host — not the RapidAPI variant).
 *
 * Free plan: 100 requests/day, and — verified by the admin on 2026-09-11 — it
 * refuses the current season ("Free plans do not have access to this season,
 * try from 2022 to 2024"). It is kept as the second provider because the paid
 * plan and the historical seasons work, but the default is now `bsd`
 * (src/lib/availability/bsd.ts). See docs/SYNC.md.
 *
 * Everything about the payload shape comes from the v3 documentation: the dev
 * network cannot reach api-sports.io, so `lastSamples()` is the only way to
 * check it against reality.
 */

import { z } from "zod";
import {
  MAX_BYTES,
  ProviderError,
  RequestBudget,
  SampleLog,
  TIMEOUT_MS,
  currentSeason,
  readCapped,
  readRateLimit,
  type AvailabilityProvider,
  type ProviderFixture,
  type ProviderInjury,
  type ProviderLineupEntry,
} from "@/lib/availability/shared";

export const API_FOOTBALL_PROVIDER = "api-football";
export const SERIE_A_LEAGUE_ID = 135;
export const SOURCE_NAME = "API-Football";
export const SOURCE_URL = "https://www.api-football.com/";

const BASE_URL = "https://v3.football.api-sports.io";

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
  const samples = new SampleLog([key]);
  let rateLimitRemaining: number | null = null;
  let unparsed = 0;

  async function call(
    what: string,
    path: string,
    params: Record<string, string | number>,
  ): Promise<unknown[]> {
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
      samples.add(what, url.toString(), 0, e instanceof Error ? e.name : "errore");
      throw new ProviderError(
        `${path}: rete non raggiungibile (${e instanceof Error ? e.name : "errore"})`,
      );
    }
    const remaining = readRateLimit(res);
    if (remaining !== null) rateLimitRemaining = remaining;
    if (!res.ok) {
      samples.add(what, url.toString(), res.status, await safeBody(res));
      throw new ProviderError(`${path}: HTTP ${res.status}`);
    }

    const text = await readCapped(res, MAX_BYTES);
    samples.add(what, url.toString(), res.status, text);
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
    label: SOURCE_NAME,
    docsUrl: SOURCE_URL,
    season,
    budget,
    get rateLimitRemaining() {
      return rateLimitRemaining;
    },
    get unparsed() {
      return unparsed;
    },
    lastSamples: () => samples.all(),
    // Fixed paths, documented and stable: nothing to discover or to report.
    notes: [],
    resolvedEndpoints: () => null,

    async injuries(): Promise<ProviderInjury[]> {
      const rows = await call("injuries", "/injuries", { league: leagueId, season });
      return rows.flatMap((row) => {
        const parsed = injurySchema.safeParse(row);
        if (!parsed.success) {
          unparsed += 1;
          return [];
        }
        const { player, team, fixture } = parsed.data;
        const playerName = player?.name?.trim() ?? "";
        if (!playerName) {
          unparsed += 1;
          return [];
        }
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
      const rows = await call("fixtures", "/fixtures", { league: leagueId, season, next });
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
      const rows = await call("lineups", "/fixtures/lineups", { fixture: fixtureId });
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

/** The body of a failed answer, for the diagnostics, never for the logic. */
async function safeBody(res: Response): Promise<string> {
  try {
    return await readCapped(res, 64 * 1024);
  } catch {
    return "";
  }
}
