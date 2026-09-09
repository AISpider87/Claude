import ExcelJS from "exceljs";

export type RoleClassic = "P" | "D" | "C" | "A";

export interface QuotationRow {
  id: number;
  name: string;
  team: string;
  role_classic: RoleClassic;
  role_mantra: string | null;
  qt_a: number;
  qt_i: number;
  diff: number;
  qt_a_m: number | null;
  qt_i_m: number | null;
  diff_m: number | null;
  fvm: number | null;
  fvm_m: number | null;
}

export type AnomalyCode =
  | "sheet_missing"
  | "header_not_found"
  | "unknown_column"
  | "missing_column"
  | "missing_id"
  | "invalid_id"
  | "duplicate_id"
  | "invalid_role"
  | "missing_name"
  | "invalid_number";

export interface Anomaly {
  code: AnomalyCode;
  sheet: string;
  row?: number;
  detail: string;
}

export interface ParsedQuotations {
  rows: QuotationRow[];
  outOfListRows: QuotationRow[];
  outOfListIds: number[];
  anomalies: Anomaly[];
  sheets: string[];
  title: string | null;
}

/** Column keys after normalisation (lower case, no dots/spaces). */
const COLUMN_MAP: Record<string, keyof QuotationRow> = {
  id: "id",
  r: "role_classic",
  rm: "role_mantra",
  nome: "name",
  squadra: "team",
  qta: "qt_a",
  qti: "qt_i",
  diff: "diff",
  qtam: "qt_a_m",
  qtim: "qt_i_m",
  diffm: "diff_m",
  fvm: "fvm",
  fvmm: "fvm_m",
};

const REQUIRED: (keyof QuotationRow)[] = ["id", "name", "team", "role_classic", "qt_a"];
const NUMERIC: (keyof QuotationRow)[] = [
  "qt_a",
  "qt_i",
  "diff",
  "qt_a_m",
  "qt_i_m",
  "diff_m",
  "fvm",
  "fvm_m",
];
const ROLE_SHEETS = ["Portieri", "Difensori", "Centrocampisti", "Attaccanti"];
const MAX_HEADER_SCAN = 15;

export function normalizeHeader(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[.\s_-]/g, "")
    .trim();
}

export function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (Array.isArray(v.richText))
      return v.richText
        .map((r) => r.text)
        .join("")
        .trim();
    if (typeof v.text === "string") return v.text.trim();
    if (v.result != null) return cellText(v.result);
  }
  return String(value).trim();
}

function toInt(value: unknown): number | null | undefined {
  const text = cellText(value);
  if (text === "") return null;
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

interface SheetResult {
  rows: QuotationRow[];
  anomalies: Anomaly[];
}

function parseSheet(sheet: ExcelJS.Worksheet, seen: Set<number>): SheetResult {
  const anomalies: Anomaly[] = [];
  const rows: QuotationRow[] = [];
  const name = sheet.name;

  // Locate the header row: the first row containing both "Nome" and "Squadra".
  let headerRow = -1;
  const columns = new Map<number, keyof QuotationRow>();
  for (let r = 1; r <= Math.min(sheet.rowCount, MAX_HEADER_SCAN); r++) {
    const values = sheet.getRow(r).values as unknown[];
    const normalized = values.map(normalizeHeader);
    if (normalized.includes("nome") && normalized.includes("squadra")) {
      headerRow = r;
      normalized.forEach((h, idx) => {
        if (!h) return;
        const key = COLUMN_MAP[h];
        if (key) columns.set(idx, key);
        else
          anomalies.push({
            code: "unknown_column",
            sheet: name,
            row: r,
            detail: cellText(values[idx]),
          });
      });
      break;
    }
  }
  if (headerRow === -1) {
    anomalies.push({
      code: "header_not_found",
      sheet: name,
      detail: "Nessuna riga con 'Nome' e 'Squadra'",
    });
    return { rows, anomalies };
  }

  const present = new Set(columns.values());
  for (const req of REQUIRED) {
    if (!present.has(req))
      anomalies.push({ code: "missing_column", sheet: name, row: headerRow, detail: req });
  }
  if (anomalies.some((a) => a.code === "missing_column")) return { rows, anomalies };

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    const raw: Partial<Record<keyof QuotationRow, unknown>> = {};
    columns.forEach((key, idx) => {
      raw[key] = values[idx];
    });

    const isEmpty = Object.values(raw).every((v) => cellText(v) === "");
    if (isEmpty) continue;

    const idText = cellText(raw.id);
    if (idText === "") {
      anomalies.push({ code: "missing_id", sheet: name, row: r, detail: cellText(raw.name) });
      continue;
    }
    const id = toInt(raw.id);
    if (id == null || id <= 0) {
      anomalies.push({ code: "invalid_id", sheet: name, row: r, detail: idText });
      continue;
    }
    if (seen.has(id)) {
      anomalies.push({
        code: "duplicate_id",
        sheet: name,
        row: r,
        detail: `${id} ${cellText(raw.name)}`,
      });
      continue;
    }

    const playerName = cellText(raw.name);
    if (!playerName) {
      anomalies.push({ code: "missing_name", sheet: name, row: r, detail: String(id) });
      continue;
    }

    const role = cellText(raw.role_classic).toUpperCase();
    if (!["P", "D", "C", "A"].includes(role)) {
      anomalies.push({
        code: "invalid_role",
        sheet: name,
        row: r,
        detail: `${id} ${playerName}: '${role}'`,
      });
      continue;
    }

    const numbers: Partial<Record<keyof QuotationRow, number | null>> = {};
    let bad = false;
    for (const key of NUMERIC) {
      const n = toInt(raw[key]);
      if (n === undefined) {
        anomalies.push({
          code: "invalid_number",
          sheet: name,
          row: r,
          detail: `${key}=${cellText(raw[key])}`,
        });
        bad = true;
        break;
      }
      numbers[key] = n;
    }
    if (bad) continue;

    seen.add(id);
    rows.push({
      id,
      name: playerName,
      team: cellText(raw.team),
      role_classic: role as RoleClassic,
      role_mantra: cellText(raw.role_mantra) || null,
      qt_a: numbers.qt_a ?? 0,
      qt_i: numbers.qt_i ?? 0,
      diff: numbers.diff ?? 0,
      qt_a_m: numbers.qt_a_m ?? null,
      qt_i_m: numbers.qt_i_m ?? null,
      diff_m: numbers.diff_m ?? null,
      fvm: numbers.fvm ?? null,
      fvm_m: numbers.fvm_m ?? null,
    });
  }

  return { rows, anomalies };
}

/**
 * Parses the official Fantacalcio.it quotations workbook.
 * Primary source: sheet "Tutti"; fallback: the four role sheets. Sheet "Ceduti"
 * lists players who left Serie A (out of list).
 */
export async function parseQuotationsWorkbook(
  data: ArrayBuffer | Uint8Array,
): Promise<ParsedQuotations> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);

  const sheets = workbook.worksheets.map((s) => s.name);
  const anomalies: Anomaly[] = [];
  const seen = new Set<number>();
  let rows: QuotationRow[] = [];

  const findSheet = (n: string) =>
    workbook.worksheets.find((s) => s.name.trim().toLowerCase() === n.toLowerCase());

  const tutti = findSheet("Tutti");
  if (tutti) {
    const res = parseSheet(tutti, seen);
    rows = res.rows;
    anomalies.push(...res.anomalies);
  } else {
    anomalies.push({ code: "sheet_missing", sheet: "Tutti", detail: "uso i fogli per ruolo" });
    let any = false;
    for (const roleSheet of ROLE_SHEETS) {
      const s = findSheet(roleSheet);
      if (!s) continue;
      any = true;
      const res = parseSheet(s, seen);
      rows.push(...res.rows);
      anomalies.push(...res.anomalies);
    }
    if (!any)
      anomalies.push({
        code: "sheet_missing",
        sheet: "Portieri/Difensori/Centrocampisti/Attaccanti",
        detail: "nessun foglio riconosciuto",
      });
  }

  let outOfListRows: QuotationRow[] = [];
  const ceduti = findSheet("Ceduti");
  if (ceduti) {
    const res = parseSheet(ceduti, new Set());
    outOfListRows = res.rows;
    anomalies.push(...res.anomalies);
  }

  const activeIds = new Set(rows.map((r) => r.id));
  const outOfListIds = outOfListRows.map((r) => r.id).filter((id) => !activeIds.has(id));

  const title = workbook.worksheets[0]?.getRow(1).getCell(1).value;

  return {
    rows,
    outOfListRows,
    outOfListIds,
    anomalies,
    sheets,
    title: title == null ? null : cellText(title),
  };
}

/** Roster composition by role, used by previews and validation. */
export function countByRole(rows: { role_classic: RoleClassic }[]): Record<RoleClassic, number> {
  const counts: Record<RoleClassic, number> = { P: 0, D: 0, C: 0, A: 0 };
  for (const r of rows) counts[r.role_classic]++;
  return counts;
}
