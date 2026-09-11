/**
 * One-shot marker for the post-login cinematic: the sign-in redirect adds
 * `?welcome=1` to its destination and `LoginIntro` consumes it on mount
 * (history.replaceState), so a reload or a normal navigation never replays it.
 */
export const WELCOME_PARAM = "welcome";

/** "/rosa" → "/rosa?welcome=1", "/mercato?done=buy" → "…&welcome=1". */
export function withWelcome(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${WELCOME_PARAM}=1`;
}

export function shouldPlayIntro(search: string): boolean {
  return new URLSearchParams(search).get(WELCOME_PARAM) === "1";
}
