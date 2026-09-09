import type { RoleClassic } from "@/lib/import/quotations-parser";

export interface ListonePlayer {
  id: number;
  name: string;
  team: string;
  role_classic: RoleClassic;
  qt_a: number;
  status: "active" | "out_of_list";
}

export type MatchStatus = "matched" | "not_found" | "ambiguous";

export interface NameMatch {
  query: string;
  status: MatchStatus;
  player: ListonePlayer | null;
  candidates: ListonePlayer[];
}

/** Lower case, no accents, single spaces, no trailing dots/asterisks. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "")
    .trim();
}

/** Loose key: also drops dots inside the name ("Martinez Jo." → "martinez jo"). */
function looseKey(value: string): string {
  return normalizeName(value).replace(/\./g, "");
}

export class NameMatcher {
  private readonly exact = new Map<string, ListonePlayer[]>();
  private readonly loose = new Map<string, ListonePlayer[]>();

  constructor(players: ListonePlayer[]) {
    for (const p of players) {
      push(this.exact, normalizeName(p.name), p);
      push(this.loose, looseKey(p.name), p);
    }
  }

  /**
   * Exact (normalised) match first; then a loose match ignoring dots. A single
   * candidate is a match; several are "ambiguous" and must be resolved by hand.
   * Active players win over out-of-list homonyms unless the caller asks otherwise.
   */
  match(query: string, preferOutOfList = false): NameMatch {
    const candidates =
      this.exact.get(normalizeName(query)) ?? this.loose.get(looseKey(query)) ?? [];
    const result = pickCandidate(candidates, preferOutOfList);
    return { query, ...result };
  }
}

function push(map: Map<string, ListonePlayer[]>, key: string, p: ListonePlayer) {
  const list = map.get(key);
  if (list) list.push(p);
  else map.set(key, [p]);
}

function pickCandidate(
  candidates: ListonePlayer[],
  preferOutOfList: boolean,
): Omit<NameMatch, "query"> {
  if (candidates.length === 0) return { status: "not_found", player: null, candidates: [] };
  if (candidates.length === 1) return { status: "matched", player: candidates[0]!, candidates };

  const wanted = preferOutOfList ? "out_of_list" : "active";
  const filtered = candidates.filter((c) => c.status === wanted);
  if (filtered.length === 1) return { status: "matched", player: filtered[0]!, candidates };
  return { status: "ambiguous", player: null, candidates };
}
