import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { CLUB_KITS, clubKit, hasClubKit, NEUTRAL_KIT, OUT_OF_LIST_KIT } from "@/lib/avatar/clubs";
import rawOverrides from "@/lib/avatar/player-traits.json";
import { defaultTraits, traitOverridesSchema, traitsFor } from "@/lib/avatar/traits";
import { parseQuotationsWorkbook } from "@/lib/import/quotations-parser";

const FIXTURE = path.resolve(
  __dirname,
  "../../fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
);

const HEX = /^#[0-9A-F]{6}$/i;

describe("club kits", () => {
  it("every club in the fixture 'Tutti' sheet has a non-default kit", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    const teams = [...new Set(parsed.rows.map((r) => r.team))];
    expect(teams.length).toBe(20);
    for (const team of teams) {
      expect(hasClubKit(team), team).toBe(true);
      expect(clubKit(team), team).not.toBe(NEUTRAL_KIT);
      expect(clubKit(team).dashed, team).toBeUndefined();
    }
  });

  it("uses hex colours everywhere and falls back to grey / dashed kits", () => {
    for (const [club, kit] of Object.entries(CLUB_KITS)) {
      expect(kit.primary, club).toMatch(HEX);
      expect(kit.secondary, club).toMatch(HEX);
      expect(kit.shorts, club).toMatch(HEX);
    }
    expect(clubKit("Cremonese")).toBe(NEUTRAL_KIT);
    expect(clubKit("Fuori Serie A")).toBe(OUT_OF_LIST_KIT);
    expect(OUT_OF_LIST_KIT.dashed).toBe(true);
  });
});

describe("traits", () => {
  it("defaultTraits is deterministic", () => {
    for (const [id, name] of [
      [309, "Dybala"],
      [-4, "Segnaposto"],
      [7181, "Wesley"],
    ] as const) {
      expect(defaultTraits(id, name)).toEqual(defaultTraits(id, name));
    }
    expect(defaultTraits(1, "A")).not.toEqual(defaultTraits(2, "A"));
  });

  it("produces at least 4 hair styles across ids 1..50", () => {
    const hairs = new Set(Array.from({ length: 50 }, (_, i) => defaultTraits(i + 1, `P${i}`).hair));
    expect(hairs.size).toBeGreaterThanOrEqual(4);
    const skins = new Set(Array.from({ length: 50 }, (_, i) => defaultTraits(i + 1, `P${i}`).skin));
    expect(skins.size).toBeGreaterThanOrEqual(4);
  });

  it("traits JSON parses, every entry has a name and matches the fixture", async () => {
    const overrides = traitOverridesSchema.parse(rawOverrides);
    const ids = Object.keys(overrides);
    expect(ids.length).toBeGreaterThanOrEqual(40);
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    const byId = new Map(parsed.rows.map((r) => [String(r.id), r]));
    for (const id of ids) {
      const entry = overrides[id];
      expect(entry.name.length, id).toBeGreaterThan(0);
      expect(entry.approximate, id).toBe(true);
      expect(byId.get(id)?.name, `id ${id} (${entry.name}) in fixture`).toBe(entry.name);
    }
  });

  it("traitsFor merges the curated entry over the defaults", () => {
    const merged = traitsFor(309, "Dybala");
    expect(merged.beard).toBe("stubble");
    expect(merged.expression).toBe("smile");
    expect(merged.eyebrows).toBe("thick");
    expect(merged.hairLength).toBe("medium");
    expect(traitsFor(123456, "Nessuno")).toEqual(defaultTraits(123456, "Nessuno"));
  });

  it("v2 fields are always present and varied", () => {
    const all = Array.from({ length: 60 }, (_, i) => defaultTraits(i + 1, `P${i}`));
    for (const t of all) {
      expect(["thin", "thick"]).toContain(t.eyebrows);
      expect(["short", "medium", "long"]).toContain(t.hairLength);
      expect(["warm", "neutral", "cool"]).toContain(t.skinShade);
    }
    expect(new Set(all.map((t) => t.eyebrows)).size).toBe(2);
    expect(new Set(all.map((t) => t.hairLength)).size).toBe(3);
  });
});

describe("PlayerAvatar", () => {
  it("renders 10 avatars without duplicate element ids and with resolvable clip refs", () => {
    const html = renderToStaticMarkup(
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <PlayerAvatar key={i} id={i + 1} name={`Giocatore ${i}`} team="Inter" role="D" />
        ))}
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    // frame/head/jersey clips + skin, hair, jersey, floor and vignette gradients per avatar
    expect(ids.length).toBe(80);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of html.matchAll(/url\(#([^)]+)\)/g)) {
      expect(ids, m[1]).toContain(m[1]);
    }
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows the role letter and marks placeholders", () => {
    const real = renderToStaticMarkup(
      <PlayerAvatar id={5841} name="Svilar" team="Roma" role="P" size="xl" />,
    );
    expect(real).toContain('width="120"');
    expect(real).toMatch(/<text[^>]*>P<\/text>/);
    expect(real).not.toContain("fill-danger");
    // Half-bust: no ball, no legs; a rounded-square frame with the jersey clipped inside.
    expect(real).not.toContain('polygon points="69,89.2');
    expect(real).toContain('rx="24"');
    expect(real).toContain("<radialGradient");
    expect(real).toContain("<linearGradient");
    // Depth cues: floor shadow + vignette (theme opacity in CSS), no filters.
    expect(real).toContain('class="avatar-floor"');
    expect(real).toContain('class="avatar-vignette"');
    expect(real).not.toContain("<filter");

    const placeholder = renderToStaticMarkup(
      <PlayerAvatar id={-3} name="Partito" team="Fuori Serie A" role="A" size="xs" />,
    );
    expect(placeholder).toContain('width="32"');
    expect(placeholder).toContain("fill-danger");
    expect(placeholder).toContain("stroke-dasharray");
  });

  it("draws the club pattern and the role dot can be hidden", () => {
    const stripes = renderToStaticMarkup(
      <PlayerAvatar id={1870} name="Barella" team="Inter" role="C" showRole={false} />,
    );
    expect(stripes).not.toMatch(/<text/);
    expect((stripes.match(/<rect[^>]*height="44"/g) ?? []).length).toBe(6);
    const sash = renderToStaticMarkup(<PlayerAvatar id={1} name="Sash" team="Parma" role="D" />);
    expect(sash).toContain("<polygon");
    const halves = renderToStaticMarkup(<PlayerAvatar id={1} name="Half" team="Genoa" role="D" />);
    expect(halves).toMatch(/<rect x="50"[^>]*width="48"/);
  });
});
