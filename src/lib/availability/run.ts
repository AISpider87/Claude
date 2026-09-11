/**
 * The availability job: read the provider, match its players against the
 * listone, write the result through `sync_availability`.
 *
 * It never throws — it is called from a cron route and from a background
 * `after()` on a page load, and neither may fail because a third-party API had
 * a bad minute. Everything that went wrong ends up in `errors`, verbatim, and
 * the admin reads it in Admin → Indisponibili.
 */

import { redactSecrets } from "@/lib/availability/shared";
import {
  type AvailabilityProvider,
  type ProviderFixture,
  type ProviderSample,
  type StatusKind,
} from "@/lib/availability/provider";
import { AvailabilityMatcher, type ExternalMapping } from "@/lib/availability/match";
import type { ListonePlayer } from "@/lib/import/name-matching";

export type { StatusKind };

export interface FeedStatus {
  player_id: number;
  kind: StatusKind;
  note: string | null;
  source_name: string;
  source_url: string;
}

export interface FeedLineup {
  player_id: number;
  state: "starting" | "bench";
  fixture_id: number;
  kickoff: string;
}

export interface FeedMapping {
  external_id: number;
  player_id: number;
  external_name: string;
}

export interface AvailabilityDiagnostics {
  provider: string;
  /** The routes and paths that answered, to be reused by the next run. */
  endpoints: Record<string, unknown> | null;
  /** The raw answers, redacted and capped: only saved when asked or on failure. */
  samples: ProviderSample[];
}

export interface AvailabilityPayload {
  provider: string;
  statuses: FeedStatus[];
  lineups: FeedLineup[];
  map: FeedMapping[];
  clear_missing: boolean;
  run: Record<string, unknown>;
}

/** What the DB side of the job needs, so the orchestrator stays testable. */
export interface AvailabilityDb {
  loadPlayers(): Promise<ListonePlayer[]>;
  loadMappings(provider: string): Promise<ExternalMapping[]>;
  applyFeed(payload: AvailabilityPayload): Promise<Record<string, unknown>>;
  /**
   * Stores the discovered paths and — on a failure, or when the admin asked for
   * it — the raw answers, so the provider can be wired without a second guess.
   * Optional: a caller that cannot write settings simply loses the diagnostics.
   */
  saveDiagnostics?(diagnostics: AvailabilityDiagnostics): Promise<void>;
}

export interface UnmatchedName {
  external_id: number | null;
  name: string;
  team: string;
  /**
   * `to_confirm` is a match we made but do not trust enough to write down: the
   * club was unknown, or the name matched on the surname alone. The status is
   * applied, the binding waits for the admin.
   */
  kind: "ambiguous" | "not_found" | "to_confirm";
  /** What the API said about them, so the admin can judge the binding. */
  detail: string;
  candidates: { id: number; name: string; team: string }[];
}

export interface AvailabilityOutcome {
  status: "ok" | "skipped" | "failed";
  reason?: "no_provider" | "no_players" | "provider_error" | "db_error";
  season: number | null;
  statuses: number;
  lineups: number;
  unmatched: UnmatchedName[];
  errors: string[];
  requests: number;
  /** The run's hard cap, so the panel can show "3/12". */
  requests_max: number;
  /** Rows the provider sent that nobody could read (wrong shape). */
  unparsed: number;
  /** What the provider learnt about itself (discovered routes, substitutions). */
  notes: string[];
  rate_limit_remaining: number | null;
  fixture: { id: number; kickoff: string; label: string } | null;
  applied: Record<string, unknown> | null;
  finished_at: string;
}

/** Lineups are only worth a request this close to (or into) a kick-off. */
const IMMINENT_MS = 3 * 60 * 60 * 1000;
const FINISHED = new Set(["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]);

/**
 * `reason` and `type` are free text on the provider's side, so the mapping is
 * a cascade of the cases seen in the documentation, most specific first:
 *   suspension words → squalificato; "Questionable" → in dubbio;
 *   coach decision / national team → indisponibile; anything else → infortunato.
 */
export function mapReason(type: string | null | undefined, reason: string | null | undefined) {
  const t = (type ?? "").toLowerCase();
  const r = (reason ?? "").toLowerCase();
  if (/suspend|squalif|red card|yellow cards|expuls/.test(r)) return "suspended" as const;
  if (t.includes("questionable")) return "doubtful" as const;
  if (/coach decision|national|rest|personal/.test(r)) return "unavailable" as const;
  return "injured" as const;
}

/** Most serious first: one player, several fixtures, one row in the end. */
const SEVERITY: Record<StatusKind, number> = {
  suspended: 4,
  injured: 3,
  unavailable: 2,
  doubtful: 1,
};

function emptyOutcome(status: AvailabilityOutcome["status"]): AvailabilityOutcome {
  return {
    status,
    season: null,
    statuses: 0,
    lineups: 0,
    unmatched: [],
    errors: [],
    requests: 0,
    requests_max: 0,
    unparsed: 0,
    notes: [],
    rate_limit_remaining: null,
    fixture: null,
    applied: null,
    finished_at: new Date().toISOString(),
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "errore sconosciuto";
}

/** The fixture worth asking the lineups for: the first one about to start. */
export function imminentFixture(
  fixtures: ProviderFixture[],
  now: Date = new Date(),
): ProviderFixture | null {
  const t = now.getTime();
  const upcoming = fixtures
    .filter((f) => !FINISHED.has(f.status.toUpperCase()))
    .map((f) => ({ f, at: Date.parse(f.kickoff) }))
    .filter(({ at }) => Number.isFinite(at) && at <= t + IMMINENT_MS && at >= t - IMMINENT_MS)
    .sort((a, b) => a.at - b.at);
  return upcoming[0]?.f ?? null;
}

export interface RunOptions {
  /**
   * "Modalità diagnostica": keep the raw answers even when the run succeeds, so
   * the admin can check the shape while wiring a provider. A failed run always
   * keeps them.
   */
  diagnostics?: boolean;
}

export async function runAvailabilitySync(
  provider: AvailabilityProvider | null,
  db: AvailabilityDb,
  log: (msg: string) => void = () => {},
  now: Date = new Date(),
  opts: RunOptions = {},
): Promise<AvailabilityOutcome> {
  if (!provider) {
    log("no availability key configured: feed off");
    return { ...emptyOutcome("skipped"), reason: "no_provider" };
  }
  const out = emptyOutcome("ok");
  out.season = provider.season;
  out.requests_max = provider.budget.max;

  // Whatever happens below, the admin must be able to see what came back.
  const saveDiagnostics = async (failed: boolean) => {
    const endpoints = provider.resolvedEndpoints();
    const keep = failed || opts.diagnostics === true;
    if (!db.saveDiagnostics || (!endpoints && !keep)) return;
    try {
      await db.saveDiagnostics({
        provider: provider.name,
        endpoints,
        samples: keep ? provider.lastSamples() : [],
      });
    } catch (e) {
      log(`diagnostics not saved: ${message(e)}`);
    }
  };

  let players: ListonePlayer[];
  let mappings: ExternalMapping[];
  try {
    [players, mappings] = await Promise.all([db.loadPlayers(), db.loadMappings(provider.name)]);
  } catch (e) {
    out.errors.push(`listone: ${message(e)}`);
    await saveDiagnostics(true);
    return { ...out, status: "failed", reason: "db_error", requests: provider.budget.used };
  }
  if (players.length === 0) {
    log("listone empty: nothing to match against");
    return { ...out, status: "skipped", reason: "no_players" };
  }
  const matcher = new AvailabilityMatcher(players, mappings);

  const statuses = new Map<number, FeedStatus & { severity: number }>();
  const mapRows = new Map<number, FeedMapping>();
  const unmatched = new Map<string, UnmatchedName>();

  let matched = 0;

  const report = (
    q: { externalId: number | null; name: string; teamName: string },
    kind: UnmatchedName["kind"],
    detail: string,
    candidates: ListonePlayer[],
  ) => {
    // One line per provider player, however many endpoints reported them.
    const key = q.externalId != null ? `id:${q.externalId}` : `name:${q.name}|${q.teamName}`;
    if (unmatched.has(key)) return;
    unmatched.set(key, {
      external_id: q.externalId,
      name: q.name,
      team: q.teamName,
      kind,
      detail,
      candidates: candidates.slice(0, 6).map((c) => ({ id: c.id, name: c.name, team: c.team })),
    });
  };

  // ---- 1st request: injuries -------------------------------------------
  let injuriesOk = false;
  try {
    const injuries = await provider.injuries();
    injuriesOk = true;
    for (const inj of injuries) {
      const q = { externalId: inj.externalId, name: inj.playerName, teamName: inj.teamName };
      const found = matcher.match(q);
      if (found.status !== "matched") {
        report(
          q,
          found.status,
          [inj.type, inj.reason].filter(Boolean).join(" · "),
          found.candidates,
        );
        continue;
      }
      matched += 1;
      if (found.confirm) {
        // Applied, but not bound: the admin says whether it is the right player.
        report(q, "to_confirm", [inj.type, inj.reason].filter(Boolean).join(" · "), [found.player]);
      } else if (inj.externalId != null && found.via !== "map") {
        mapRows.set(inj.externalId, {
          external_id: inj.externalId,
          player_id: found.player.id,
          external_name: inj.playerName,
        });
      }
      // BSD decides the kind itself (its status vocabulary is explicit);
      // API-Football only sends free text, mapped here.
      const kind = inj.kind ?? mapReason(inj.type, inj.reason);
      const previous = statuses.get(found.player.id);
      if (previous && previous.severity >= SEVERITY[kind]) continue;
      const note = [inj.reason, inj.type].filter((s) => s && s.trim()).join(" · ");
      statuses.set(found.player.id, {
        player_id: found.player.id,
        kind,
        note: note || null,
        source_name: provider.label,
        source_url: provider.docsUrl,
        severity: SEVERITY[kind],
      });
    }
    log(`injuries: ${injuries.length} rows, ${statuses.size} matched`);
  } catch (e) {
    out.errors.push(`indisponibili: ${message(e)}`);
  }

  // ---- 2nd request: the next fixtures ----------------------------------
  const lineups: FeedLineup[] = [];
  let fixtures: ProviderFixture[] = [];
  try {
    fixtures = await provider.fixtures(10);
    log(`fixtures: ${fixtures.length}`);
  } catch (e) {
    out.errors.push(`calendario: ${message(e)}`);
  }

  // ---- 3rd request: lineups, only when a match is about to start -------
  const next = imminentFixture(fixtures, now);
  if (next) {
    out.fixture = {
      id: next.id,
      kickoff: next.kickoff,
      label: `${next.homeName}-${next.awayName}`,
    };
    try {
      const entries = await provider.lineups(next.id);
      for (const entry of entries) {
        const q = {
          externalId: entry.externalId,
          name: entry.playerName,
          teamName: entry.teamName,
        };
        const found = matcher.match(q);
        if (found.status !== "matched") {
          report(q, found.status, `formazione ${out.fixture.label}`, found.candidates);
          continue;
        }
        if (found.confirm) {
          report(q, "to_confirm", `formazione ${out.fixture.label}`, [found.player]);
        } else if (entry.externalId != null && found.via !== "map") {
          mapRows.set(entry.externalId, {
            external_id: entry.externalId,
            player_id: found.player.id,
            external_name: entry.playerName,
          });
        }
        lineups.push({
          player_id: found.player.id,
          state: entry.state,
          fixture_id: next.id,
          kickoff: next.kickoff,
        });
      }
      log(`lineups ${next.id}: ${lineups.length} players`);
    } catch (e) {
      out.errors.push(`formazioni: ${message(e)}`);
    }
  } else {
    log("no imminent fixture: lineups call skipped");
  }

  out.requests = provider.budget.used;
  out.unparsed = provider.unparsed;
  const confirmRows = [...unmatched.values()].filter((u) => u.kind === "to_confirm").length;
  // Provider text can echo the key back ("API key 'xyz' is invalid"): redact it
  // before it reaches the database, the admin panel or a backup.
  out.errors = out.errors.map((e) => redactSecrets(e, [...provider.secrets]));
  out.notes = [
    ...provider.notes,
    `abbinamenti: ${matched} riusciti, ${confirmRows} da confermare, ${
      unmatched.size - confirmRows
    } da abbinare a mano`,
  ];
  out.rate_limit_remaining = provider.rateLimitRemaining;
  out.statuses = statuses.size;
  out.lineups = lineups.length;
  out.unmatched = [...unmatched.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  // Only a successful injuries call may clear rows: a failed one would wipe
  // every feed status off the league's rosters.
  const payload: AvailabilityPayload = {
    provider: provider.name,
    // `severity` is only the local tie-breaker between several fixtures.
    statuses: [...statuses.values()].map((s) => ({
      player_id: s.player_id,
      kind: s.kind,
      note: s.note,
      source_name: s.source_name,
      source_url: s.source_url,
    })),
    lineups,
    map: [...mapRows.values()],
    // A 200 we could not read (renamed wrapper, hostile answer) must never be
    // taken as "everyone recovered": only clear when we actually read rows.
    clear_missing: injuriesOk && (statuses.size > 0 || provider.unparsed === 0),
    run: {
      status: injuriesOk ? (out.errors.length > 0 ? "partial" : "ok") : "failed",
      provider_label: provider.label,
      season: out.season,
      requests: out.requests,
      requests_max: out.requests_max,
      unparsed: out.unparsed,
      notes: out.notes,
      diagnostics: opts.diagnostics === true,
      rate_limit_remaining: out.rate_limit_remaining,
      errors: out.errors,
      unmatched: out.unmatched,
      fixture: out.fixture,
      finished_at: out.finished_at,
    },
  };

  await saveDiagnostics(!injuriesOk || out.errors.length > 0);

  try {
    out.applied = await db.applyFeed(payload);
  } catch (e) {
    out.errors.push(`salvataggio: ${message(e)}`);
    return { ...out, status: "failed", reason: "db_error" };
  }
  // A failed lineups call still leaves a usable run; a failed injuries call does not.
  return {
    ...out,
    status: injuriesOk ? "ok" : "failed",
    reason: injuriesOk ? undefined : "provider_error",
  };
}
