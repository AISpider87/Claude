/**
 * Club kits for the procedural player avatars.
 *
 * Only colours and simple patterns: no crests, no sponsor marks, no official
 * artwork (docs/DESIGN.md). Colours are plain hex strings; the SVG adds a
 * theme-aware 1px outline so every jersey stays readable on dark and light.
 */

export type KitPattern = "solid" | "stripes" | "halves" | "hoops" | "sash";

export interface ClubKit {
  /** Main jersey colour (also the base of striped/halved shirts). */
  primary: string;
  /** Second colour: stripes, hoops, sash, half, or collar/cuff trim on solids. */
  secondary: string;
  pattern: KitPattern;
  shorts: string;
  /** Dashed outline for placeholders (players no longer in Serie A). */
  dashed?: boolean;
}

const WHITE = "#F3F4F6";
const BLACK = "#15171C";

/** Home colours of the 20 clubs in the 2026/27 listone, keyed by `players.team`. */
export const CLUB_KITS: Readonly<Record<string, ClubKit>> = {
  Atalanta: { primary: BLACK, secondary: "#1F5FC4", pattern: "stripes", shorts: BLACK },
  Bologna: { primary: "#B3122E", secondary: "#1E3F8F", pattern: "stripes", shorts: WHITE },
  Cagliari: { primary: "#C8102E", secondary: "#1B3A8C", pattern: "halves", shorts: "#1B3A8C" },
  Como: { primary: "#1F4FA3", secondary: WHITE, pattern: "solid", shorts: WHITE },
  Fiorentina: { primary: "#5B2A86", secondary: WHITE, pattern: "solid", shorts: "#5B2A86" },
  Frosinone: { primary: "#F2C81E", secondary: "#1E3A8A", pattern: "solid", shorts: "#1E3A8A" },
  Genoa: { primary: "#C8102E", secondary: "#1C3F94", pattern: "halves", shorts: "#1C3F94" },
  Inter: { primary: BLACK, secondary: "#1E56C8", pattern: "stripes", shorts: BLACK },
  Juventus: { primary: WHITE, secondary: BLACK, pattern: "stripes", shorts: WHITE },
  Lazio: { primary: "#8ED0F2", secondary: WHITE, pattern: "solid", shorts: WHITE },
  Lecce: { primary: "#F2C81E", secondary: "#C8102E", pattern: "stripes", shorts: "#1E3A8A" },
  Milan: { primary: "#D0112B", secondary: BLACK, pattern: "stripes", shorts: WHITE },
  Monza: { primary: "#D0112B", secondary: WHITE, pattern: "solid", shorts: WHITE },
  Napoli: { primary: "#1A9CE0", secondary: WHITE, pattern: "solid", shorts: WHITE },
  Parma: { primary: WHITE, secondary: "#1D4E9E", pattern: "sash", shorts: "#1D4E9E" },
  Roma: { primary: "#8E1B2A", secondary: "#F0A030", pattern: "solid", shorts: WHITE },
  Sassuolo: { primary: BLACK, secondary: "#0F9D58", pattern: "stripes", shorts: BLACK },
  Torino: { primary: "#8B1E3F", secondary: WHITE, pattern: "solid", shorts: WHITE },
  Udinese: { primary: BLACK, secondary: WHITE, pattern: "stripes", shorts: BLACK },
  Venezia: { primary: BLACK, secondary: "#F26522", pattern: "sash", shorts: BLACK },
};

/** Team value used by the rosters import for players outside Serie A. */
export const OUT_OF_SERIE_A_TEAM = "Fuori Serie A";

/** Grey kit for teams the listone does not know (e.g. a newly promoted club). */
export const NEUTRAL_KIT: ClubKit = {
  primary: "#6B7280",
  secondary: "#9CA3AF",
  pattern: "solid",
  shorts: "#4B5563",
};

/** Dashed grey kit for placeholders and out-of-list players. */
export const OUT_OF_LIST_KIT: ClubKit = {
  primary: "#6B7280",
  secondary: "#9CA3AF",
  pattern: "solid",
  shorts: "#4B5563",
  dashed: true,
};

/** Club names in listone order-independent alphabetical order. */
export const CLUB_NAMES: readonly string[] = Object.keys(CLUB_KITS).sort((a, b) =>
  a.localeCompare(b, "it"),
);

export function hasClubKit(team: string): boolean {
  return Object.hasOwn(CLUB_KITS, team.trim());
}

/** Kit for a `players.team` value; unknown clubs get the neutral grey kit. */
export function clubKit(team: string): ClubKit {
  const key = team.trim();
  if (key === OUT_OF_SERIE_A_TEAM) return OUT_OF_LIST_KIT;
  return CLUB_KITS[key] ?? NEUTRAL_KIT;
}
