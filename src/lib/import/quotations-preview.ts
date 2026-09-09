import type { ParsedQuotations, QuotationRow, RoleClassic } from "@/lib/import/quotations-parser";
import { countByRole } from "@/lib/import/quotations-parser";

export interface CurrentPlayer {
  id: number;
  name: string;
  team: string;
  role_classic: RoleClassic;
  qt_a: number;
  status: "active" | "out_of_list";
}

export interface PreviewPlayer {
  id: number;
  name: string;
  team: string;
  role_classic: RoleClassic;
  qt_a: number;
}

export interface NotableChange extends PreviewPlayer {
  from: number;
  to: number;
  delta: number;
}

export interface QuotationsPreview {
  total: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  revivedCount: number;
  outOfListCount: number;
  roleCounts: Record<RoleClassic, number>;
  newPlayers: PreviewPlayer[];
  revivedPlayers: PreviewPlayer[];
  outOfList: PreviewPlayer[];
  notableChanges: NotableChange[];
  /** True when the file would remove an unusually large share of the current list. */
  suspicious: boolean;
  isFirstImport: boolean;
}

const LIST_LIMIT = 60;

function toPreview(r: QuotationRow | CurrentPlayer): PreviewPlayer {
  return { id: r.id, name: r.name, team: r.team, role_classic: r.role_classic, qt_a: r.qt_a };
}

/**
 * Pure diff between a parsed workbook and the current listone. Mirrors the
 * counting rules of apply_quotations_import() so the preview matches the outcome.
 */
export function buildQuotationsPreview(
  parsed: ParsedQuotations,
  current: CurrentPlayer[],
  threshold = 5,
): QuotationsPreview {
  const byId = new Map(current.map((p) => [p.id, p]));
  const fileIds = new Set(parsed.rows.map((r) => r.id));
  const cededIds = new Set(parsed.outOfListIds);

  const newPlayers: PreviewPlayer[] = [];
  const revivedPlayers: PreviewPlayer[] = [];
  const notableChanges: NotableChange[] = [];
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const row of parsed.rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      newPlayers.push(toPreview(row));
      continue;
    }
    if (existing.status === "out_of_list") {
      revivedPlayers.push(toPreview(row));
    } else if (
      existing.name !== row.name ||
      existing.team !== row.team ||
      existing.role_classic !== row.role_classic ||
      existing.qt_a !== row.qt_a
    ) {
      // Only the user-visible fields are compared here; the DB compares all columns.
      updatedCount++;
    } else {
      unchangedCount++;
    }
    const delta = row.qt_a - existing.qt_a;
    if (Math.abs(delta) >= threshold) {
      notableChanges.push({ ...toPreview(row), from: existing.qt_a, to: row.qt_a, delta });
    }
  }

  const outOfList = current
    .filter((p) => p.status === "active" && (!fileIds.has(p.id) || cededIds.has(p.id)))
    .map(toPreview);

  notableChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const activeCount = current.filter((p) => p.status === "active").length;

  return {
    total: parsed.rows.length,
    newCount: newPlayers.length,
    updatedCount,
    unchangedCount,
    revivedCount: revivedPlayers.length,
    outOfListCount: outOfList.length,
    roleCounts: countByRole(parsed.rows),
    newPlayers: newPlayers.slice(0, LIST_LIMIT),
    revivedPlayers: revivedPlayers.slice(0, LIST_LIMIT),
    outOfList: outOfList.slice(0, LIST_LIMIT),
    notableChanges: notableChanges.slice(0, LIST_LIMIT),
    suspicious: activeCount > 0 && outOfList.length > activeCount * 0.1,
    isFirstImport: activeCount === 0,
  };
}
