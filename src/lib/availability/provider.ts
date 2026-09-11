/**
 * Where the availability/lineup feed comes from, and which provider this
 * deployment uses.
 *
 * Two implementations, same contract (`AvailabilityProvider`):
 *   - **`bsd`** — Big Balls Sports Data, free tier, ~1000 requests/day: the
 *     default, and the one the league runs on (src/lib/availability/bsd.ts);
 *   - **`api-football`** — api-sports.io, kept because it works on a paid plan,
 *     but its free plan refuses the current season
 *     (src/lib/availability/api-football.ts).
 *
 * Neither host is reachable from the dev network, so every assumption about the
 * payload shape is written down in docs/SYNC.md and must be verified in
 * production through Admin → Indisponibili → "Mostra risposta grezza".
 */

import {
  API_FOOTBALL_PROVIDER,
  SOURCE_NAME,
  SOURCE_URL,
  apiFootballProvider,
} from "@/lib/availability/api-football";
import {
  BSD_DOCS_URL,
  BSD_PROVIDER,
  BSD_SOURCE_NAME,
  bsdLeague,
  bsdProvider,
  parseEndpoints,
} from "@/lib/availability/bsd";
import { currentSeason, type AvailabilityProvider } from "@/lib/availability/shared";

export {
  API_FOOTBALL_PROVIDER,
  SERIE_A_LEAGUE_ID,
  SOURCE_NAME,
  SOURCE_URL,
  apiFootballProvider,
  errorMessages,
  type ApiFootballOptions,
} from "@/lib/availability/api-football";
export {
  BSD_BASE_URL,
  BSD_DEFAULT_LEAGUE,
  BSD_DOCS_URL,
  BSD_PROVIDER,
  BSD_SOURCE_NAME,
  bsdProvider,
  mapBsdStatus,
  type BsdCapability,
} from "@/lib/availability/bsd";
export {
  BudgetExceededError,
  ProviderError,
  RequestBudget,
  currentSeason,
  type AvailabilityProvider,
  type ProviderFixture,
  type ProviderInjury,
  type ProviderLineupEntry,
  type ProviderSample,
  type StatusKind,
} from "@/lib/availability/shared";

/** The providers the app knows how to talk to, in preference order. */
export const AVAILABILITY_PROVIDERS = [BSD_PROVIDER, API_FOOTBALL_PROVIDER] as const;
export type AvailabilityProviderName = (typeof AVAILABILITY_PROVIDERS)[number];

/** Name → what the admin reads in the panel. */
export const PROVIDER_LABEL: Record<string, string> = {
  [BSD_PROVIDER]: BSD_SOURCE_NAME,
  [API_FOOTBALL_PROVIDER]: SOURCE_NAME,
};

export const PROVIDER_DOCS: Record<string, string> = {
  [BSD_PROVIDER]: BSD_DOCS_URL,
  [API_FOOTBALL_PROVIDER]: SOURCE_URL,
};

/** The env var that holds the key of each provider, for the admin's error message. */
export const PROVIDER_KEY_VAR: Record<string, string> = {
  [BSD_PROVIDER]: "BSD_API_KEY",
  [API_FOOTBALL_PROVIDER]: "API_FOOTBALL_KEY",
};

/**
 * Which provider this deployment is configured for: `AVAILABILITY_PROVIDER`
 * when set (even if its key is missing — the panel must be able to say "you
 * chose bsd but BSD_API_KEY is empty"), otherwise the first one with a key.
 * Null when nothing is configured: the feed is simply off.
 */
export function selectedProviderName(
  env: Record<string, string | undefined> = process.env,
): AvailabilityProviderName | null {
  const chosen = env.AVAILABILITY_PROVIDER?.trim().toLowerCase();
  if (chosen === BSD_PROVIDER || chosen === "bigballsdata") return BSD_PROVIDER;
  if (chosen === API_FOOTBALL_PROVIDER || chosen === "apifootball") return API_FOOTBALL_PROVIDER;
  if (env.BSD_API_KEY?.trim()) return BSD_PROVIDER;
  if (env.API_FOOTBALL_KEY?.trim()) return API_FOOTBALL_PROVIDER;
  return null;
}

export interface ProviderFromEnvOptions {
  /** Paths discovered on a previous run (`league_settings.availability_endpoints`). */
  endpoints?: unknown;
}

/**
 * The configured provider, or null when its key is not set: without a key the
 * whole feature is simply off and the manual statuses keep working.
 */
export function availabilityProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  opts: ProviderFromEnvOptions = {},
): AvailabilityProvider | null {
  const name = selectedProviderName(env);
  if (name === BSD_PROVIDER) {
    const key = env.BSD_API_KEY?.trim();
    if (!key) return null;
    return bsdProvider(key, {
      baseUrl: env.BSD_BASE_URL?.trim() || undefined,
      league: bsdLeague(env),
      season: currentSeason(new Date(), env),
      endpoints: parseEndpoints(opts.endpoints),
    });
  }
  if (name === API_FOOTBALL_PROVIDER) {
    const key = env.API_FOOTBALL_KEY?.trim();
    if (!key) return null;
    return apiFootballProvider(key, { season: currentSeason(new Date(), env) });
  }
  return null;
}
