import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/DESIGN.md promises WCAG AA contrast in both themes. Tokens are read from
 * globals.css so the check follows any palette change.
 */
const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const block =
    css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
  return out;
}

const dark = tokens(":root");
const light = { ...dark, ...tokens(":root.light") };

function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text tokens rendered at body/small sizes (links, nav labels, badges, hints).
const TEXT = ["text", "text-muted", "primary", "danger", "role-p", "role-d", "role-c", "role-a"];
const GROUNDS = ["bg", "surface", "surface-2"];

describe.each([
  ["dark", dark],
  ["light", light],
])("%s theme text contrast (WCAG AA, 4.5:1)", (_name, t) => {
  it("defines every token", () => {
    for (const k of [...TEXT, ...GROUNDS]) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(TEXT.flatMap((fg) => GROUNDS.map((bg) => [fg, bg])))("%s on %s", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("button label on primary-strong", () => {
    expect(contrast(t["on-primary"], t["primary-strong"])).toBeGreaterThanOrEqual(4.5);
  });
});
