/**
 * Timing of the sign-in cinematic, shared by the overlay (which owns the
 * timers) and the stage (which owns the choreography), in seconds.
 *
 * The whole thing lasts ~4 s on purpose: the emblem has to arrive, settle and
 * then *stay* on screen beating a few times before the curtain wipes. Any tap
 * or key skips it, so nobody is ever held there.
 */
export const INTRO_TRAVEL = 1.05;
export const INTRO_IMPACT = 1.12;
export const INTRO_EMBLEM = 1.24;
export const INTRO_WORD = 1.85;
/** The emblem stops moving and starts beating (repeats until the wipe). */
export const INTRO_PULSE = 2.15;
export const INTRO_BEAT = 1.3;
export const INTRO_WIPE = 3.55;
export const INTRO_END = 4.2;

/** Reduced motion: one calm fade of the emblem instead of the whole thing. */
export const INTRO_REDUCED_END = 0.9;
