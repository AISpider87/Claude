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
  id: r.id,
  name: r.name,
  team: r.team,
  role_classic: r.role_classic,
  qt_a: r.qt_a,
  status,
});

describe("QA probe: real fixture", () => {
  it("parsing is deterministic and re-importing the same file is a no-op in the preview", async () => {
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

  it("DIVERGENCE: only FVM/Qt.I/Mantra changed -> preview says 532 unchanged, DB will say 532 updated", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    // Simulate a weekly Fantacalcio.it refresh where every FVM moves but no Qt.A does.
    const current = parsed.rows.map((r) => asCurrent(r));
    const bumped = {
      ...parsed,
      rows: parsed.rows.map((r) => ({ ...r, fvm: (r.fvm ?? 0) + 1, qt_i: r.qt_i + 1 })),
    };
    const preview = buildQuotationsPreview(bumped, current);
    expect(preview.updatedCount).toBe(0); // <- what the admin sees before confirming
    expect(preview.unchangedCount).toBe(532);
  });

  it("no Ceduti id is also in Tutti in the real file (edge case only synthetic)", async () => {
    const parsed = await parseQuotationsWorkbook(await readFile(FIXTURE));
    const active = new Set(parsed.rows.map((r) => r.id));
    expect(parsed.outOfListRows.filter((r) => active.has(r.id))).toEqual([]);
  });
});

describe("QA probe: parser edge cases", () => {
  it("numeric ids/values as strings are accepted", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([
        ["5841", "P", "Por", "Svilar", "Roma", "18", "18", "0", "18", "18", "0", "83", "83"],
      ]),
    );
    expect(parsed.rows[0]?.id).toBe(5841);
    expect(parsed.rows[0]?.fvm_m).toBe(83);
  });

  it("empty trailing rows and rows with only blanks are skipped silently", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([
        [1, "P", "Por", "Uno", "Roma", 1, 1, 0, 1, 1, 0, 1, 1],
        [],
        ["", "", "", "", ""],
        [null],
      ]),
    );
    expect(parsed.rows.length).toBe(1);
    expect(parsed.anomalies).toEqual([]);
  });

  it("fractional id is silently rounded (12.6 -> 13) instead of being an anomaly", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[12.6, "P", "Por", "Uno", "Roma", 1, 1, 0, 1, 1, 0, 1, 1]]),
    );
    expect(parsed.rows[0]?.id).toBe(13);
    expect(parsed.anomalies).toEqual([]);
  });

  it("a non-numeric OPTIONAL Mantra column ('-') drops the whole row -> player would go out_of_list", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[5841, "P", "Por", "Svilar", "Roma", 18, 18, 0, "-", "-", "-", 83, "-"]]),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.anomalies.map((a) => a.code)).toEqual(["invalid_number"]);
    const preview = buildQuotationsPreview(parsed, [
      { id: 5841, name: "Svilar", team: "Roma", role_classic: "P", qt_a: 18, status: "active" },
    ]);
    expect(preview.outOfList.map((p) => p.id)).toEqual([5841]);
  });

  it("thousands separator '1.250' is read as 1 (no anomaly)", async () => {
    const parsed = await parseQuotationsWorkbook(
      await wb([[1, "A", "Pc", "Uno", "Roma", 40, 40, 0, 40, 40, 0, "1.250", 500]]),
    );
    expect(parsed.rows[0]?.fvm).toBe(1);
    expect(parsed.anomalies).toEqual([]);
  });

  it("Ceduti player still present in Tutti stays active (ids filtered) — preview and payload agree", async () => {
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
    const preview = buildQuotationsPreview(parsed, [
      { id: 1, name: "Uno", team: "Roma", role_classic: "P", qt_a: 1, status: "active" },
    ]);
    expect(preview.outOfListCount).toBe(0);
  });
});
