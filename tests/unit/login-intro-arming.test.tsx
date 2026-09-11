// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-in redirect is a client-side navigation: when the destination tree
 * renders, window.location is still the login page. The marker must therefore
 * come from useSearchParams (the destination's params), not from location.
 */
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

// The stage chunk is irrelevant here: the overlay must appear before it loads.
vi.mock("@/components/motion/intro-stage", () => ({ IntroStage: () => null }));

import { LoginIntro } from "@/components/motion/login-intro";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  // A tap ends the cinematic (and disarms the module-level store for the next test).
  await act(async () => {
    window.dispatchEvent(new Event("pointerdown"));
  });
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.classList.remove("intro-pending");
});

describe("LoginIntro after a client-side sign-in redirect", () => {
  it("arms from the destination's search params even while location still says /login", async () => {
    window.history.replaceState(null, "", "/login?next=%2Frosa");
    params = new URLSearchParams("welcome=1");
    await act(async () => root.render(<LoginIntro />));
    expect(host.querySelector('[data-testid="login-intro"]')).not.toBeNull();
    // the ground is painted at once, before the stage chunk is there
    expect(document.documentElement.classList.contains("intro-pending")).toBe(true);
    // any tap ends it
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(host.querySelector('[data-testid="login-intro"]')).toBeNull();
    expect(document.documentElement.classList.contains("intro-pending")).toBe(false);
  });

  it("consumes the marker so a reload never replays it", async () => {
    window.history.replaceState(null, "", "/rosa?welcome=1&done=buy");
    params = new URLSearchParams("welcome=1&done=buy");
    await act(async () => root.render(<LoginIntro />));
    expect(window.location.search).toBe("?done=buy");
  });

  it("stays out of the way on a normal page load", async () => {
    window.history.replaceState(null, "", "/rosa");
    params = new URLSearchParams();
    await act(async () => root.render(<LoginIntro />));
    expect(host.querySelector('[data-testid="login-intro"]')).toBeNull();
  });
});
