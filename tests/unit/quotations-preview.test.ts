import { describe, expect, it } from "vitest";
import type { ParsedQuotations, QuotationRow } from "@/lib/import/quotations-parser";
import { buildQuotationsPreview, type CurrentPlayer } from "@/lib/import/quotations-preview";

function row(partial: Partial<QuotationRow> & Pick<QuotationRow, "id" | "name">): QuotationRow {
  return {
    team: "Roma",
    role_classic: "A",
    role_mantra: null,
    qt_a: 10,
    qt_i: 10,
    diff: 0,
    qt_a_m: null,
    qt_i_m: null,
    diff_m: null,
    fvm: null,
    fvm_m: null,
    ...partial,
  };
}

function parsed(rows: QuotationRow[], outOfListIds: number[] = []): ParsedQuotations {
  return { rows, outOfListIds, outOfListRows: [], anomalies: [], sheets: ["Tutti"], title: null };
}

function cur(
  partial: Partial<CurrentPlayer> & Pick<CurrentPlayer, "id" | "name" | "role_classic" | "qt_a">,
): CurrentPlayer {
  return {
    team: "Roma",
    role_mantra: null,
    qt_i: 10,
    diff: 0,
    qt_a_m: null,
    qt_i_m: null,
    diff_m: null,
    fvm: null,
    fvm_m: null,
    status: "active",
    ...partial,
  };
}

const current: CurrentPlayer[] = [
  cur({ id: 1, name: "Uno", role_classic: "P", qt_a: 18 }),
  cur({ id: 2, name: "Due", team: "Inter", role_classic: "D", qt_a: 31 }),
  cur({ id: 3, name: "Tre", team: "Como", role_classic: "C", qt_a: 30 }),
  cur({ id: 4, name: "Quattro", role_classic: "A", qt_a: 37, status: "out_of_list" }),
];

describe("buildQuotationsPreview", () => {
  it("classifies new, updated, unchanged, revived and out-of-list players", () => {
    const preview = buildQuotationsPreview(
      parsed(
        [
          row({ id: 1, name: "Uno", role_classic: "P", qt_a: 18 }),
          row({ id: 2, name: "Due", team: "Inter", role_classic: "D", qt_a: 24 }),
          row({ id: 4, name: "Quattro", qt_a: 37 }),
          row({ id: 5, name: "Cinque", qt_a: 1 }),
        ],
        [],
      ),
      current,
    );

    expect(preview.newCount).toBe(1);
    expect(preview.newPlayers[0]?.name).toBe("Cinque");
    expect(preview.updatedCount).toBe(1);
    expect(preview.unchangedCount).toBe(1);
    expect(preview.revivedCount).toBe(1);
    expect(preview.outOfListCount).toBe(1);
    expect(preview.outOfList[0]?.name).toBe("Tre");
    expect(preview.notableChanges).toEqual([
      {
        id: 2,
        name: "Due",
        team: "Inter",
        role_classic: "D",
        qt_a: 24,
        from: 31,
        to: 24,
        delta: -7,
      },
    ]);
    expect(preview.isFirstImport).toBe(false);
    expect(preview.suspicious).toBe(true); // 1 of 3 active players leaves (> 10%)
  });

  it("treats ceded players as out of list even when still in the file", () => {
    const preview = buildQuotationsPreview(
      parsed(
        [
          row({ id: 1, name: "Uno", role_classic: "P", qt_a: 18 }),
          row({ id: 2, name: "Due", team: "Inter", role_classic: "D", qt_a: 31 }),
          row({ id: 3, name: "Tre", team: "Como", role_classic: "C", qt_a: 30 }),
        ],
        [3],
      ),
      current,
    );
    expect(preview.outOfList.map((p) => p.id)).toEqual([3]);
  });

  it("flags the first import and counts roles", () => {
    const preview = buildQuotationsPreview(
      parsed([row({ id: 1, name: "Uno", role_classic: "P" }), row({ id: 2, name: "Due" })]),
      [],
    );
    expect(preview.isFirstImport).toBe(true);
    expect(preview.suspicious).toBe(false);
    expect(preview.roleCounts).toEqual({ P: 1, D: 0, C: 0, A: 1 });
    expect(preview.newCount).toBe(2);
  });
});
