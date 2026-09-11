"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { EMBLEM_RUN, EMBLEM_SHIELD } from "@/components/brand/logo";
import {
  INTRO_EMBLEM,
  INTRO_END,
  INTRO_IMPACT,
  INTRO_REDUCED_END,
  INTRO_TRAVEL,
  INTRO_WIPE,
  INTRO_WORD,
} from "@/components/motion/intro-timing";

/**
 * Choreography of the sign-in cinematic, loaded on demand by `LoginIntro` so
 * the animation code never reaches the pages that do not play it: a comet ball
 * curves in from the lower left on our cyan → white → ember heat ramp, hits the
 * centre, the shockwave opens and the SuperLega emblem draws itself in the
 * flash; then the whole thing wipes upward on a diagonal.
 */

const T = {
  travel: INTRO_TRAVEL,
  impact: INTRO_IMPACT,
  emblem: INTRO_EMBLEM,
  word: INTRO_WORD,
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

const TRAIL = [0, 1, 2, 3, 4, 5, 6, 7, 8];

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
  const travel = { duration: T.travel, ease: [0.4, 0, 0.3, 1] as const, times: PATH_T };
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
          duration: T.travel + 0.3,
          delay: 0.06,
          ease: "linear",
          pathLength: {
            duration: T.travel + 0.08,
            delay: 0.1,
            ease: [0.45, 0, 0.3, 1],
            times: [0, 0.999, 1],
          },
          opacity: { duration: T.travel + 0.3, delay: 0.06, times: [0, 0.25, 0.72, 1] },
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
            opacity: [0, 0.85 - i * 0.07, 0.6 - i * 0.06, 0],
          }}
          transition={{
            ...travel,
            delay: 0.06 + i * 0.022,
            opacity: {
              duration: T.travel + 0.12,
              delay: 0.06 + i * 0.022,
              times: [0, 0.18, 0.72, 1],
            },
          }}
        />
      ))}
      {/* The ball itself: white core, ember mantle, cyan rim. */}
      <motion.circle
        cx={0}
        cy={0}
        r={17}
        fill={`url(#${ballId})`}
        initial={{ x: PATH_X[0], y: PATH_Y[0] }}
        animate={{ x: PATH_X, y: PATH_Y, opacity: [1, 1, 1, 0] }}
        transition={{
          ...travel,
          delay: 0.06,
          opacity: { duration: 0.62, delay: 0.06, times: [0, 0.85, 0.94, 1] },
        }}
      />
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
            duration: 0.75 + i * 0.2,
            delay: T.impact + i * 0.09,
            ease: "easeOut",
            times: [0, 1],
            opacity: {
              duration: 0.75 + i * 0.2,
              delay: T.impact + i * 0.09,
              times: [0, 0.15, 1],
            },
          }}
        />
      ))}
    </g>
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

  if (reduced) {
    // Still fallback: the emblem, one short fade, nothing that moves.
    return (
      <motion.div
        className="intro-ground absolute inset-0 flex items-center justify-center"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: REDUCED_END, ease: "linear" }}
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
            transition={{ duration: 0.5, delay: T.impact, ease: "easeOut", times: [0, 0.18, 1] }}
          />
        </svg>

        {/* Emblem drawing itself in the flash, then the wordmark */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <svg viewBox="0 0 64 64" className="size-24 sm:size-28" aria-hidden focusable="false">
            <motion.polygon
              points={EMBLEM_SHIELD}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="3.5"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{
                duration: 0.42,
                delay: T.emblem,
                ease: "easeInOut",
                opacity: { duration: 0.12, delay: T.emblem },
              }}
            />
            <motion.path
              d={EMBLEM_RUN}
              fill="none"
              stroke="var(--ember)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{
                duration: 0.32,
                delay: T.emblem + 0.2,
                ease: "easeOut",
                opacity: { duration: 0.1, delay: T.emblem + 0.2 },
              }}
            />
          </svg>
          <motion.p
            className="font-display text-foreground text-xl font-bold uppercase sm:text-2xl"
            initial={{ opacity: 0, y: 10, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "0.16em" }}
            transition={{ duration: 0.4, delay: T.word, ease: "easeOut" }}
          >
            Super<span className="text-primary">Lega</span>
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
