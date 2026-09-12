/**
 * Slow ambient drift behind the app: two soft lights that cross the screen over
 * about a minute, so a page that is standing still never feels dead.
 *
 * Decorative only — fixed, `aria-hidden`, no pointer events, behind everything
 * — and cheap: two composited layers moved with `transform`, nothing repaints.
 * `prefers-reduced-motion` keeps the lights and drops the movement.
 */
export function AmbientBackdrop() {
  return (
    <div className="ambient" aria-hidden>
      <span className="ambient-glow ambient-glow-a" />
      <span className="ambient-glow ambient-glow-b" />
    </div>
  );
}
