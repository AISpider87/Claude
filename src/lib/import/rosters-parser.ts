import ExcelJS from "exceljs";
import { cellText } from "@/lib/import/quotations-parser";

export interface RosterEntry {
  /** Name as written in the file, without the trailing "*". */
  name: string;
  cost: number;
  outOfList: boolean;
  row: number;
}

export interface ParsedTeam {
  name: string;
  entries: RosterEntry[];
  /** Sum of the entries' costs. */
  total: number;
  /** Value of the "totale" row, when present. */
  declaredTotal: number | null;
  headerRow: number;
  column: number;
}

export type RosterAnomalyCode =
  | "sheet_missing"
  | "no_teams_found"
  | "duplicate_team"
  | "missing_total_row"
  | "total_mismatch"
  | "invalid_cost"
  | "duplicate_player"
  | "roster_size";

export interface RosterAnomaly {
  code: RosterAnomalyCode;
  team?: string;
  row?: number;
  detail: string;
}

export interface ParsedRosters {
  teams: ParsedTeam[];
  anomalies: RosterAnomaly[];
  sheet: string | null;
}

const COST_HEADER = "costo";
const TOTAL_LABEL = "totale";
const EXPECTED_ROSTER_SIZE = 23;

function isCostHeader(value: unknown) {
  return cellText(value).toLowerCase() === COST_HEADER;
}

function isTotalLabel(value: unknown) {
  return cellText(value).toLowerCase() === TOTAL_LABEL;
}

function toCost(value: unknown): number | null {
  const text = cellText(value);
  if (text === "") return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Parses the "Rose" export of Leghe Fantacalcio: teams laid side by side in
 * 3-column blocks (`team name | costo | blank`), possibly in several vertical
 * bands, each block ending with a "totale" row. Players are identified by name
 * only; "Nome *" marks a player who left Serie A.
 */
export async function parseRostersWorkbook(data: ArrayBuffer | Uint8Array): Promise<ParsedRosters> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);

  const sheet =
    workbook.worksheets.find((s) => s.name.trim().toLowerCase() === "rose") ??
    workbook.worksheets[0];
  if (!sheet) {
    return {
      teams: [],
      anomalies: [{ code: "sheet_missing", detail: "Nessun foglio" }],
      sheet: null,
    };
  }

  const anomalies: RosterAnomaly[] = [];
  const teams: ParsedTeam[] = [];
  const seenTeams = new Set<string>();
  const rowCount = sheet.rowCount;

  const cell = (r: number, c: number) => sheet.getRow(r).getCell(c).value;

  for (let r = 1; r <= rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    for (let c = 2; c < values.length; c++) {
      if (!isCostHeader(values[c])) continue;
      const teamName = cellText(values[c - 1]);
      if (!teamName) continue;

      const key = teamName.toLowerCase();
      if (seenTeams.has(key)) {
        anomalies.push({ code: "duplicate_team", team: teamName, row: r, detail: teamName });
        continue;
      }
      seenTeams.add(key);

      const entries: RosterEntry[] = [];
      const seenPlayers = new Set<string>();
      let declaredTotal: number | null = null;
      let foundTotal = false;

      for (let rr = r + 1; rr <= rowCount; rr++) {
        const nameCell = cell(rr, c - 1);
        const costCell = cell(rr, c);
        const rawName = cellText(nameCell);
        if (isTotalLabel(nameCell)) {
          declaredTotal = toCost(costCell);
          foundTotal = true;
          break;
        }
        if (rawName === "" && cellText(costCell) === "") break;
        if (rawName === "" || isCostHeader(costCell)) break;

        const outOfList = rawName.endsWith("*");
        const name = outOfList ? rawName.slice(0, -1).trim() : rawName;
        const cost = toCost(costCell);
        if (cost === null || cost < 0) {
          anomalies.push({
            code: "invalid_cost",
            team: teamName,
            row: rr,
            detail: `${name}: '${cellText(costCell)}'`,
          });
          continue;
        }
        const playerKey = name.toLowerCase();
        if (seenPlayers.has(playerKey)) {
          anomalies.push({ code: "duplicate_player", team: teamName, row: rr, detail: name });
          continue;
        }
        seenPlayers.add(playerKey);
        entries.push({ name, cost, outOfList, row: rr });
      }

      const total = entries.reduce((sum, e) => sum + e.cost, 0);
      if (!foundTotal) {
        anomalies.push({ code: "missing_total_row", team: teamName, row: r, detail: teamName });
      } else if (declaredTotal !== null && declaredTotal !== total) {
        anomalies.push({
          code: "total_mismatch",
          team: teamName,
          row: r,
          detail: `dichiarato ${declaredTotal}, somma ${total}`,
        });
      }
      if (entries.length !== EXPECTED_ROSTER_SIZE) {
        anomalies.push({
          code: "roster_size",
          team: teamName,
          row: r,
          detail: `${entries.length} giocatori invece di ${EXPECTED_ROSTER_SIZE}`,
        });
      }

      teams.push({ name: teamName, entries, total, declaredTotal, headerRow: r, column: c - 1 });
    }
  }

  if (teams.length === 0) {
    anomalies.push({ code: "no_teams_found", detail: "Nessun blocco 'squadra | costo' trovato" });
  }

  return { teams, anomalies, sheet: sheet.name };
}
