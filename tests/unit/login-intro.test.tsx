import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntroStage } from "@/components/motion/intro-stage";
import { LoginIntro } from "@/components/motion/login-intro";
import {
  INTRO_BEAT,
  INTRO_EMBLEM,
  INTRO_END,
  INTRO_PULSE,
  INTRO_WIPE,
  INTRO_WORD,
} from "@/components/motion/intro-timing";
import { shouldPlayIntro, withWelcome } from "@/lib/auth/welcome";

describe("login intro flag", () => {
  it("plays only for the marker the sign-in redirect adds", () => {
    expect(shouldPlayIntro("")).toBe(false);
    expect(shouldPlayIntro("?done=buy")).toBe(false);
    expect(shouldPlayIntro("?welcome=0")).toBe(false);
    expect(shouldPlayIntro("?welcome=1")).toBe(true);
    expect(shouldPlayIntro("?done=buy&welcome=1")).toBe(true);
  });

  it("marks a destination keeping the query it already has", () => {
    expect(withWelcome("/rosa")).toBe("/rosa?welcome=1");
    expect(withWelcome("/mercato?done=buy")).toBe("/mercato?done=buy&welcome=1");
  });
});

describe("LoginIntro", () => {
  it("renders nothing without the marker (server render, normal page load)", () => {
    expect(renderToStaticMarkup(<LoginIntro />)).toBe("");
  });

  it("under reduced motion renders the still emblem, no comet", () => {
    const html = renderToStaticMarkup(<IntroStage reduced />);
    expect(html).toContain('data-intro="static"');
    expect(html).toContain("<polygon");
    expect(html).not.toContain("<ellipse");
    expect(html).not.toContain("<filter");
  });

  it("holds the emblem on screen long enough to see it beat", () => {
    // The admin asked for a cinematic that lasts and a logo that stays and
    // pulses: the beat has to start well before the curtain wipes.
    expect(INTRO_END).toBeGreaterThan(3.5);
    expect(INTRO_PULSE).toBeLessThan(INTRO_WIPE);
    expect(INTRO_WIPE - INTRO_PULSE).toBeGreaterThan(INTRO_BEAT);
    expect(INTRO_WORD).toBeGreaterThan(INTRO_EMBLEM);
  });

  it("with motion allowed renders the comet, the shockwave and the emblem", () => {
    const html = renderToStaticMarkup(<IntroStage />);
    expect(html).toContain('data-intro="cinematic"');
    expect(html).toContain("<ellipse");
    expect(html).toContain("<filter");
    expect(html).toContain("SuperLega".slice(0, 5));
    // The emblem is a stack of faces in depth, not a flat drawing.
    expect(html.match(/intro-emblem-face/g)?.length ?? 0).toBeGreaterThan(3);
    expect(html).toContain("translateZ");
    expect(html).toContain("intro-floor");
    expect(html).toContain("/intro/backdrop.webp");
    // Decorative overlay: never announced, never focusable.
    expect(html).toContain('focusable="false"');
  });
});
