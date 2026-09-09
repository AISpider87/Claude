import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { NameMatcher, normalizeName, type ListonePlayer } from "@/lib/import/name-matching";
import { parseQuotationsWorkbook } from "@/lib/import/quotations-parser";
import { parseRostersWorkbook } from "@/lib/import/rosters-parser";

const ROSTERS = path.resolve(__dirname, "../../fixtures/rose_superlega_export.xlsx");
const QUOTATIONS = path.resolve(
  __dirname,
  "../../fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
);

describe("parseRostersWorkbook — real Leghe Fantacalcio export", () => {
  it("finds all 20 teams across the two vertical bands", async () => {
    const parsed = await parseRostersWorkbook(await readFile(ROSTERS));
    expect(parsed.sheet).toBe("ROSE");
    expect(parsed.teams.length).toBe(20);
    expect(parsed.teams.map((t) => t.name)).toEqual([
      "Real Gear Second",
      "DREAM TEAM",
      "Blood Wyrm",
      "Winchester",
      "AS Fonno",
      "WINNITA",
      "Dillo alla luna",
      "assunto calcio",
      "Cioccoriso FC",
      "Tettenham",
      "Gente di categoria",
      "Teamprascu fc",
      "Dracarys",
      "GoodFellas",
      "KING LIONS",
      "DIVIN CRODINO",
      "Tubaroes do Maranhao",
      "ACiurma",
      "Polisportiva Chiaravalle 83",
      "Young Girls",
    ]);
    expect(parsed.anomalies).toEqual([]);
  });

  it("reads 23 players, costs, totals and out-of-list markers per team", async () => {
    const parsed = await parseRostersWorkbook(await readFile(ROSTERS));
    for (const team of parsed.teams) {
      expect(team.entries.length).toBe(23);
      expect(team.declaredTotal).toBe(team.total);
      expect(team.total).toBeLessThanOrEqual(250);
    }
    const first = parsed.teams[0]!;
    expect(first.entries[0]).toEqual({ name: "Meret", cost: 11, outOfList: false, row: 2 });
    expect(first.entries[22]).toEqual({ name: "Moro L.", cost: 1, outOfList: true, row: 24 });
    expect(first.total).toBe(250);

    const starred = parsed.teams.flatMap((t) => t.entries.filter((e) => e.outOfList));
    expect(starred.map((e) => e.name).sort()).toEqual([
      "Albarracin",
      "Anjorin",
      "Anjorin",
      "Azon",
      "Missori",
      "Moro L.",
      "Paleari",
      "Vaz",
      "Vaz",
      "Vaz",
      "Vaz",
    ]);
  });

  it("matches every roster name against the real listone without ambiguity", async () => {
    const [rosters, quotations] = await Promise.all([
      parseRostersWorkbook(await readFile(ROSTERS)),
      parseQuotationsWorkbook(await readFile(QUOTATIONS)),
    ]);
    const listone: ListonePlayer[] = [
      ...quotations.rows.map((r) => ({ ...r, status: "active" as const })),
      ...quotations.outOfListRows.map((r) => ({ ...r, status: "out_of_list" as const })),
    ];
    const matcher = new NameMatcher(listone);

    const unresolved: string[] = [];
    for (const team of rosters.teams) {
      for (const entry of team.entries) {
        const m = matcher.match(entry.name, entry.outOfList);
        if (m.status !== "matched") unresolved.push(`${team.name}: ${entry.name} (${m.status})`);
        else if (entry.outOfList) expect(m.player?.status).toBe("out_of_list");
      }
    }
    expect(unresolved).toEqual([]);
  });
});

describe("parseRostersWorkbook — anomalies", () => {
  async function build(rows: unknown[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ROSE");
    rows.forEach((r) => ws.addRow(r));
    return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  it("reports total mismatch, bad costs, duplicates and roster size", async () => {
    const parsed = await parseRostersWorkbook(
      await build([
        ["Alpha", "costo", "", "Beta", "costo"],
        ["Uno", 10, "", "Tre", 5],
        ["Due", "x", "", "Tre", 5],
        ["Uno", 1, "", "totale", 10],
        ["totale", 99],
      ]),
    );
    expect(parsed.teams.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
    expect(parsed.teams[0]?.entries.map((e) => e.name)).toEqual(["Uno"]);
    expect(parsed.teams[1]?.entries.map((e) => e.name)).toEqual(["Tre"]);
    expect(parsed.anomalies.map((a) => `${a.team}:${a.code}`)).toEqual([
      "Alpha:invalid_cost",
      "Alpha:duplicate_player",
      "Alpha:total_mismatch",
      "Alpha:roster_size",
      "Beta:duplicate_player",
      "Beta:total_mismatch",
      "Beta:roster_size",
    ]);
  });

  it("flags a team without a total row and duplicate team names", async () => {
    const parsed = await parseRostersWorkbook(
      await build([
        ["Alpha", "costo", "", "Alpha", "costo"],
        ["Uno", 10, "", "Due", 1],
        ["", ""],
      ]),
    );
    expect(parsed.teams.length).toBe(1);
    expect(parsed.anomalies.map((a) => a.code)).toEqual([
      "missing_total_row",
      "roster_size",
      "duplicate_team",
    ]);
  });

  it("reports an empty workbook", async () => {
    const parsed = await parseRostersWorkbook(await build([["nulla"]]));
    expect(parsed.teams).toEqual([]);
    expect(parsed.anomalies[0]?.code).toBe("no_teams_found");
  });
});

describe("NameMatcher", () => {
  const listone: ListonePlayer[] = [
    { id: 1, name: "Martinez Jo.", team: "Inter", role_classic: "P", qt_a: 17, status: "active" },
    { id: 2, name: "Martinez L.", team: "Inter", role_classic: "A", qt_a: 35, status: "active" },
    { id: 3, name: "Vaz", team: "Roma", role_classic: "A", qt_a: 1, status: "out_of_list" },
    { id: 4, name: "Vaz", team: "Lecce", role_classic: "D", qt_a: 1, status: "active" },
    { id: 5, name: "Kone B.", team: "Genoa", role_classic: "C", qt_a: 1, status: "active" },
    { id: 6, name: "Dembelè A.", team: "Lecce", role_classic: "D", qt_a: 1, status: "active" },
  ];
  const matcher = new NameMatcher(listone);

  it("normalizes case, accents, spaces, dots and asterisks", () => {
    expect(normalizeName("  Dembele  A.* ")).toBe("dembele a");
    expect(matcher.match("DEMBELE A").player?.id).toBe(6);
    expect(matcher.match("Martinez Jo").player?.id).toBe(1);
    expect(matcher.match("Kone B.").player?.id).toBe(5);
  });

  it("prefers active players for homonyms, out-of-list when asked", () => {
    expect(matcher.match("Vaz").player?.id).toBe(4);
    expect(matcher.match("Vaz", true).player?.id).toBe(3);
  });

  it("reports not found and ambiguous", () => {
    expect(matcher.match("Nessuno").status).toBe("not_found");
    const twoActive = new NameMatcher([
      ...listone,
      { id: 7, name: "Vaz", team: "Como", role_classic: "C", qt_a: 1, status: "active" },
    ]);
    const m = twoActive.match("Vaz");
    expect(m.status).toBe("ambiguous");
    expect(m.candidates.length).toBe(3);
  });
});
