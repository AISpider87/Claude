/**
 * Matching API-Football players against the listone.
 *
 * The provider says "Lautaro Martinez · Inter", the listone says
 * "Martinez Lau. · Inter": there is no shared id, so the first run has to guess
 * by name + club and the answer is then remembered in `external_player_map`
 * (so the guess happens once, and the admin can correct it by hand).
 *
 * The rule is deliberately strict: a single candidate in the right club is a
 * match, anything else is reported to the admin and nothing is written. A
 * wrong "Infortunato" on somebody's roster is worse than a missing one.
 */

import { NameMatcher, normalizeName, type ListonePlayer } from "@/lib/import/name-matching";

export interface ExternalMapping {
  external_id: number;
  player_id: number;
  confidence?: string | null;
}

export type MatchVia = "map" | "name" | "club";

export type MatchOutcome =
  | { status: "matched"; player: ListonePlayer; via: MatchVia }
  | { status: "ambiguous"; candidates: ListonePlayer[] }
  | { status: "not_found"; candidates: ListonePlayer[] };

export interface MatchQuery {
  externalId: number | null;
  name: string;
  teamName: string;
}

/**
 * API team name → `players.team` of the listone. Keys are canonical forms
 * (lower case, no accents, no "AC/AS/SSC/FC/US/SS/Calcio/1909" noise), so
 * "AC Milan", "A.C. Milan" and "Milan" all land on the same club.
 */
const CLUB_ALIASES: Readonly<Record<string, string>> = {
  inter: "Inter",
  internazionale: "Inter",
  "inter milan": "Inter",
  "internazionale milano": "Inter",
  milan: "Milan",
  roma: "Roma",
  napoli: "Napoli",
  juventus: "Juventus",
  juve: "Juventus",
  lazio: "Lazio",
  atalanta: "Atalanta",
  "atalanta bc": "Atalanta",
  fiorentina: "Fiorentina",
  bologna: "Bologna",
  torino: "Torino",
  udinese: "Udinese",
  genoa: "Genoa",
  "genoa cricket and football club": "Genoa",
  cagliari: "Cagliari",
  lecce: "Lecce",
  como: "Como",
  "como 1907": "Como",
  parma: "Parma",
  venezia: "Venezia",
  frosinone: "Frosinone",
  monza: "Monza",
  sassuolo: "Sassuolo",
};

/** Words that carry no identity in a club name, in either source. */
const CLUB_NOISE = new Set([
  "ac",
  "as",
  "ssc",
  "fc",
  "us",
  "ss",
  "sc",
  "cfc",
  "acf",
  "bc",
  "calcio",
  "football",
  "club",
  "spa",
  "srl",
  "1907",
  "1909",
  "1913",
]);

/** Canonical club key, tolerant to case, accents, dots and the usual prefixes. */
export function clubKey(name: string | null | undefined): string {
  const cleaned = normalizeName(name ?? "")
    .replace(/[.'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  // Single letters are the leftovers of "A.C." / "S.S.": never a club name.
  const tokens = cleaned.split(" ").filter((t) => t.length > 1 && !CLUB_NOISE.has(t));
  const stripped = tokens.join(" ");
  return CLUB_ALIASES[stripped] ?? CLUB_ALIASES[cleaned] ?? stripped;
}

/** True when both sides name the same club (an unknown side never blocks). */
export function sameClub(apiTeam: string | null | undefined, listoneTeam: string): boolean {
  const a = clubKey(apiTeam);
  const b = clubKey(listoneTeam);
  if (!a || !b) return true;
  return a === b;
}

/** Tokens worth indexing: no initials ("Lau."), no one/two letter noise. */
function tokensOf(name: string): string[] {
  return normalizeName(name)
    .replace(/[.'’-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export class AvailabilityMatcher {
  private readonly byExternalId = new Map<number, ListonePlayer>();
  private readonly nameMatcher: NameMatcher;
  private readonly byClubToken = new Map<string, ListonePlayer[]>();

  constructor(players: ListonePlayer[], mappings: ExternalMapping[] = []) {
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const m of mappings) {
      const player = byId.get(m.player_id);
      if (player) this.byExternalId.set(m.external_id, player);
    }
    this.nameMatcher = new NameMatcher(players);
    for (const p of players) {
      const club = clubKey(p.team);
      for (const token of tokensOf(p.name)) {
        const key = `${club}|${token}`;
        const list = this.byClubToken.get(key);
        if (list) list.push(p);
        else this.byClubToken.set(key, [p]);
      }
    }
  }

  match(query: MatchQuery): MatchOutcome {
    if (query.externalId != null) {
      const known = this.byExternalId.get(query.externalId);
      if (known) return { status: "matched", player: known, via: "map" };
    }

    const byName = this.nameMatcher.match(query.name);
    if (byName.status === "matched" && byName.player) {
      // A single perfect name match still has to be in the right club: two
      // leagues away, the same name is a different person.
      if (sameClub(query.teamName, byName.player.team)) {
        return { status: "matched", player: byName.player, via: "name" };
      }
    }
    if (byName.candidates.length > 1) {
      const inClub = byName.candidates.filter((c) => sameClub(query.teamName, c.team));
      if (inClub.length === 1) return { status: "matched", player: inClub[0]!, via: "club" };
      if (inClub.length > 1) return { status: "ambiguous", candidates: inClub };
    }

    // Last resort: the surname inside the club. API names read
    // "Lautaro Martinez", listone names read "Martinez Lau.", so the tokens are
    // tried from the last one (usually the surname) backwards.
    const club = clubKey(query.teamName);
    if (club) {
      const tokens = tokensOf(query.name);
      for (let i = tokens.length - 1; i >= 0; i--) {
        const hits = this.byClubToken.get(`${club}|${tokens[i]!}`) ?? [];
        if (hits.length === 1) return { status: "matched", player: hits[0]!, via: "club" };
        if (hits.length > 1) return { status: "ambiguous", candidates: hits };
      }
    }
    return { status: "not_found", candidates: byName.candidates };
  }
}
