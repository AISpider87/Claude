import { useId, type CSSProperties } from "react";
import { clubKit, OUT_OF_LIST_KIT, OUT_OF_SERIE_A_TEAM, type ClubKit } from "@/lib/avatar/clubs";
import { traitSeed, traitsFor, type PlayerTraits } from "@/lib/avatar/traits";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { cn } from "@/lib/utils";

/**
 * Procedural half-bust player avatar (v2): head, shoulders and the upper part
 * of the club jersey, cropped at the chest inside a rounded-square frame.
 * Pure SVG derived from `traits` + `clubKit`: no photos, no crests
 * (docs/DESIGN.md). Decorative — the surrounding text carries the name.
 *
 * Depth ("leggermente 3D", admin feedback) comes only from gradients and
 * translucent shapes — no filters, no blur — so it stays cheap at 48 px:
 * spherical head (radial light top-left, dark rim bottom-right), hair volume
 * with a rim light and a shadow under the hairline, fabric shading with a few
 * folds and an inner shadow under the collar, a cast shadow behind the bust,
 * a floor shadow and an inner vignette on the frame.
 */

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

/* Row lists use `sm` (40 px, the compact roster row), tiles `xs`. */
const SIZE_PX: Record<AvatarSize, number> = { xs: 32, sm: 40, md: 48, lg: 72, xl: 120 };

const SKIN_HEX: Record<PlayerTraits["skin"], string> = {
  1: "#F8E1CF",
  2: "#EFC9A8",
  3: "#D9A87C",
  4: "#B97A56",
  5: "#8D5A3C",
  6: "#5C3A26",
};

const HAIR_HEX: Record<PlayerTraits["hairColor"], string> = {
  black: "#1F1B1A",
  brown: "#5A3A22",
  blond: "#D8B25C",
  red: "#B5502A",
  grey: "#8A8F98",
  white: "#E8E8E8",
};

const ROLE_FILL: Record<RoleClassic, string> = {
  P: "fill-role-p",
  D: "fill-role-d",
  C: "fill-role-c",
  A: "fill-role-a",
};

const INK = "#15171C";
const EYE_WHITE = "#FBFBFC";
const IRIS_BROWN = "#3B2A1E";
const IRIS_BLUE = "#3F6E9E";

/* ---------- colour helpers (plain hex in, plain hex out) ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Linear mix of two hex colours: t = 0 → a, t = 1 → b. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

function skinPalette(traits: PlayerTraits) {
  let base = SKIN_HEX[traits.skin];
  if (traits.skinShade === "warm") base = mix(base, "#F59E0B", 0.09);
  if (traits.skinShade === "cool") base = mix(base, "#94A3B8", 0.1);
  return {
    base,
    light: mix(base, "#FFFFFF", 0.16),
    dark: mix(base, "#000000", 0.22),
    shadow: mix(base, "#000000", 0.32),
  };
}

function hairPalette(traits: PlayerTraits) {
  const base = HAIR_HEX[traits.hairColor];
  const dark = traits.hairColor === "black" ? "#000000" : mix(base, "#000000", 0.35);
  // Black hair gets a cool sheen instead of a grey wash.
  const light =
    traits.hairColor === "black" ? mix(base, "#7C93B8", 0.32) : mix(base, "#FFFFFF", 0.3);
  return { base, light, dark };
}

/* ---------- geometry (viewBox 0 0 100 100) ---------- */

const FRAME = { x: 1.5, y: 1.5, size: 97, rx: 24 };
const HEAD_PATH =
  "M33.5 35 C33.5 20 40 14.5 50 14.5 C60 14.5 66.5 20 66.5 35 C66.5 46.5 60.5 56.5 50 56.5 C39.5 56.5 33.5 46.5 33.5 35 Z";
const NECK_PATH = "M43 48 L43 61 C43 65.5 37 68 31 71 L69 71 C63 68 57 65.5 57 61 L57 48 Z";
const BODY_TAIL =
  "C69 65.5 75 68.5 80 72 C86 76.5 90 81.5 92 88 L92 100 L8 100 L8 88 C10 81.5 14 76.5 20 72 C25 68.5 31 65.5 38 64.5 Z";
const JERSEY_ROUND = `M38 64.5 C41 71.5 59 71.5 62 64.5 ${BODY_TAIL}`;
const JERSEY_V = `M38 64.5 L50 77 L62 64.5 ${BODY_TAIL}`;
const COLLAR_ROUND = "M38 64.5 C41 71.5 59 71.5 62 64.5";
const COLLAR_V = "M38 64.5 L50 77 L62 64.5";

/** Theme-aware thin outline: light ink on dark, dark ink on light. */
const OUTLINE = {
  stroke: "currentColor",
  strokeOpacity: 0.35,
  strokeWidth: 1,
  strokeLinejoin: "round",
} as const;

type Pt = [number, number];

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Hair cap: an arc over the head (with the volume set by `hairLength`) closed
 * by the hairline. `x0/x1` are the temples, `c` the control height of the arc.
 */
function capGeometry(traits: PlayerTraits) {
  const fade = traits.hair === "fade";
  const x0 = fade ? 36 : 31.5;
  const x1 = fade ? 64 : 68.5;
  const yTemple = fade ? 31 : 40;
  const volume = traits.hair === "long" ? "long" : traits.hairLength;
  const c = fade
    ? { short: 9, medium: 5, long: 1 }[volume]
    : { short: 6, medium: 2, long: -3 }[volume];
  const p0: Pt = [x0, yTemple];
  const p1: Pt = [x0, c];
  const p2: Pt = [x1, c];
  const p3: Pt = [x1, yTemple];
  const hairline = fade
    ? "C59 28.5 54 27.5 50 27.5 C46 27.5 41 28.5 36 31 Z"
    : traits.hair === "long"
      ? "C66 33 56 29 50 29 C44 29 34 33 31.5 40 Z"
      : "C63 31.5 56.5 28 50 28 C43.5 28 37 31.5 31.5 40 Z";
  const cap = `M${x0} ${yTemple} C${x0} ${c} ${x1} ${c} ${x1} ${yTemple} ${hairline}`;

  // Slivers that follow the arc, inset by `from`..`to` units: the two-tone
  // highlight on the top-left and a thinner rim light on the top-right.
  const sliver = (t0: number, t1: number, from: number, to: number) => {
    const outer: Pt[] = [];
    const inner: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = t0 + (i / 6) * (t1 - t0);
      const [x, y] = cubic(p0, p1, p2, p3, t);
      const dx = 50 - x;
      const dy = 42 - y;
      const len = Math.hypot(dx, dy) || 1;
      outer.push([x + (dx / len) * from, y + (dy / len) * from]);
      inner.push([x + (dx / len) * to, y + (dy / len) * to]);
    }
    return (
      `M${outer.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" L")} ` +
      `L${inner
        .reverse()
        .map(([x, y]) => `${fmt(x)} ${fmt(y)}`)
        .join(" L")} Z`
    );
  };
  const highlight = sliver(0.13, 0.43, 2.2, 5.2);
  const rim = sliver(0.62, 0.9, 0.9, 2.4);

  const bumps: Pt[] = [0.08, 0.22, 0.37, 0.5, 0.63, 0.78, 0.92].map((t) =>
    cubic(p0, p1, p2, p3, t),
  );
  return { cap, highlight, rim, bumps };
}

function Hair({
  traits,
  headClip,
  grad,
  layer,
}: {
  traits: PlayerTraits;
  headClip: string;
  /** Volume gradient (light top-left → dark bottom-right). */
  grad: string;
  layer: "back" | "front";
}) {
  if (traits.hair === "bald") {
    // A faint shaved shadow keeps the head from reading as a blank egg.
    return layer === "front" ? (
      <g clipPath={`url(#${headClip})`}>
        <path
          d="M33.5 36 C33.5 20 40 14.5 50 14.5 C60 14.5 66.5 20 66.5 36 C63 30 57 27.5 50 27.5 C43 27.5 37 30 33.5 36 Z"
          fill={INK}
          fillOpacity={0.08}
        />
      </g>
    ) : null;
  }
  const hair = hairPalette(traits);
  const { cap, highlight, rim, bumps } = capGeometry(traits);
  const fill = `url(#${grad})`;

  if (layer === "back") {
    if (traits.hair === "afro")
      return (
        <g fill={fill} {...OUTLINE}>
          <circle cx={50} cy={31} r={26} />
          {bumps.map(([x, y], i) => (
            <circle key={i} cx={fmt(x)} cy={fmt(y)} r={6} />
          ))}
        </g>
      );
    if (traits.hair === "long")
      return (
        <path
          d="M31.5 36 L32.5 62 C38 60.5 44 62 50 65 C56 62 62 60.5 67.5 62 L68.5 36 Z"
          fill={fill}
          {...OUTLINE}
        />
      );
    if (traits.hair === "bun") return <circle cx={50} cy={12.5} r={6} fill={fill} {...OUTLINE} />;
    if (traits.hair === "curly")
      return (
        <g fill={fill} {...OUTLINE}>
          {bumps.map(([x, y], i) => (
            <circle key={i} cx={fmt(x)} cy={fmt(y)} r={4.6} />
          ))}
        </g>
      );
    return null;
  }

  const buzz = traits.hair === "buzz";
  return (
    <g>
      {/* Shadow the hair casts on the forehead: the cap shifted down, under it. */}
      <path
        d={cap}
        transform="translate(0 2.8)"
        clipPath={`url(#${headClip})`}
        fill={INK}
        fillOpacity={buzz ? 0.1 : 0.18}
      />
      <path d={cap} fill={fill} fillOpacity={buzz ? 0.85 : 1} {...OUTLINE} />
      {!buzz && <path d={highlight} fill={hair.light} fillOpacity={0.7} />}
      {!buzz && <path d={rim} fill={hair.light} fillOpacity={0.45} />}
      {buzz && (
        <g stroke={hair.dark} strokeOpacity={0.5} strokeWidth={0.8} strokeLinecap="round">
          <path d="M40 22 L41 24.5 M46 18.5 L47 21 M54 18.5 L53 21 M60 22 L59 24.5" />
        </g>
      )}
      {(traits.hair === "curly" || traits.hair === "afro") && (
        <g fill="none" stroke={hair.dark} strokeOpacity={0.55} strokeWidth={0.9}>
          <path d="M38 27 a2.2 2.2 0 1 0 2 -2.5 M46 22 a2.2 2.2 0 1 0 2 -2.5 M55 22.5 a2.2 2.2 0 1 0 2 -2.5 M61 27 a2.2 2.2 0 1 0 2 -2.5" />
        </g>
      )}
    </g>
  );
}

function Beard({
  traits,
  headClip,
  grad,
}: {
  traits: PlayerTraits;
  headClip: string;
  grad: string;
}) {
  if (traits.beard === "none") return null;
  const hair = hairPalette(traits);
  const skin = skinPalette(traits);
  if (traits.beard === "goatee")
    return (
      <g fill={hair.base} {...OUTLINE} strokeOpacity={0.25}>
        <path d="M45 50.5 C45 56.5 55 56.5 55 50.5 C53 53 47 53 45 50.5 Z" />
        <path d="M45.5 47.6 C48 46 52 46 54.5 47.6 C52 48.6 48 48.6 45.5 47.6 Z" />
      </g>
    );
  const full = traits.beard === "full";
  return (
    <g clipPath={`url(#${headClip})`}>
      <path
        d="M33.5 40 C34 50 40 57 50 57 C60 57 66 50 66.5 40 C64 46.5 58 48.8 50 48.8 C42 48.8 36 46.5 33.5 40 Z"
        fill={full ? `url(#${grad})` : hair.base}
        fillOpacity={full ? 1 : 0.38}
      />
      {full && <ellipse cx={50} cy={51.3} rx={5.4} ry={2.4} fill={skin.base} />}
      <g
        stroke={full ? hair.dark : hair.base}
        strokeOpacity={full ? 0.55 : 0.55}
        strokeWidth={0.9}
        strokeLinecap="round"
      >
        <path d="M39 49 L39.8 52.5 M43 53 L43.6 56 M56.4 53 L55.8 56 M60.5 49 L59.8 52.5 M50 55 L50 57" />
      </g>
    </g>
  );
}

function Face({ traits, seed }: { traits: PlayerTraits; seed: number }) {
  const hair = hairPalette(traits);
  const browColor =
    traits.hairColor === "blond" || traits.hairColor === "white"
      ? mix(hair.base, "#000000", 0.45)
      : hair.dark;
  const browWidth = traits.eyebrows === "thick" ? 2.6 : 1.4;
  const brows =
    traits.expression === "focus"
      ? ["M38.5 32.2 L46.5 34.4", "M61.5 32.2 L53.5 34.4"]
      : traits.expression === "smile"
        ? ["M38.5 33.8 Q42.5 31 46.5 33", "M61.5 33.8 Q57.5 31 53.5 33"]
        : ["M38.5 33.4 L46.5 32.6", "M61.5 33.4 L53.5 32.6"];
  const iris = traits.skin <= 2 && (seed >>> 3) % 5 === 0 ? IRIS_BLUE : IRIS_BROWN;
  const lidY = traits.expression === "focus" ? 38.4 : 37.6;

  return (
    <g>
      {/* Cheekbone and nose shading (light from the top-left: right side darker). */}
      <g fill={INK}>
        <ellipse cx={40.5} cy={46} rx={5.5} ry={3.2} fillOpacity={0.05} />
        <ellipse cx={59.5} cy={46} rx={5.5} ry={3.2} fillOpacity={0.1} />
        <path
          d="M50.8 41 C52.1 43.8 52.9 45.8 52.5 47.3 C51.6 48 50.7 47.9 50.2 47.3 C50.8 45.3 50.8 43.1 50.8 41 Z"
          fillOpacity={0.12}
        />
        <ellipse cx={50.2} cy={48.9} rx={2.3} ry={0.7} fillOpacity={0.12} />
      </g>
      {/* Eyebrows */}
      <g stroke={browColor} strokeWidth={browWidth} strokeLinecap="round" fill="none">
        <path d={brows[0]} />
        <path d={brows[1]} />
      </g>
      {/* Eyes: whites, iris, pupil, highlight, upper lid */}
      {[43.5, 56.5].map((cx) => (
        <g key={cx}>
          <ellipse
            cx={cx}
            cy={39.2}
            rx={3.4}
            ry={2.5}
            fill={EYE_WHITE}
            stroke={INK}
            strokeOpacity={0.45}
            strokeWidth={0.6}
          />
          <circle cx={cx} cy={39.4} r={1.9} fill={iris} />
          <circle cx={cx} cy={39.4} r={0.95} fill={INK} />
          <circle cx={cx - 0.7} cy={38.6} r={0.55} fill={EYE_WHITE} />
          <path
            d={`M${cx - 3.4} ${lidY + 0.6} Q${cx} ${lidY - 1.4} ${cx + 3.4} ${lidY + 0.6}`}
            fill="none"
            stroke={INK}
            strokeWidth={1}
            strokeLinecap="round"
          />
        </g>
      ))}
      {/* Nose */}
      <path
        d="M50.6 40.5 C49.6 43.5 48.6 45.5 48.2 47.2 C49 48.3 51.2 48.3 52 47.2"
        fill="none"
        stroke={INK}
        strokeOpacity={0.55}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      {/* Mouth */}
      <g fill="none" stroke={INK} strokeLinecap="round">
        {traits.expression === "smile" && (
          <>
            <path d="M45.2 51 C47 54.6 53 54.6 54.8 51" strokeWidth={1.4} />
            <path d="M46.5 51.4 C48 52.2 52 52.2 53.5 51.4" strokeWidth={0.8} strokeOpacity={0.5} />
          </>
        )}
        {traits.expression === "neutral" && <path d="M46 51.6 L54 51.6" strokeWidth={1.3} />}
        {traits.expression === "focus" && (
          <path d="M45.8 52 C47.5 51.2 52.5 51.2 54.2 52" strokeWidth={1.6} />
        )}
      </g>
      {traits.glasses && (
        <g fill="none" stroke={INK} strokeWidth={1.2}>
          <circle cx={43.5} cy={39.2} r={5} />
          <circle cx={56.5} cy={39.2} r={5} />
          <path d="M48.5 39.2 L51.5 39.2 M38.5 38.5 L34 37 M61.5 38.5 L66 37" />
        </g>
      )}
    </g>
  );
}

function Jersey({
  kit,
  clip,
  shade,
  collar,
}: {
  kit: ClubKit;
  clip: string;
  shade: string;
  collar: "round" | "v";
}) {
  const body = collar === "v" ? JERSEY_V : JERSEY_ROUND;
  const collarPath = collar === "v" ? COLLAR_V : COLLAR_ROUND;
  return (
    <>
      <path
        d={body}
        fill={kit.primary}
        fillOpacity={kit.dashed ? 0.55 : 1}
        {...OUTLINE}
        strokeOpacity={kit.dashed ? 0.7 : OUTLINE.strokeOpacity}
        strokeDasharray={kit.dashed ? "2 1.5" : undefined}
      />
      <g clipPath={`url(#${clip})`}>
        {kit.pattern === "stripes" && (
          <g fill={kit.secondary}>
            {[17.5, 30.5, 43.5, 56.5, 69.5, 82.5].map((cx) => (
              <rect key={cx} x={cx - 3.25} y={58} width={6.5} height={44} />
            ))}
          </g>
        )}
        {kit.pattern === "hoops" && (
          <g fill={kit.secondary}>
            {[73, 85, 97].map((y) => (
              <rect key={y} x={4} y={y} width={92} height={5.5} />
            ))}
          </g>
        )}
        {kit.pattern === "halves" && (
          <rect x={50} y={58} width={48} height={44} fill={kit.secondary} />
        )}
        {kit.pattern === "sash" && (
          <polygon points="26,69 80,100 66,111 12,80" fill={kit.secondary} />
        )}
        {/* Sleeve seams; solid kits get the second colour as trim. */}
        <g
          fill="none"
          stroke={kit.pattern === "solid" && !kit.dashed ? kit.secondary : "currentColor"}
          strokeOpacity={kit.pattern === "solid" && !kit.dashed ? 0.95 : 0.3}
          strokeWidth={kit.pattern === "solid" && !kit.dashed ? 2.2 : 1}
          strokeLinecap="round"
        >
          <path d="M22 70.5 C19.5 78 17.5 88 17 101" />
          <path d="M78 70.5 C80.5 78 82.5 88 83 101" />
        </g>
        {/* Fabric volume: lit on the upper-left chest, darker at the sides and under the arms. */}
        <rect x={0} y={56} width={100} height={46} fill={`url(#${shade})`} />
        {/* Sleeve shadows along the seams (heavier on the far side) and a rim light on the near shoulder. */}
        <g fill={INK}>
          <path
            d="M22 70.5 C19.5 78 17.5 88 17 101 L21 101 C21.5 88 23.5 78 26 71.5 Z"
            fillOpacity={0.12}
          />
          <path
            d="M78 70.5 C80.5 78 82.5 88 83 101 L79 101 C78.5 88 76.5 78 74 71.5 Z"
            fillOpacity={0.2}
          />
        </g>
        <path
          d="M13 77.5 C18 71.5 27 66.5 38 64.5"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity={0.22}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        {/* Folds: under the collar and from the armpits toward the chest. */}
        <g fill="none" stroke={INK} strokeLinecap="round" strokeWidth={1}>
          <path d="M44 79 C47 81 53 81 56 79" strokeOpacity={0.14} />
          <path d="M31 83 C36 88 40 94 41 101" strokeOpacity={0.1} />
          <path d="M69 83 C64 88 60 94 59 101" strokeOpacity={0.14} />
        </g>
        {/* Inner shadow under the collar band */}
        <path
          d={collarPath}
          transform="translate(0 2.4)"
          fill="none"
          stroke={INK}
          strokeOpacity={0.26}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {/* Collar */}
      <path
        d={collarPath}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={4.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={collarPath}
        fill="none"
        stroke={kit.dashed ? kit.secondary : kit.secondary}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={kit.dashed ? "2 1.5" : undefined}
      />
      {/* Sheen on the collar band */}
      <path
        d={collarPath}
        transform="translate(0 -0.5)"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.22}
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export interface PlayerAvatarProps {
  /** Fantacalcio id (negative for placeholders created by the rosters import). */
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  outOfList?: boolean;
  size?: AvatarSize;
  /** Role dot with the letter in the bottom-right corner (default on). */
  showRole?: boolean;
  /** Idle bob, only when the viewer allows motion (default on). */
  idle?: boolean;
  className?: string;
}

export function PlayerAvatar({
  id,
  name,
  team,
  role,
  outOfList = false,
  size = "md",
  showRole = true,
  idle = true,
  className,
}: PlayerAvatarProps) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const frameClip = `${uid}-f`;
  const headClip = `${uid}-h`;
  const jerseyClip = `${uid}-j`;
  const skinGrad = `${uid}-s`;
  const shadeGrad = `${uid}-g`;
  const hairGrad = `${uid}-r`;
  const floorGrad = `${uid}-o`;
  const vignetteGrad = `${uid}-v`;
  const placeholder = outOfList || team === OUT_OF_SERIE_A_TEAM;
  const kit = placeholder ? OUT_OF_LIST_KIT : clubKit(team);
  const traits = traitsFor(id, name);
  const seed = traitSeed(id, name);
  const skin = skinPalette(traits);
  const hair = hairPalette(traits);
  const collar: "round" | "v" = (seed >>> 9) % 3 === 0 ? "v" : "round";
  const px = SIZE_PX[size];
  // Desync the bob across a grid of avatars.
  const idleStyle: CSSProperties | undefined = idle
    ? { animationDelay: `-${seed % 3200}ms` }
    : undefined;
  const earsInFront = traits.hair !== "long" && traits.hair !== "afro";

  const ears = (
    <g fill={skin.base} {...OUTLINE}>
      <ellipse cx={33} cy={39} rx={3.2} ry={4.4} />
      <ellipse cx={67} cy={39} rx={3.2} ry={4.4} />
      {/* Concha shading: the far ear sits in the shadow of the head. */}
      <g stroke="none">
        <ellipse cx={33.4} cy={39.8} rx={2} ry={3} fill={skin.dark} fillOpacity={0.45} />
        <ellipse cx={66.6} cy={39.8} rx={2} ry={3} fill={skin.shadow} fillOpacity={0.6} />
      </g>
      <g fill="none" stroke={INK} strokeOpacity={0.35} strokeWidth={0.8}>
        <path d="M32.4 36.8 C34.2 36.6 34.6 39.2 33.2 41.2" />
        <path d="M67.6 36.8 C65.8 36.6 65.4 39.2 66.8 41.2" />
      </g>
    </g>
  );

  return (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      className={cn("avatar-tilt text-foreground shrink-0 overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <clipPath id={frameClip}>
          <rect
            x={FRAME.x + 0.5}
            y={FRAME.y + 0.5}
            width={FRAME.size - 1}
            height={FRAME.size - 1}
            rx={FRAME.rx - 0.5}
          />
        </clipPath>
        <clipPath id={headClip}>
          <path d={HEAD_PATH} />
        </clipPath>
        <clipPath id={jerseyClip}>
          <path d={collar === "v" ? JERSEY_V : JERSEY_ROUND} />
        </clipPath>
        {/* Head as a sphere: light top-left, base, dark rim bottom-right. */}
        <radialGradient id={skinGrad} cx="38%" cy="28%" r="82%">
          <stop offset="0" stopColor={skin.light} />
          <stop offset="0.38" stopColor={skin.base} />
          <stop offset="0.82" stopColor={skin.dark} />
          <stop offset="1" stopColor={skin.shadow} />
        </radialGradient>
        <linearGradient id={hairGrad} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={mix(hair.base, hair.light, 0.45)} />
          <stop offset="0.45" stopColor={hair.base} />
          <stop offset="1" stopColor={hair.dark} />
        </linearGradient>
        {/* Fabric: lit on the upper-left chest, darker toward the sides and the bottom. */}
        <radialGradient id={shadeGrad} cx="40%" cy="22%" r="78%">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.2} />
          <stop offset="0.38" stopColor="#FFFFFF" stopOpacity={0} />
          <stop offset="0.72" stopColor="#000000" stopOpacity={0.1} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.42} />
        </radialGradient>
        <radialGradient id={floorGrad}>
          <stop offset="0" stopColor="#000000" stopOpacity={0.7} />
          <stop offset="1" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={vignetteGrad} cx="50%" cy="42%" r="70%">
          <stop offset="0.55" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.65} />
        </radialGradient>
      </defs>

      <rect
        x={FRAME.x}
        y={FRAME.y}
        width={FRAME.size}
        height={FRAME.size}
        rx={FRAME.rx}
        className="fill-surface-2"
      />

      <g clipPath={`url(#${frameClip})`}>
        {/* Floor shadow: the bust "stands" in the frame (opacity per theme in globals.css). */}
        <ellipse
          cx={50}
          cy={96}
          rx={52}
          ry={22}
          fill={`url(#${floorGrad})`}
          className="avatar-floor"
        />
        {/* The bust is drawn around (50, 40) and enlarged to fill the frame. */}
        <g className={idle ? "avatar-idle" : undefined} style={idleStyle}>
          <g transform="translate(-7 -3.5) scale(1.14)">
            {/* Cast shadow of the bust, offset away from the light. */}
            <g transform="translate(2.2 2.6)" fill={INK} opacity={0.26}>
              <path d={collar === "v" ? JERSEY_V : JERSEY_ROUND} />
              <path d={NECK_PATH} />
              <path d={HEAD_PATH} />
            </g>
            <Hair traits={traits} headClip={headClip} grad={hairGrad} layer="back" />
            {/* Neck + trapezius, shaded under the chin (two bands: a soft falloff) */}
            <path d={NECK_PATH} fill={skin.dark} {...OUTLINE} />
            <path
              d="M43 48 L57 48 L57 59 C54 61.5 46 61.5 43 59 Z"
              fill={skin.shadow}
              fillOpacity={0.4}
            />
            <path
              d="M43 48 L57 48 L57 53.5 C54 55.5 46 55.5 43 53.5 Z"
              fill={skin.shadow}
              fillOpacity={0.5}
            />
            <Jersey kit={kit} clip={jerseyClip} shade={shadeGrad} collar={collar} />
            {!earsInFront && ears}
            {/* Head */}
            <path d={HEAD_PATH} fill={`url(#${skinGrad})`} {...OUTLINE} />
            {earsInFront && ears}
            <Beard traits={traits} headClip={headClip} grad={hairGrad} />
            <Hair traits={traits} headClip={headClip} grad={hairGrad} layer="front" />
            {traits.headband && (
              <g clipPath={`url(#${headClip})`}>
                <rect x={28} y={26.5} width={44} height={4.6} fill="#F3F4F6" {...OUTLINE} />
                <rect x={28} y={29.9} width={44} height={1.2} fill={INK} fillOpacity={0.18} />
              </g>
            )}
            <Face traits={traits} seed={seed} />
          </g>
        </g>
        {/* Inner vignette: darker edges pull the figure into the frame. */}
        <rect
          x={FRAME.x}
          y={FRAME.y}
          width={FRAME.size}
          height={FRAME.size}
          fill={`url(#${vignetteGrad})`}
          className="avatar-vignette"
        />
      </g>

      {/* Theme-aware frame outline, on top of the vignette. */}
      <rect
        x={FRAME.x}
        y={FRAME.y}
        width={FRAME.size}
        height={FRAME.size}
        rx={FRAME.rx}
        fill="none"
        className="stroke-line"
        strokeWidth={1}
      />

      {showRole && (
        <g>
          <circle cx={85} cy={85} r={9.5} className={ROLE_FILL[role]} {...OUTLINE} />
          <text
            x={85}
            y={85}
            dy="0.36em"
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            className="fill-on-primary font-display"
          >
            {role}
          </text>
        </g>
      )}

      {placeholder && (
        <g>
          <circle cx={86} cy={14} r={8.5} className="fill-danger" {...OUTLINE} />
          <path
            d="M83 11 L89 17 M89 11 L83 17"
            className="stroke-on-primary"
            strokeWidth={1.9}
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}
