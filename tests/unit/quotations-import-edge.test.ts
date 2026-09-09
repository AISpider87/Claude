import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseQuotationsWorkbook, type QuotationRow } from "@/lib/import/quotations-parser";
import { buildQuotationsPreview, type CurrentPlayer } from "@/lib/import/quotations-preview";

const FIXTURE = path.resolve(
  __dirname,
  "../../fixtures/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
);
const HEADER = [
  "Id",
  "R",
  "RM",
  "Nome",
  "Squadra",
  "Qt.A",
  "Qt.I",
  "Diff.",
  "Qt.A M",
  "Qt.I M",
  "Diff.M",
  "FVM",
  "FVM M",
];

async function wb(body: unknown[][]) {
  const w = new ExcelJS.Workbook();
  const ws = w.addWorksheet("Tutti");
  ws.addRow(["Titolo"]);
  ws.addRow(HEADER);
  body.forEach((r) => ws.addRow(r));
  return new Uint8Array((await w.xlsx.writeBuffer()) as ArrayBuffer);
}

const asCurrent = (r: QuotationRow, status: CurrentPlayer["status"] = "active"): CurrentPlayer => ({
  ...r,
  status,
});

describe("preview mirrors the database comparison", () => {
  it("re-importing the same file is a no-op", async () => {
    const buf = await readFile(FIXTURE);
    const a = await parseQuotationsWorkbook(buf);
    const b = await parseQuotationsWorkbook(buf);
    expect(b).toEqual(a);
    const preview = buildQuotationsPreview(
      a,
      a.rows.map((r) => asCurrent(r)),
    );
    expect([
      preview.newCount,
      preview.updatedCount,
      preview.unchangedCount,
      preview.outOfListCount,
      preview.revivedCount,
    ]).toEqual([0, 0, 532, 0, 0]);
    expect(preview.suspicious).toBe(false);
  });

  it("counts FVM / Qt.I / Mantra changes as updates, like apply_quotations_import()", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    const current = parsed.rows.map((r) => asCurrent(r));
    const bumped = {
      ...parsed,
      rows: parsed.rows.map((r) => ({ ...r, fvm: (r.fvm ?? 0) + 1, qt_i: r.qt_i + 1 })),
    };
    const preview = buildQuotationsPreview(bumped, current);
    expect(preview.updatedCount).toBe(532);
    expect(preview.unchangedCount).toBe(0);
    expect(preview.notableChanges).toEqual([]);
  });

  it("uses the configured threshold for notable changes", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    const current = parsed.rows.map((r) => asCurrent(r));
    const svilar = parsed.rows.find((r) => r.id === 5841)!;
    const bumped = {
      ...parsed,
      rows: parsed.rows.map((r) => (r.id === 5841 ? { ...r, qt_a: svilar.qt_a + 3 } : r)),
    };
    expect(buildQuotationsPreview(bumped, current, 5).notableChanges).toEqual([]);
    expect(buildQuotationsPreview(bumped, current, 2).notableChanges.map((c) => c.id)).toEqual([
      5841,
    ]);
  });
});

describe("parser edge cases", () => {
  it("accepts numeric ids/values written as strings", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([
        ["5841", "P", "Por", "Svilar", "Roma", "18", "18", "0", "18", "18", "0", "83", "83"],
      ]),
    );
    expect(parsed.rows[0]?.id).toBe(5841);
    expect(parsed.rows[0]?.fvm_m).toBe(83);
  });

  it("skips empty trailing rows silently", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[1, "P", "Por", "Uno", "Roma", 1, 1, 0, 1, 1, 0, 1, 1], [], ["", "", ""], [null]]),
    );
    expect(parsed.rows.length).toBe(1);
    expect(parsed.anomalies).toEqual([]);
  });

  it("rejects fractional ids as anomalies instead of rounding", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[12.6, "P", "Por", "Uno", "Roma", 1, 1, 0, 1, 1, 0, 1, 1]]),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.anomalies.map((a) => a.code)).toEqual(["invalid_id"]);
  });

  it("keeps the player when an optional Mantra/FVM column is not numeric", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[5841, "P", "Por", "Svilar", "Roma", 18, 18, 0, "-", "-", "-", 83, "1.250"]]),
    );
    expect(parsed.rows.length).toBe(1);
    expect(parsed.rows[0]).toMatchObject({
      id: 5841,
      qt_a: 18,
      qt_a_m: null,
      fvm: 83,
      fvm_m: null,
    });
    expect(parsed.anomalies.map((a) => a.code)).toEqual([
      "invalid_optional_number",
      "invalid_optional_number",
      "invalid_optional_number",
      "invalid_optional_number",
    ]);
    const preview = buildQuotationsPreview(parsed, [
      asCurrent({ ...parsed.rows[0]!, qt_a_m: 18, qt_i_m: 18, diff_m: 0, fvm_m: 83 }),
    ]);
    expect(preview.outOfList).toEqual([]);
    expect(preview.updatedCount).toBe(1);
  });

  it("drops the row when a required quotation is not a whole number", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[1, "A", "Pc", "Uno", "Roma", "abc", 40, 0, 40, 40, 0, 500, 500]]),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.anomalies.map((a) => a.code)).toEqual(["invalid_number"]);
  });

  it("a Ceduti player still present in Tutti stays active", async () => {
    const w = new ExcelJS.Workbook();
    const t = w.addWorksheet("Tutti");
    t.addRow(HEADER);
    t.addRow([1, "P", "Por", "Uno", "Roma", 1, 1, 0, 1, 1, 0, 1, 1]);
    const c = w.addWorksheet("Ceduti");
    c.addRow(HEADER);
    c.addRow([1, "P", "Por", "Uno", "Roma", 1, 1, 0, 1, 1, 0, 1, 1]);
    const parsed = await parseQuotationsWorkbook(
      new Uint8Array((await w.xlsx.writeBuffer()) as ArrayBuffer),
    );
    expect(parsed.outOfListRows.length).toBe(1);
    expect(parsed.outOfListIds).toEqual([]);
    const preview = buildQuotationsPreview(parsed, [asCurrent(parsed.rows[0]!)]);
    expect(preview.outOfListCount).toBe(0);
  });
});
