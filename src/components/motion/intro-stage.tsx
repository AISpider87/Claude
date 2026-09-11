"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { EMBLEM_RUN, EMBLEM_SHIELD } from "@/components/brand/logo";
import {
  INTRO_BEAT,
  INTRO_EMBLEM,
  INTRO_END,
  INTRO_IMPACT,
  INTRO_PULSE,
  INTRO_REDUCED_END,
  INTRO_TRAVEL,
  INTRO_WIPE,
  INTRO_WORD,
} from "@/components/motion/intro-timing";

/**
 * Choreography of the sign-in cinematic, loaded on demand by `LoginIntro` so
 * the animation code never reaches the pages that do not play it.
 *
 * The run: the rendered vortex backdrop pushes in slowly, a perspective floor
 * rushes toward the camera, a comet ball curves in
 * from the lower left growing as it comes at us, the impact opens a shockwave
 * and throws embers out of the screen, and the SuperLeague emblem swings in on a
 * 3D turn — a stack of layers in `preserve-3d`, so it has real thickness — and
 * then *stays*, beating like a heart with its halo until the curtain wipes.
 */

const T = {
  travel: INTRO_TRAVEL,
  impact: INTRO_IMPACT,
  emblem: INTRO_EMBLEM,
  word: INTRO_WORD,
  pulse: INTRO_PULSE,
  beat: INTRO_BEAT,
  wipe: INTRO_WIPE,
  end: INTRO_END,
} as const;

const REDUCED_END = INTRO_REDUCED_END;

/* Curved run of the ball across the 400×400 stage: the keyframes are samples
   of `STREAK` (same cubic), so ball, tail and streak share one trajectory. */
const STREAK = "M-70 486 C 30 400 120 320 200 200";
const PATH_X = [-70, 6, 72, 138, 200];
const PATH_Y = [486, 423, 357, 284, 200];
const PATH_T = [0, 0.25, 0.5, 0.75, 1];
/* …and it grows on the way in: it is coming at the camera, not sliding. */
const PATH_SCALE = [0.42, 0.56, 0.72, 0.88, 1.08];

const TRAIL = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Embers thrown out of the impact, straight past the camera. */
const SPARKS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2 + (i % 3) * 0.19;
  const reach = 150 + (i % 5) * 46;
  return {
    x: Math.cos(angle) * reach,
    y: Math.sin(angle) * reach * 0.86,
    r: 2.4 + (i % 4) * 1.1,
    delay: (i % 6) * 0.035,
    duration: 0.75 + (i % 5) * 0.12,
  };
});

/** The emblem is stacked this many times in depth to fake an extrusion. */
const DEPTH = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function Comet({
  glowId,
  ballId,
  trailId,
  streakId,
}: {
  glowId: string;
  ballId: string;
  trailId: string;
  streakId: string;
}) {
  const travel = { duration: T.travel, ease: [0.36, 0, 0.24, 1] as const, times: PATH_T };
  return (
    <g filter={`url(#${glowId})`}>
      {/* Plasma streak: drawn along the run, then burnt off by the impact. */}
      <motion.path
        d={STREAK}
        fill="none"
        stroke={`url(#${streakId})`}
        strokeWidth={10}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: [0, 1, 1], opacity: [0, 0.9, 0.9, 0] }}
        transition={{
          duration: T.travel + 0.42,
          delay: 0.08,
          ease: "linear",
          pathLength: {
            duration: T.travel + 0.08,
            delay: 0.12,
            ease: [0.4, 0, 0.24, 1],
            times: [0, 0.999, 1],
          },
          opacity: { duration: T.travel + 0.42, delay: 0.08, times: [0, 0.22, 0.74, 1] },
        }}
      />
      {/* Ember tail: the same run, each ellipse a frame late and dimmer. */}
      {TRAIL.map((i) => (
        <motion.ellipse
          key={i}
          cx={0}
          cy={0}
          rx={22 - i * 1.8}
          ry={14 - i * 1.2}
          fill={`url(#${trailId})`}
          initial={{ x: PATH_X[0], y: PATH_Y[0], opacity: 0 }}
          animate={{
            x: PATH_X,
            y: PATH_Y,
            scale: PATH_SCALE,
            opacity: [0, 0.85 - i * 0.07, 0.6 - i * 0.06, 0],
          }}
          transition={{
            ...travel,
            delay: 0.08 + i * 0.03,
            scale: { ...travel, delay: 0.08 + i * 0.03 },
            opacity: {
              duration: T.travel + 0.16,
              delay: 0.08 + i * 0.03,
              times: [0, 0.18, 0.74, 1],
            },
          }}
        />
      ))}
      {/* The ball itself: white core, ember mantle, cyan rim, and a highlight
          that slides across it as it turns. */}
      <motion.g
        initial={{ x: PATH_X[0], y: PATH_Y[0], scale: PATH_SCALE[0] }}
        animate={{ x: PATH_X, y: PATH_Y, scale: PATH_SCALE, opacity: [1, 1, 1, 0] }}
        transition={{
          ...travel,
          delay: 0.08,
          opacity: { duration: T.travel + 0.1, delay: 0.08, times: [0, 0.86, 0.95, 1] },
        }}
      >
        <circle cx={0} cy={0} r={17} fill={`url(#${ballId})`} />
        <motion.ellipse
          cx={0}
          cy={0}
          rx={6}
          ry={4.2}
          fill="var(--intro-core)"
          opacity={0.85}
          initial={{ x: -7, y: -6 }}
          animate={{ x: [-7, 4, -5], y: [-6, -2, -7] }}
          transition={{ duration: T.travel, delay: 0.08, ease: "easeInOut" }}
        />
      </motion.g>
    </g>
  );
}

function Shockwave() {
  return (
    <g fill="none">
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={200}
          cy={200}
          r={18}
          opacity={0}
          stroke="var(--primary)"
          strokeWidth={3.5 - i}
          initial={{ scale: 0.2, opacity: 0 }}
          animate={{ scale: [0.2, 5 + i * 2.5], opacity: [0, 0.9, 0] }}
          style={{ transformOrigin: "200px 200px" }}
          transition={{
            duration: 0.9 + i * 0.22,
            delay: T.impact + i * 0.1,
            ease: "easeOut",
            times: [0, 1],
            opacity: {
              duration: 0.9 + i * 0.22,
              delay: T.impact + i * 0.1,
              times: [0, 0.15, 1],
            },
          }}
        />
      ))}
    </g>
  );
}

/** Embers blown out of the impact — they grow as they pass the camera. */
function Sparks({ trailId }: { trailId: string }) {
  return (
    <g>
      {SPARKS.map((s, i) => (
        <motion.circle
          key={i}
          cx={200}
          cy={200}
          r={s.r}
          fill={`url(#${trailId})`}
          initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
          animate={{ x: s.x, y: s.y, scale: [0.2, 1.6, 2.4], opacity: [0, 1, 0] }}
          transition={{
            duration: s.duration,
            delay: T.impact + s.delay,
            ease: "easeOut",
            opacity: {
              duration: s.duration,
              delay: T.impact + s.delay,
              times: [0, 0.22, 1],
            },
          }}
        />
      ))}
    </g>
  );
}

/**
 * One copy of the emblem. `depth` 0 is the face (it draws itself); the copies
 * behind it are pushed back in Z and dimmed, which is what gives the shield
 * its thickness once the container turns.
 */
function EmblemFace({ depth, sheenId }: { depth: number; sheenId?: string }) {
  const face = depth === 0;
  return (
    <div className="intro-emblem-face" style={{ transform: `translateZ(${-depth * 3.4}px)` }}>
      <motion.svg
        viewBox="0 0 64 64"
        className="intro-emblem-svg"
        aria-hidden
        focusable="false"
        initial={{ opacity: 0 }}
        animate={{ opacity: face ? 1 : 0.62 - depth * 0.055 }}
        transition={{ duration: 0.2, delay: T.emblem + (face ? 0 : 0.22) }}
      >
        <motion.polygon
          points={EMBLEM_SHIELD}
          fill="none"
          stroke={face ? "var(--primary)" : "var(--primary-strong)"}
          strokeWidth={face ? 3.5 : 4.2}
          strokeLinejoin="round"
          initial={face ? { pathLength: 0 } : false}
          animate={face ? { pathLength: 1 } : undefined}
          transition={{ duration: 0.5, delay: T.emblem, ease: "easeInOut" }}
        />
        <motion.path
          d={EMBLEM_RUN}
          fill="none"
          stroke="var(--ember)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={face ? { pathLength: 0, opacity: 0 } : { opacity: 0.6 }}
          animate={face ? { pathLength: 1, opacity: 0.95 } : undefined}
          transition={{
            duration: 0.38,
            delay: T.emblem + 0.24,
            ease: "easeOut",
            opacity: { duration: 0.12, delay: T.emblem + 0.24 },
          }}
        />
        {/* Specular sheen sweeping inside the shield, in time with the beat. */}
        {face && sheenId && (
          <>
            <defs>
              <clipPath id={`${sheenId}-clip`}>
                <polygon points={EMBLEM_SHIELD} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${sheenId}-clip)`}>
              <motion.rect
                x={0}
                y={-10}
                width={26}
                height={84}
                fill={`url(#${sheenId})`}
                opacity={0.5}
                initial={{ x: -40 }}
                animate={{ x: [-40, 78] }}
                transition={{
                  duration: 0.85,
                  delay: T.pulse,
                  repeat: Infinity,
                  repeatDelay: Math.max(T.beat - 0.85, 0),
                  ease: "easeInOut",
                }}
              />
            </g>
          </>
        )}
      </motion.svg>
    </div>
  );
}

/** The whole stage; exported so tests can render both variants without a DOM. */
export function IntroStage({ reduced = false }: { reduced?: boolean }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const glowId = `${uid}-glow`;
  const ballId = `${uid}-ball`;
  const trailId = `${uid}-trail`;
  const flashId = `${uid}-flash`;
  const streakId = `${uid}-streak`;
  const sheenId = `${uid}-sheen`;

  if (reduced) {
    // Still fallback: the emblem, one calm fade, nothing that moves.
    return (
      <motion.div
        className="intro-ground absolute inset-0 flex items-center justify-center"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: REDUCED_END, ease: "linear", delay: REDUCED_END * 0.45 }}
        data-intro="static"
      >
        <svg viewBox="0 0 64 64" className="size-24" aria-hidden focusable="false">
          <polygon
            points={EMBLEM_SHIELD}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path
            d={EMBLEM_RUN}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.6"
          />
        </svg>
      </motion.div>
    );
  }

  return (
    <motion.div
      data-intro="cinematic"
      className="intro-curtain"
      initial={{ y: 0 }}
      animate={{ y: "-135%" }}
      transition={{ duration: T.end - T.wipe, delay: T.wipe, ease: [0.7, 0, 0.3, 1] }}
    >
      <div className="intro-ground absolute inset-0 overflow-hidden">
        {/* Rendered backdrop (public/intro/backdrop.webp, generated with
            Higgsfield, 38 KB): a slow push-in through the vortex for the whole
            run. Dark theme only, see globals.css. */}
        <motion.img
          src="/intro/backdrop.webp"
          alt=""
          aria-hidden
          draggable={false}
          className="intro-backdrop"
          initial={{ opacity: 0, scale: 1.28 }}
          animate={{ opacity: 0.82, scale: 1.04 }}
          transition={{
            opacity: { duration: 0.5, ease: "easeOut" },
            scale: { duration: T.end, ease: [0.2, 0.6, 0.3, 1] },
          }}
        />
        {/* Dark pool in the middle of the render, so the emblem and the
            wordmark read over the rings. */}
        <div className="intro-shade" aria-hidden />
        {/* Perspective floor rushing toward the camera (pure CSS, see globals). */}
        <div className="intro-floor" aria-hidden />

        {/* Square stage centred on the viewport: the ball keeps its shape at
            every aspect ratio, and the plain ground fills whatever is left. */}
        <svg
          viewBox="0 0 400 400"
          preserveAspectRatio="xMidYMid meet"
          className="intro-stage"
          aria-hidden
          focusable="false"
        >
          <defs>
            <radialGradient id={ballId}>
              <stop offset="0%" stopColor="var(--intro-core)" />
              <stop offset="28%" stopColor="var(--intro-core)" />
              <stop offset="48%" stopColor="var(--ember)" />
              <stop offset="78%" stopColor="var(--primary)" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={trailId}>
              <stop offset="0%" stopColor="var(--ember)" />
              <stop offset="55%" stopColor="var(--primary)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={streakId} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
              <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.8" />
              <stop offset="88%" stopColor="var(--ember)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--intro-core)" />
            </linearGradient>
            <radialGradient id={flashId}>
              <stop offset="0%" stopColor="var(--intro-core)" />
              <stop offset="30%" stopColor="var(--ember)" stopOpacity="0.75" />
              <stop offset="65%" stopColor="var(--primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </radialGradient>
            {/* One short-lived blur on one group: the only filter of the app. */}
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>

          <Comet glowId={glowId} ballId={ballId} trailId={trailId} streakId={streakId} />
          <Shockwave />
          <Sparks trailId={trailId} />

          {/* Impact flash */}
          <motion.circle
            cx={200}
            cy={200}
            r={200}
            opacity={0}
            fill={`url(#${flashId})`}
            initial={{ opacity: 0, scale: 0.25 }}
            animate={{ opacity: [0, 0.95, 0], scale: [0.25, 1.15] }}
            style={{ transformOrigin: "200px 200px" }}
            transition={{ duration: 0.6, delay: T.impact, ease: "easeOut", times: [0, 0.16, 1] }}
          />
        </svg>

        {/* Emblem: swings in on a 3D turn, then stays and beats. */}
        <div className="intro-scene absolute inset-0 flex flex-col items-center justify-center gap-5">
          <div className="intro-emblem-slot">
            {/* Halo breathing with the beat, behind the shield. */}
            <motion.span
              aria-hidden
              className="intro-halo-ring"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: [0, 0.85, 0.55], scale: [0.5, 1.25, 1] }}
              transition={{ duration: 0.6, delay: T.emblem, ease: "easeOut" }}
            >
              <motion.span
                className="intro-halo-inner"
                animate={{ opacity: [0.45, 0.95, 0.5, 0.8, 0.45], scale: [1, 1.2, 1.02, 1.14, 1] }}
                transition={{
                  duration: T.beat,
                  delay: T.pulse,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.16, 0.34, 0.5, 1],
                }}
              />
            </motion.span>

            {/* One ring pushed out on every beat — the heartbeat made visible. */}
            <motion.span
              aria-hidden
              className="intro-beat-ring"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: [0.55, 0.35, 0], scale: [0.92, 1.35, 1.7] }}
              transition={{
                duration: T.beat,
                delay: T.pulse,
                repeat: Infinity,
                ease: "easeOut",
                times: [0, 0.45, 1],
              }}
            />

            {/* Entrance: the turn, the fall toward the camera, the settle. */}
            <motion.div
              className="intro-emblem-3d"
              initial={{ rotateY: -78, rotateX: 26, scale: 0.5, opacity: 0, z: -220 }}
              animate={{ rotateY: [-78, 10, 0], rotateX: [26, -6, 0], scale: 1, opacity: 1, z: 0 }}
              transition={{
                duration: 0.86,
                delay: T.emblem,
                ease: [0.16, 0.8, 0.24, 1],
                opacity: { duration: 0.18, delay: T.emblem },
              }}
            >
              {/* The beat: it stays on screen and pulses until the wipe. */}
              <motion.div
                className="intro-emblem-beat"
                animate={{
                  scale: [1, 1.1, 0.99, 1.06, 1],
                  rotateY: [0, 15, 0, -15, 0],
                  rotateX: [0, -5, 0, 5, 0],
                }}
                transition={{
                  duration: T.beat,
                  delay: T.pulse,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, 0.16, 0.34, 0.5, 1],
                  rotateY: {
                    duration: T.beat * 2,
                    delay: T.pulse,
                    repeat: Infinity,
                    ease: "easeInOut",
                  },
                  rotateX: {
                    duration: T.beat * 2,
                    delay: T.pulse,
                    repeat: Infinity,
                    ease: "easeInOut",
                  },
                }}
              >
                <svg width="0" height="0" aria-hidden focusable="false">
                  <defs>
                    <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0.6">
                      <stop offset="0%" stopColor="var(--intro-core)" stopOpacity="0" />
                      <stop offset="50%" stopColor="var(--intro-core)" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="var(--intro-core)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
                {DEPTH.map((d) => (
                  <EmblemFace key={d} depth={d} sheenId={d === 0 ? sheenId : undefined} />
                ))}
              </motion.div>
            </motion.div>
          </div>

          <motion.p
            className="intro-wordmark font-display text-foreground text-xl font-bold uppercase sm:text-2xl"
            initial={{ opacity: 0, y: 14, letterSpacing: "0.5em", filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "0.16em", filter: "blur(0px)" }}
            transition={{ duration: 0.55, delay: T.word, ease: [0.16, 0.8, 0.24, 1] }}
          >
            The Super<span className="text-primary">League</span>
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
