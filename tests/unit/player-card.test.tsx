import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerCard } from "@/components/players/player-card";

/** The initials live in the hexagon: `<span class="relative">XY</span>`. */
function initialsOf(name: string) {
  const html = renderToStaticMarkup(
    <PlayerCard
      name={name}
      team="Roma"
      role="D"
      qtA={10}
      qtI={9}
      diff={1}
      fvm={null}
      availability="free"
    />,
  );
  const m = html.match(/<span class="relative">([^<]*)<\/span>/);
  return m?.[1] ?? "";
}

describe("PlayerCard initials", () => {
  it("uses surname + first-name initial for Fantacalcio.it names", () => {
    expect(initialsOf("Martinez L.")).toBe("ML");
    expect(initialsOf("Milinkovic-Savic V.")).toBe("MV");
    expect(initialsOf("De Martis")).toBe("DM");
    expect(initialsOf("Kean")).toBe("KE");
  });

  it("never shows punctuation for apostrophe names present in the real listone (N'Dri, N'Dicka)", () => {
    for (const name of ["N'Dri", "N'Dicka", "Dell'Orco", "O'Riley"]) {
      const ini = initialsOf(name);
      expect(ini, name).toMatch(/^\p{L}{2}$/u);
    }
    expect(initialsOf("N'Dri")).toBe("ND");
  });
});
