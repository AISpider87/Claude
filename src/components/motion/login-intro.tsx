"use client";

import { Suspense, useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import { WELCOME_PARAM } from "@/lib/auth/welcome";
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
 *
 * The sign-in redirect is a *client-side* navigation (a Server Action
 * `redirect()`), so the new URL is committed to `window.location` only after
 * this tree has rendered: the marker must be read through `useSearchParams`,
 * which already reflects the destination, never through `location.search`
 * during render — that is how the intro silently never played in production.
 */

/** If the stage chunk is not there in time, the intro is skipped altogether.
 * Generous on purpose: on a cold mobile connection the chunk can take a
 * second or more, and skipping the cinematic is worse than starting it late. */
const STAGE_BUDGET_MS = 2500;

type StageComponent = ComponentType<{ reduced?: boolean }>;

/**
 * Class on <html> that paints the same ground the cinematic uses, so the page
 * never flashes before the overlay is up. The inline script below adds it
 * before the first paint on a full load (and removes it by itself after 2.2 s
 * if JavaScript for the overlay never runs); on a client-side navigation
 * `LoginIntro` adds it when it arms. Removed when the wipe starts.
 */
const INTRO_CLASS = "intro-pending";

const INTRO_SCRIPT = `(function(){try{if(!/[?&]welcome=1(&|$)/.test(location.search))return;var r=document.documentElement;r.classList.add("${INTRO_CLASS}");setTimeout(function(){r.classList.remove("${INTRO_CLASS}")},2200)}catch(e){}})();`;

/** Rendered once at the top of the app shell; does nothing without the marker. */
export function IntroScript() {
  return <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />;
}

/**
 * Tiny store around the one-shot marker, in the same shape as the theme store:
 * the overlay is "armed" by the sign-in marker (or the replay button), and
 * whoever ends the cinematic (timer, tap, key) disarms it and notifies.
 */
const listeners = new Set<() => void>();
let armed = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getArmed(): boolean {
  return armed;
}

function notify() {
  for (const listener of listeners) listener();
}

function arm() {
  if (armed) return;
  armed = true;
  document.documentElement.classList.add(INTRO_CLASS);
  notify();
}

function disarm() {
  if (!armed) return;
  armed = false;
  notify();
}

/**
 * Plays the cinematic on demand — the "rivedi" button in Profilo. Useful to
 * show it to someone without signing out, and to check it after a deploy.
 */
export function replayIntro() {
  arm();
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

/** Arms the store from the sign-in marker and consumes it right away. */
function useWelcomeMarker() {
  const params = useSearchParams();
  const marker = params?.get(WELCOME_PARAM) === "1";
  useEffect(() => {
    if (!marker) return;
    arm();
    // Consume the marker straight away: a reload must never replay the intro.
    const url = new URL(window.location.href);
    url.searchParams.delete(WELCOME_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [marker]);
}

export function LoginIntro() {
  // useSearchParams needs a Suspense boundary above it for prerendering.
  return (
    <Suspense fallback={null}>
      <LoginIntroOverlay />
    </Suspense>
  );
}

function LoginIntroOverlay() {
  useWelcomeMarker();
  const reduced = usePrefersReducedMotion();
  // Server and first hydration render nothing; the overlay appears right after.
  const playing = useSyncExternalStore(subscribe, getArmed, () => false);

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
      {/* Plain ground until the stage chunk is here, so the page never shows
          through on a client-side navigation. */}
      {Stage ? <Stage reduced={reduced} /> : <div className="intro-ground absolute inset-0" />}
    </div>
  );
}
