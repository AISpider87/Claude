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
    expect(toRostersPayload(preview).teams[0]?.players.map((p) => p.player_id)).toEqual([1, 2, 3]);
  });
});
