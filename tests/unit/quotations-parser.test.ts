import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  countByRole,
  normalizeHeader,
  parseQuotationsWorkbook,
} from "@/lib/import/quotations-parser";

const FIXTURE = path.resolve(
  __dirname,
  "../../fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
);

describe("parseQuotationsWorkbook — real Fantacalcio.it file", () => {
  it("parses every player from the 'Tutti' sheet with mapped columns", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));

    expect(parsed.sheets).toEqual([
      "Tutti",
      "Portieri",
      "Difensori",
      "Centrocampisti",
      "Attaccanti",
      "Ceduti",
    ]);
    expect(parsed.rows.length).toBe(532);
    expect(parsed.anomalies).toEqual([]);
    expect(parsed.title).toContain("Quotazioni Fantacalcio");

    const svilar = parsed.rows.find((r) => r.id === 5841);
    expect(svilar).toEqual({
      id: 5841,
      name: "Svilar",
      team: "Roma",
      role_classic: "P",
      role_mantra: "Por",
      qt_a: 18,
      qt_i: 18,
      diff: 0,
      qt_a_m: 18,
      qt_i_m: 18,
      diff_m: 0,
      fvm: 83,
      fvm_m: 83,
    });

    const dimarco = parsed.rows.find((r) => r.id === 254);
    expect(dimarco?.role_mantra).toBe("E;W");
    expect(dimarco?.qt_a).toBe(31);
    expect(dimarco?.diff).toBe(-1);

    expect(countByRole(parsed.rows)).toEqual({ P: 64, D: 190, C: 192, A: 86 });
  });

  it("reads the 'Ceduti' sheet as out-of-list players", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    expect(parsed.outOfListRows.length).toBe(62);
    expect(parsed.outOfListIds).toContain(5876); // Di Gregorio
    const activeIds = new Set(parsed.rows.map((r) => r.id));
    for (const id of parsed.outOfListIds) expect(activeIds.has(id)).toBe(false);
  });

  it("has unique ids", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    expect(new Set(parsed.rows.map((r) => r.id)).size).toBe(parsed.rows.length);
  });
});

async function buildWorkbook(
  sheetName: string,
  header: unknown[],
  body: unknown[][],
  headerRowIndex = 1,
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (let i = 1; i < headerRowIndex; i++) ws.addRow([`Titolo ${i}`]);
  ws.addRow(header);
  body.forEach((row) => ws.addRow(row));
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

describe("parseQuotationsWorkbook — tolerant parsing", () => {
  const header = ["Id", "R", "RM", "Nome", "Squadra", "Qt.A", "Qt.I", "Diff.", "FVM", "Note extra"];

  it("finds the header row wherever it is and ignores unknown columns", async () => {
    const data = await buildWorkbook(
      "Tutti",
      header,
      [
        [1, "P", "Por", "Uno", "Roma", "12", 11, "1", 40, "x"],
        [2, "d", "Dc", "Due", "Inter", 5, 5, 0, 10, ""],
      ],
      4,
    );
    const parsed = await parseQuotationsWorkbook(data);
    expect(parsed.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(parsed.rows[0]?.qt_a).toBe(12);
    expect(parsed.rows[1]?.role_classic).toBe("D");
    expect(parsed.rows[1]?.qt_a_m).toBeNull();
    expect(parsed.anomalies).toEqual([
      { code: "unknown_column", sheet: "Tutti", row: 4, detail: "Note extra" },
    ]);
  });

  it("skips and reports rows without id, duplicates, bad roles and bad numbers", async () => {
    const data = await buildWorkbook("Tutti", header, [
      [1, "P", "Por", "Uno", "Roma", 12, 11, 1, 40, ""],
      ["", "P", "Por", "Senza Id", "Roma", 1, 1, 0, 1, ""],
      [1, "P", "Por", "Duplicato", "Roma", 1, 1, 0, 1, ""],
      [3, "X", "", "Ruolo strano", "Roma", 1, 1, 0, 1, ""],
      [4, "A", "Pc", "Numero rotto", "Roma", "abc", 1, 0, 1, ""],
      [5, "A", "Pc", "", "Roma", 1, 1, 0, 1, ""],
      ["abc", "A", "Pc", "Id testo", "Roma", 1, 1, 0, 1, ""],
    ]);
    const parsed = await parseQuotationsWorkbook(data);
    expect(parsed.rows.map((r) => r.id)).toEqual([1]);
    expect(parsed.anomalies.filter((a) => a.code !== "unknown_column").map((a) => a.code)).toEqual([
      "missing_id",
      "duplicate_id",
      "invalid_role",
      "invalid_number",
      "missing_name",
      "invalid_id",
    ]);
  });

  it("falls back to role sheets when 'Tutti' is missing", async () => {
    const wb = new ExcelJS.Workbook();
    const p = wb.addWorksheet("Portieri");
    p.addRow(["Id", "R", "RM", "Nome", "Squadra", "Qt.A", "Qt.I", "Diff.", "FVM"]);
    p.addRow([1, "P", "Por", "Uno", "Roma", 12, 11, 1, 40]);
    const a = wb.addWorksheet("Attaccanti");
    a.addRow(["Id", "R", "RM", "Nome", "Squadra", "Qt.A", "Qt.I", "Diff.", "FVM"]);
    a.addRow([2, "A", "Pc", "Due", "Inter", 30, 28, 2, 200]);
    const data = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);

    const parsed = await parseQuotationsWorkbook(data);
    expect(parsed.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(parsed.anomalies[0]?.code).toBe("sheet_missing");
  });

  it("reports a missing required column instead of guessing", async () => {
    const data = await buildWorkbook(
      "Tutti",
      ["R", "Nome", "Squadra", "Qt.A"],
      [["P", "Uno", "Roma", 1]],
    );
    const parsed = await parseQuotationsWorkbook(data);
    expect(parsed.rows).toEqual([]);
    expect(parsed.anomalies.some((x) => x.code === "missing_column" && x.detail === "id")).toBe(
      true,
    );
  });
});

describe("normalizeHeader", () => {
  it("strips dots, spaces and case", () => {
    expect(normalizeHeader("Qt.A M")).toBe("qtam");
    expect(normalizeHeader(" Diff. ")).toBe("diff");
    expect(normalizeHeader({ richText: [{ text: "FVM" }, { text: " M" }] })).toBe("fvmm");
  });
});
