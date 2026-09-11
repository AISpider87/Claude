import { z } from "zod";
import rawOverrides from "./player-traits.json";

/**
 * Facial traits for the procedural avatars. Defaults come from a deterministic
 * hash of id + name (so the same player always gets the same face); a small
 * hand-curated JSON can override single fields for well-known players.
 */

export const SKIN_TONES = [1, 2, 3, 4, 5, 6] as const;
export const HAIR_STYLES = [
  "short",
  "buzz",
  "curly",
  "long",
  "bald",
  "afro",
  "bun",
  "fade",
] as const;
export const HAIR_COLORS = ["black", "brown", "blond", "red", "grey", "white"] as const;
export const BEARDS = ["none", "stubble", "full", "goatee"] as const;
export const EXPRESSIONS = ["neutral", "smile", "focus"] as const;
export const EYEBROWS = ["thin", "thick"] as const;
/** Volume of the hair on top: how far the cap rises above the head. */
export const HAIR_LENGTHS = ["short", "medium", "long"] as const;
/** Undertone of the skin, a subtle hue shift over the base tone. */
export const SKIN_SHADES = ["warm", "neutral", "cool"] as const;

export type SkinTone = (typeof SKIN_TONES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];
export type Beard = (typeof BEARDS)[number];
export type Expression = (typeof EXPRESSIONS)[number];
export type Eyebrows = (typeof EYEBROWS)[number];
export type HairLength = (typeof HAIR_LENGTHS)[number];
export type SkinShade = (typeof SKIN_SHADES)[number];

export interface PlayerTraits {
  skin: SkinTone;
  hair: HairStyle;
  hairColor: HairColor;
  beard: Beard;
  glasses?: boolean;
  headband?: boolean;
  expression: Expression;
  eyebrows: Eyebrows;
  hairLength: HairLength;
  skinShade: SkinShade;
}

const traitsPartialSchema = z.object({
  skin: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  hair: z.enum(HAIR_STYLES),
  hairColor: z.enum(HAIR_COLORS),
  beard: z.enum(BEARDS),
  glasses: z.boolean(),
  headband: z.boolean(),
  expression: z.enum(EXPRESSIONS),
  eyebrows: z.enum(EYEBROWS),
  hairLength: z.enum(HAIR_LENGTHS),
  skinShade: z.enum(SKIN_SHADES),
});

/** One entry of `player-traits.json`, keyed by Fantacalcio id. */
export const traitOverrideSchema = traitsPartialSchema.partial().extend({
  name: z.string().min(1),
  /** Always true: curated entries are a rough likeness, never a portrait. */
  approximate: z.literal(true),
});

export const traitOverridesSchema = z.record(z.string().regex(/^-?\d+$/), traitOverrideSchema);

export type TraitOverride = z.infer<typeof traitOverrideSchema>;

let overridesCache: Record<string, TraitOverride> | null = null;

/** Curated overrides, validated once (the JSON is static, but Zod keeps it honest). */
export function traitOverrides(): Record<string, TraitOverride> {
  overridesCache ??= traitOverridesSchema.parse(rawOverrides);
  return overridesCache;
}

/** FNV-1a 32-bit over the id + name; stable across runtimes. */
export function traitSeed(playerId: number, name: string): number {
  const input = `${playerId}:${name.trim().toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Tiny seeded PRNG (mulberry32) so each trait draws from an independent slice. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(next: () => number, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = next() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}

/* Weights keep faces varied but plausible for professional footballers. */
const HAIR_WEIGHTS: readonly (readonly [HairStyle, number])[] = [
  ["short", 34],
  ["buzz", 16],
  ["curly", 14],
  ["fade", 14],
  ["long", 8],
  ["afro", 6],
  ["bun", 4],
  ["bald", 4],
];
const HAIR_COLOR_WEIGHTS: readonly (readonly [HairColor, number])[] = [
  ["black", 42],
  ["brown", 36],
  ["blond", 12],
  ["red", 4],
  ["grey", 3],
  ["white", 3],
];
const BEARD_WEIGHTS: readonly (readonly [Beard, number])[] = [
  ["none", 40],
  ["stubble", 32],
  ["full", 16],
  ["goatee", 12],
];
const EXPRESSION_WEIGHTS: readonly (readonly [Expression, number])[] = [
  ["neutral", 40],
  ["smile", 35],
  ["focus", 25],
];
const HAIR_LENGTH_WEIGHTS: readonly (readonly [HairLength, number])[] = [
  ["short", 50],
  ["medium", 38],
  ["long", 12],
];
const SKIN_SHADE_WEIGHTS: readonly (readonly [SkinShade, number])[] = [
  ["warm", 40],
  ["neutral", 40],
  ["cool", 20],
];

/** Deterministic default face for a player: same id + name → same traits. */
export function defaultTraits(playerId: number, name: string): PlayerTraits {
  const next = rng(traitSeed(playerId, name));
  const skin = SKIN_TONES[Math.min(5, Math.floor(next() * 6))];
  const hair = weighted(next, HAIR_WEIGHTS);
  // Bald heads and very dark skin rarely pair with blond/red hair in practice.
  let hairColor = weighted(next, HAIR_COLOR_WEIGHTS);
  if (skin >= 5 && (hairColor === "blond" || hairColor === "red")) hairColor = "black";
  const beard = weighted(next, BEARD_WEIGHTS);
  const glasses = next() < 0.03;
  const headband = next() < 0.05;
  const expression = weighted(next, EXPRESSION_WEIGHTS);
  // New draws stay after the v1 ones so v1 faces are unchanged.
  const eyebrows: Eyebrows = next() < 0.45 ? "thick" : "thin";
  const hairLength = weighted(next, HAIR_LENGTH_WEIGHTS);
  const skinShade = weighted(next, SKIN_SHADE_WEIGHTS);
  const traits: PlayerTraits = {
    skin,
    hair,
    hairColor,
    beard,
    expression,
    eyebrows,
    hairLength,
    skinShade,
  };
  if (glasses) traits.glasses = true;
  if (headband) traits.headband = true;
  return traits;
}

/** Default traits merged with the curated JSON entry for this id, if any. */
export function traitsFor(playerId: number, name: string): PlayerTraits {
  const base = defaultTraits(playerId, name);
  const o = traitOverrides()[String(playerId)];
  if (!o) return base;
  return {
    skin: o.skin ?? base.skin,
    hair: o.hair ?? base.hair,
    hairColor: o.hairColor ?? base.hairColor,
    beard: o.beard ?? base.beard,
    expression: o.expression ?? base.expression,
    eyebrows: o.eyebrows ?? base.eyebrows,
    hairLength: o.hairLength ?? base.hairLength,
    skinShade: o.skinShade ?? base.skinShade,
    ...((o.glasses ?? base.glasses) ? { glasses: true } : {}),
    ...((o.headband ?? base.headband) ? { headband: true } : {}),
  };
}
