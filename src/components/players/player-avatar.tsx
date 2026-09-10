import { useId, type CSSProperties } from "react";
import { clubKit, OUT_OF_LIST_KIT, OUT_OF_SERIE_A_TEAM, type ClubKit } from "@/lib/avatar/clubs";
import { traitSeed, traitsFor, type PlayerTraits } from "@/lib/avatar/traits";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { cn } from "@/lib/utils";

/**
 * Procedural "chibi" player avatar: big head, small body, club-coloured
 * jersey, football at the feet, role dot above the head. Pure SVG, no photos,
 * no crests (docs/DESIGN.md). Decorative: the surrounding text carries the name.
 */

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AvatarSize, number> = { sm: 32, md: 48, lg: 72, xl: 120 };

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
const BOOT = "#111827";

/* Geometry (viewBox 0 0 100 100). */
const HEAD = { cx: 50, cy: 40, r: 19 };
const JERSEY_PATH = "M38 59 L62 59 L71 65 L68 75 L63 73 L63 82 L37 82 L37 73 L32 75 L29 65 Z";

/** Theme-aware 1px outline: light ink on dark, dark ink on light. */
const OUTLINE = {
  stroke: "currentColor",
  strokeOpacity: 0.35,
  strokeWidth: 1,
  strokeLinejoin: "round",
} as const;

function Hair({
  traits,
  clip,
  layer,
}: {
  traits: PlayerTraits;
  clip: string;
  layer: "back" | "front";
}) {
  const fill = HAIR_HEX[traits.hairColor];
  const { hair } = traits;
  if (hair === "bald") return null;

  if (layer === "back") {
    if (hair === "afro") return <circle cx={50} cy={37} r={26} fill={fill} {...OUTLINE} />;
    if (hair === "long")
      return (
        <path
          d="M31 34 Q31 17 50 17 Q69 17 69 34 L69 63 Q60 59 50 64 Q40 59 31 63 Z"
          fill={fill}
          {...OUTLINE}
        />
      );
    if (hair === "curly")
      return (
        <g fill={fill} {...OUTLINE}>
          <circle cx={33} cy={28} r={5} />
          <circle cx={41} cy={22} r={5} />
          <circle cx={50} cy={20} r={5} />
          <circle cx={59} cy={22} r={5} />
          <circle cx={67} cy={28} r={5} />
        </g>
      );
    if (hair === "bun") return <circle cx={50} cy={19} r={5.5} fill={fill} {...OUTLINE} />;
    return null;
  }

  // Front layer: the cap clipped to the head, with a hairline per style.
  let cap: string;
  let opacity = 1;
  switch (hair) {
    case "buzz":
      cap = "M28 40 L28 18 L72 18 L72 40 Q61 31 50 32 Q39 31 28 40 Z";
      opacity = 0.75;
      break;
    case "fade":
      cap = "M35 34 L35 18 L65 18 L65 34 Q58 30 50 31 Q42 30 35 34 Z";
      break;
    case "curly":
    case "afro":
      cap = "M28 42 L28 18 L72 18 L72 42 Q61 35 50 36 Q39 35 28 42 Z";
      break;
    default:
      cap = "M28 42 L28 18 L72 18 L72 42 Q61 33 50 34 Q39 33 28 42 Z";
  }
  return (
    <g clipPath={`url(#${clip})`}>
      <path d={cap} fill={fill} fillOpacity={opacity} />
    </g>
  );
}

function Beard({ traits, clip }: { traits: PlayerTraits; clip: string }) {
  if (traits.beard === "none") return null;
  const fill = HAIR_HEX[traits.hairColor];
  if (traits.beard === "goatee") return <ellipse cx={50} cy={55.5} rx={4.5} ry={3.5} fill={fill} />;
  const full = traits.beard === "full";
  return (
    <g clipPath={`url(#${clip})`}>
      <path
        d="M30 45 Q40 48 50 47 Q60 48 70 45 L70 62 L30 62 Z"
        fill={fill}
        fillOpacity={full ? 1 : 0.32}
      />
      {full && <ellipse cx={50} cy={50.5} rx={5.5} ry={2.6} fill={SKIN_HEX[traits.skin]} />}
    </g>
  );
}

function Face({ traits }: { traits: PlayerTraits }) {
  return (
    <g stroke={INK} strokeWidth={1.4} strokeLinecap="round" fill="none">
      <circle cx={43} cy={42} r={1.9} fill={INK} stroke="none" />
      <circle cx={57} cy={42} r={1.9} fill={INK} stroke="none" />
      {traits.expression === "focus" && (
        <>
          <path d="M39 37.5 L46.5 39.5" />
          <path d="M61 37.5 L53.5 39.5" />
          <path d="M46 51 L54 51" strokeWidth={1.7} />
        </>
      )}
      {traits.expression === "smile" && <path d="M45.5 49 Q50 54 54.5 49" />}
      {traits.expression === "neutral" && <path d="M46.5 50.5 L53.5 50.5" />}
      {traits.glasses && (
        <g strokeWidth={1.2}>
          <circle cx={43} cy={42} r={4.6} />
          <circle cx={57} cy={42} r={4.6} />
          <path d="M47.6 42 L52.4 42" />
        </g>
      )}
    </g>
  );
}

function Jersey({ kit, clip }: { kit: ClubKit; clip: string }) {
  const stripes = kit.pattern === "stripes" && (
    <g fill={kit.secondary}>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={31.1 + i * 8.4} y={55} width={4.2} height={30} />
      ))}
    </g>
  );
  const hoops = kit.pattern === "hoops" && (
    <g fill={kit.secondary}>
      {[62, 70, 78].map((y) => (
        <rect key={y} x={25} y={y} width={50} height={4} />
      ))}
    </g>
  );
  return (
    <>
      <path
        d={JERSEY_PATH}
        fill={kit.primary}
        fillOpacity={kit.dashed ? 0.55 : 1}
        {...OUTLINE}
        strokeOpacity={kit.dashed ? 0.7 : OUTLINE.strokeOpacity}
        strokeDasharray={kit.dashed ? "2 1.5" : undefined}
      />
      <g clipPath={`url(#${clip})`}>
        {stripes}
        {hoops}
        {kit.pattern === "halves" && (
          <rect x={50} y={55} width={25} height={30} fill={kit.secondary} />
        )}
        {kit.pattern === "sash" && (
          <polygon points="26,63 36,57 74,79 66,86" fill={kit.secondary} />
        )}
        {!kit.dashed && (
          <g stroke={kit.secondary} strokeWidth={2.4} fill="none" strokeLinecap="round">
            <path d="M44.5 59 L50 64 L55.5 59" />
            <path d="M29.5 66 L32.5 74.5" />
            <path d="M70.5 66 L67.5 74.5" />
          </g>
        )}
      </g>
    </>
  );
}

function Ball() {
  return (
    <g>
      <circle cx={69} cy={92} r={5.5} fill="#F8FAFC" {...OUTLINE} strokeOpacity={0.6} />
      <g fill={INK}>
        <polygon points="69,89.2 71,90.7 70.2,93 67.8,93 67,90.7" />
        <circle cx={65.2} cy={91} r={1} />
        <circle cx={72.8} cy={91} r={1} />
        <circle cx={69} cy={96.2} r={1} />
      </g>
    </g>
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
  /** Role dot with the letter above the head (default on). */
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
  const headClip = `${uid}-h`;
  const jerseyClip = `${uid}-j`;
  const placeholder = outOfList || team === OUT_OF_SERIE_A_TEAM;
  const kit = placeholder ? OUT_OF_LIST_KIT : clubKit(team);
  const traits = traitsFor(id, name);
  const skin = SKIN_HEX[traits.skin];
  const px = SIZE_PX[size];
  // Desync the bob across a grid of avatars.
  const idleStyle: CSSProperties | undefined = idle
    ? { animationDelay: `-${traitSeed(id, name) % 3200}ms` }
    : undefined;

  return (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      className={cn("text-foreground shrink-0 overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <clipPath id={headClip}>
          <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} />
        </clipPath>
        <clipPath id={jerseyClip}>
          <path d={JERSEY_PATH} />
        </clipPath>
      </defs>

      <circle cx={50} cy={50} r={48} className="fill-surface-2 stroke-line" strokeWidth={1} />

      <g className={idle ? "avatar-idle" : undefined} style={idleStyle}>
        {/* Legs, socks and boots */}
        <rect x={39} y={88} width={8} height={5} fill={kit.shorts} />
        <rect x={53} y={88} width={8} height={5} fill={kit.shorts} />
        <rect x={38} y={92.5} width={10} height={4} rx={1.5} fill={BOOT} />
        <rect x={52} y={92.5} width={10} height={4} rx={1.5} fill={BOOT} />
        <Ball />
        {/* Shorts */}
        <rect x={37} y={81} width={26} height={8} rx={1} fill={kit.shorts} {...OUTLINE} />
        {/* Hands */}
        <circle cx={31.5} cy={78.5} r={3} fill={skin} {...OUTLINE} />
        <circle cx={68.5} cy={78.5} r={3} fill={skin} {...OUTLINE} />
        {/* Neck */}
        <rect x={46} y={55} width={8} height={7} fill={skin} />
        <Jersey kit={kit} clip={jerseyClip} />
        {/* Head */}
        <Hair traits={traits} clip={headClip} layer="back" />
        <circle cx={31.5} cy={42} r={3.5} fill={skin} {...OUTLINE} />
        <circle cx={68.5} cy={42} r={3.5} fill={skin} {...OUTLINE} />
        <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={skin} {...OUTLINE} />
        <Beard traits={traits} clip={headClip} />
        <Hair traits={traits} clip={headClip} layer="front" />
        {traits.headband && (
          <g clipPath={`url(#${headClip})`}>
            <rect x={28} y={29.5} width={44} height={4.2} fill="#F3F4F6" {...OUTLINE} />
          </g>
        )}
        <Face traits={traits} />
      </g>

      {showRole && (
        <g>
          <circle cx={50} cy={11} r={8} className={ROLE_FILL[role]} {...OUTLINE} />
          <text
            x={50}
            y={11}
            dy="0.36em"
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            className="fill-on-primary font-display"
          >
            {role}
          </text>
        </g>
      )}

      {placeholder && (
        <g>
          <path d="M100 0 L100 24 L76 0 Z" className="fill-danger" />
          <path
            d="M89.5 4 L95.5 10 M95.5 4 L89.5 10"
            className="stroke-on-primary"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}
