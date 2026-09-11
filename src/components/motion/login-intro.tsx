"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { shouldPlayIntro, WELCOME_PARAM } from "@/lib/auth/welcome";
import { INTRO_END, INTRO_REDUCED_END, INTRO_WIPE } from "@/components/motion/intro-timing";

/**
 * One-shot cinematic played right after a sign-in, over the first authenticated
 * page (`src/components/motion/intro-stage.tsx` holds the choreography).
 *
 * Rules it keeps: the page renders underneath (nothing is delayed), any tap or
 * key skips it, it is `aria-hidden` and never takes focus, it plays once per
 * sign-in (the `?welcome=1` the sign-in redirect adds is consumed immediately
 * with `history.replaceState`, so a reload or a normal navigation never replays
 * it) and `prefers-reduced-motion` gets a still 200 ms fade instead.
 */

/** If the stage chunk is not there in time, the intro is skipped altogether. */
const STAGE_BUDGET_MS = 1200;

type StageComponent = ComponentType<{ reduced?: boolean }>;

/**
 * Class the inline script below puts on <html> before the first paint, so the
 * page never flashes while React hydrates: it paints the same ground the
 * cinematic uses. `LoginIntro` removes it when the wipe starts, and the script
 * removes it by itself after 2.2 s if JavaScript for the overlay never runs.
 */
const INTRO_CLASS = "intro-pending";

const INTRO_SCRIPT = `(function(){try{if(!/[?&]welcome=1(&|$)/.test(location.search))return;var r=document.documentElement;r.classList.add("${INTRO_CLASS}");setTimeout(function(){r.classList.remove("${INTRO_CLASS}")},2200)}catch(e){}})();`;

/** Rendered once at the top of the app shell; does nothing without the marker. */
export function IntroScript() {
  return <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />;
}

/**
 * Tiny store around the one-shot marker, in the same shape as the theme store:
 * the overlay is "armed" when the sign-in marker is in the URL, and whoever
 * ends the cinematic (timer, tap, key) disarms it and notifies the subscribers.
 */
const listeners = new Set<() => void>();
let armed: boolean | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isArmed(): boolean {
  if (armed === null) armed = shouldPlayIntro(window.location.search);
  return armed;
}

function disarm() {
  if (!armed) return;
  armed = false;
  for (const listener of listeners) listener();
}

/**
 * Plays the cinematic on demand — the "rivedi" button in Profilo. Useful to
 * show it to someone without signing out, and to check it after a deploy.
 */
export function replayIntro() {
  armed = true;
  document.documentElement.classList.add(INTRO_CLASS);
  for (const listener of listeners) listener();
}

/** `prefers-reduced-motion`, without pulling a motion library into the shell. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function LoginIntro() {
  const reduced = usePrefersReducedMotion();
  // Server and first hydration render nothing; the overlay appears right after.
  const playing = useSyncExternalStore(subscribe, isArmed, () => false);

  useEffect(() => {
    if (!playing) return;
    // Consume the marker straight away: a reload must never replay the intro.
    const url = new URL(window.location.href);
    url.searchParams.delete(WELCOME_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [playing]);

  // The choreography (and framer-motion with it) is loaded only when the
  // cinematic actually plays, so no other page pays for it. The timers start
  // when the stage is on screen, so the wipe can never run ahead of it.
  const [Stage, setStage] = useState<StageComponent | null>(null);

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const giveUp = window.setTimeout(() => {
      if (!cancelled) {
        document.documentElement.classList.remove(INTRO_CLASS);
        disarm();
      }
    }, STAGE_BUDGET_MS);
    void import("@/components/motion/intro-stage").then((mod) => {
      if (cancelled) return;
      window.clearTimeout(giveUp);
      setStage(() => mod.IntroStage as StageComponent);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
    };
  }, [playing]);

  useEffect(() => {
    if (!playing || !Stage) return;
    const root = document.documentElement;
    // The pre-paint ground goes away when the curtain starts wiping, so the
    // page below is already there to be revealed.
    const reveal = () => root.classList.remove(INTRO_CLASS);
    const stop = () => {
      reveal();
      disarm();
    };
    const wipe = window.setTimeout(reveal, (reduced ? 0 : INTRO_WIPE) * 1000);
    const timer = window.setTimeout(stop, (reduced ? INTRO_REDUCED_END : INTRO_END) * 1000);
    // Always skippable: any tap, click or key ends it now.
    window.addEventListener("pointerdown", stop, { once: true });
    window.addEventListener("keydown", stop, { once: true });
    return () => {
      reveal();
      window.clearTimeout(wipe);
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [playing, reduced, Stage]);

  if (!playing) return null;

  return (
    <div
      aria-hidden
      className="intro-overlay fixed inset-0 z-50 overflow-hidden"
      data-testid="login-intro"
    >
      {Stage && <Stage reduced={reduced} />}
    </div>
  );
}
