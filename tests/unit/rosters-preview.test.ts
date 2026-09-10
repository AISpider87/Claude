import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ListonePlayer } from "@/lib/import/name-matching";
import { parseQuotationsWorkbook } from "@/lib/import/quotations-parser";
import { parseRostersWorkbook } from "@/lib/import/rosters-parser";
import { buildRostersPreview, resolutionKey, toRostersPayload } from "@/lib/import/rosters-preview";

const ROSTERS = path.resolve(__dirname, "../../fixtures/rose_superlega_export.xlsx");
const QUOTATIONS = path.resolve(
  __dirname,
  "../../fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
);

async function realListone(): Promise<ListonePlayer[]> {
  const q = await parseQuotationsWorkbook(await readFile(QUOTATIONS));
  return [
    ...q.rows.map((r) => ({ ...r, status: "active" as const })),
    ...q.outOfListRows.map((r) => ({ ...r, status: "out_of_list" as const })),
  ];
}

describe("buildRostersPreview — real export against real listone", () => {
  it("is ready to apply: 20 teams, 460 players, 3/7/7/6 each, credits = 250 − total", async () => {
    const parsed = await parseRostersWorkbook(await readFile(ROSTERS));
    const preview = buildRostersPreview(parsed, await realListone(), ["real gear second"]);

    expect(preview.teams.length).toBe(20);
    expect(preview.totalPlayers).toBe(460);
    expect(preview.unresolved).toBe(0);
    expect(preview.existingTeams).toBe(1);
    expect(preview.newTeams).toBe(19);
    expect(preview.ready).toBe(true);
    for (const t of preview.teams) {
      expect(t.roleCounts).toEqual({ P: 3, D: 7, C: 7, A: 6 });
      expect(t.compositionOk).toBe(true);
      expect(t.credits).toBe(250 - t.total);
    }
    const first = preview.teams[0]!;
    expect(first.exists).toBe(true);
    expect(first.credits).toBe(0);

    const payload = toRostersPayload(preview);
    expect(payload.teams[0]?.players[0]).toEqual({ player_id: 572, price_paid: 11 });
    expect(payload.teams.every((t) => t.players.length === 23)).toBe(true);
  });
});

describe("buildRostersPreview — unresolved entries and manual resolutions", () => {
  const listone: ListonePlayer[] = [
    { id: 1, name: "Uno", team: "Roma", role_classic: "P", qt_a: 1, status: "active" },
    { id: 2, name: "Due", team: "Roma", role_classic: "P", qt_a: 1, status: "active" },
    { id: 3, name: "Due", team: "Como", role_classic: "D", qt_a: 1, status: "active" },
  ];
  const parsed = {
    sheet: "ROSE",
    anomalies: [],
    teams: [
      {
        name: "Alpha",
        headerRow: 1,
        column: 1,
        declaredTotal: 12,
        total: 12,
        entries: [
          { name: "Uno", cost: 5, outOfList: false, row: 2 },
          { name: "Due", cost: 4, outOfList: false, row: 3 },
          { name: "Sconosciuto", cost: 3, outOfList: false, row: 4 },
        ],
      },
    ],
  };

  it("reports ambiguous and not-found entries and is not ready", () => {
    const preview = buildRostersPreview(parsed, listone, [], {
      composition: { P: 1, D: 1, C: 0, A: 0 },
    });
    const [alpha] = preview.teams;
    expect(alpha?.entries.map((e) => e.status)).toEqual(["matched", "ambiguous", "not_found"]);
    expect(alpha?.entries[1]?.candidates.map((c) => c.id)).toEqual([2, 3]);
    expect(preview.unresolved).toBe(2);
    expect(preview.ready).toBe(false);
    expect(() => toRostersPayload(preview)).toThrow(/Unresolved/);
  });

  it("applies manual resolutions and re-checks the composition", () => {
    const preview = buildRostersPreview(parsed, listone, [], {
      composition: { P: 2, D: 1, C: 0, A: 0 },
      resolutions: { [resolutionKey("Alpha", 3)]: 2, [resolutionKey("Alpha", 4)]: 3 },
    });
    expect(preview.unresolved).toBe(0);
    expect(preview.teams[0]?.roleCounts).toEqual({ P: 2, D: 1, C: 0, A: 0 });
    expect(preview.ready).toBe(true);
    expect(
      toRostersPayload(preview).teams[0]?.players.map((p) =>
        "player_id" in p ? p.player_id : null,
      ),
    ).toEqual([1, 2, 3]);
  });
});

describe("buildRostersPreview — duplicate resolutions inside one team", () => {
  const listone: ListonePlayer[] = [
    { id: 1, name: "Uno", team: "Roma", role_classic: "P", qt_a: 1, status: "active" },
    { id: 2, name: "Due", team: "Roma", role_classic: "P", qt_a: 1, status: "active" },
  ];
  const parsed = {
    sheet: "ROSE",
    anomalies: [],
    teams: [
      {
        name: "Alpha",
        headerRow: 1,
        column: 1,
        declaredTotal: 9,
        total: 9,
        entries: [
          { name: "Uno", cost: 5, outOfList: false, row: 2 },
          { name: "Sconosciuto", cost: 4, outOfList: false, row: 3 },
        ],
      },
    ],
  };

  it("flags the second row resolved to an already-present player and is not ready", () => {
    const preview = buildRostersPreview(parsed, listone, [], {
      composition: { P: 2, D: 0, C: 0, A: 0 },
      resolutions: { [resolutionKey("Alpha", 3)]: 1 },
    });
    const [alpha] = preview.teams;
    expect(alpha?.entries.map((e) => e.status)).toEqual(["matched", "duplicate"]);
    expect(alpha?.roleCounts).toEqual({ P: 1, D: 0, C: 0, A: 0 });
    expect(preview.unresolved).toBe(1);
    expect(preview.ready).toBe(false);
  });

  it("accepts the same rows once resolved to a different player", () => {
    const preview = buildRostersPreview(parsed, listone, [], {
      composition: { P: 2, D: 0, C: 0, A: 0 },
      resolutions: { [resolutionKey("Alpha", 3)]: 2 },
    });
    expect(preview.ready).toBe(true);
  });
});

describe("buildRostersPreview — names that left Serie A become out-of-list placeholders", () => {
  const listone: ListonePlayer[] = [
    { id: 1, name: "Uno", team: "Roma", role_classic: "P", qt_a: 1, status: "active" },
    { id: 2, name: "Due", team: "Roma", role_classic: "D", qt_a: 1, status: "active" },
    { id: 3, name: "Tre", team: "Como", role_classic: "D", qt_a: 1, status: "active" },
  ];
  const composition = { P: 1, D: 2, C: 1, A: 0 };
  const parsed = (extra: { name: string; cost: number; outOfList: boolean; row: number }[]) => ({
    sheet: "ROSE",
    anomalies: [],
    teams: [
      {
        name: "Alpha",
        headerRow: 1,
        column: 1,
        declaredTotal: null,
        total: 10,
        entries: [
          { name: "Uno", cost: 5, outOfList: false, row: 2 },
          { name: "Due", cost: 2, outOfList: false, row: 3 },
          { name: "Tre", cost: 2, outOfList: false, row: 4 },
          ...extra,
        ],
      },
    ],
  });

  it("a name marked '*' is a placeholder by default, with the role inferred from the gap", () => {
    const preview = buildRostersPreview(
      parsed([{ name: "Partito", cost: 1, outOfList: true, row: 5 }]),
      listone,
      [],
      { composition },
    );
    const alpha = preview.teams[0]!;
    const gone = alpha.entries[3]!;
    expect(gone.status).toBe("placeholder");
    expect(gone.placeholderRole).toBe("C");
    expect(alpha.unresolved).toBe(0);
    expect(alpha.placeholders).toBe(1);
    expect(alpha.roleCounts).toEqual({ P: 1, D: 2, C: 1, A: 0 });
    expect(preview.ready).toBe(true);
    expect(preview.placeholders).toBe(1);
    expect(toRostersPayload(preview).teams[0]?.players[3]).toEqual({
      placeholder: { name: "Partito", role: "C" },
      price_paid: 1,
    });
  });

  it("a plain unknown name stays unresolved until the admin marks it out of list", () => {
    const rows = parsed([{ name: "Sconosciuto", cost: 1, outOfList: false, row: 5 }]);
    const before = buildRostersPreview(rows, listone, [], { composition });
    expect(before.teams[0]?.entries[3]?.status).toBe("not_found");
    expect(before.unresolved).toBe(1);
    expect(before.ready).toBe(false);

    const explicit = buildRostersPreview(rows, listone, [], {
      composition,
      outOfList: { [resolutionKey("Alpha", 5)]: "C" },
    });
    expect(explicit.teams[0]?.entries[3]?.status).toBe("placeholder");
    expect(explicit.teams[0]?.entries[3]?.placeholderRole).toBe("C");
    expect(explicit.ready).toBe(true);

    const all = buildRostersPreview(rows, listone, [], { composition, outOfListAll: true });
    expect(all.teams[0]?.entries[3]?.placeholderRole).toBe("C");
    expect(all.ready).toBe(true);
  });

  it("asks for the role when the composition gap is not unique", () => {
    const rows = parsed([
      { name: "Partito", cost: 1, outOfList: true, row: 5 },
      { name: "Andato", cost: 1, outOfList: true, row: 6 },
    ]);
    const preview = buildRostersPreview(rows, listone, [], {
      composition: { P: 1, D: 3, C: 1, A: 0 },
    });
    const entries = preview.teams[0]!.entries;
    expect(entries[3]?.status).toBe("not_found");
    expect(entries[3]?.roleMissing).toBe(true);
    expect(entries[4]?.roleMissing).toBe(true);
    expect(preview.unresolved).toBe(2);
    expect(preview.ready).toBe(false);

    const fixed = buildRostersPreview(rows, listone, [], {
      composition: { P: 1, D: 3, C: 1, A: 0 },
      outOfList: { [resolutionKey("Alpha", 5)]: "D" },
    });
    // With one row settled, the remaining gap (C) is unique again.
    expect(fixed.teams[0]?.entries[3]?.placeholderRole).toBe("D");
    expect(fixed.teams[0]?.entries[4]?.placeholderRole).toBe("C");
    expect(fixed.ready).toBe(true);
  });

  it("an explicit Id Fantacalcio wins over the out-of-list mark", () => {
    const rows = parsed([{ name: "Partito", cost: 1, outOfList: true, row: 5 }]);
    const preview = buildRostersPreview(rows, listone, [], {
      composition: { P: 1, D: 3, C: 0, A: 0 },
      resolutions: { [resolutionKey("Alpha", 5)]: 3 },
    });
    // id 3 is already in the roster: duplicate, not placeholder
    expect(preview.teams[0]?.entries[3]?.status).toBe("duplicate");
    expect(preview.ready).toBe(false);
  });
});
