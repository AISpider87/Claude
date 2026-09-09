import ExcelJS from "exceljs";
import { LEAGUE_TIME_ZONE } from "@/lib/time";

/** Everything the three admin exports need, already joined by the caller. */
export interface RosterExportRow {
  team: string;
  shortName: string;
  manager: string | null;
  credits: number;
  swapsUsed: number;
  playerId: number;
  player: string;
  role: string;
  serieATeam: string;
  qtA: number;
  pricePaid: number;
  acquiredAt: string;
  acquiredVia: string;
  outOfList: boolean;
}

export interface TeamExportRow {
  team: string;
  shortName: string;
  manager: string | null;
  credits: number;
  swapsUsed: number;
  players: number;
}

export interface PlayerExportRow {
  id: number;
  name: string;
  team: string;
  roleClassic: string;
  roleMantra: string | null;
  qtA: number;
  qtI: number;
  diff: number;
  qtAM: number | null;
  qtIM: number | null;
  diffM: number | null;
  fvm: number | null;
  fvmM: number | null;
  status: string;
  owners: number;
  updatedAt: string;
}

export interface TransactionExportRow {
  createdAt: string;
  team: string;
  session: string | null;
  kind: string;
  playerOut: string | null;
  playerOutPrice: number | null;
  playerIn: string | null;
  playerInPrice: number | null;
  creditsDelta: number;
  countsTowardLimit: boolean;
  note: string | null;
  reversed: boolean;
}

const ACQUIRED_LABEL: Record<string, string> = {
  initial_import: "Import iniziale",
  admin: "Admin",
  swap: "Cambio",
  free_swap: "Cambio gratuito",
  reversal: "Annullamento",
};

const KIND_LABEL: Record<string, string> = {
  swap: "Cambio",
  free_swap: "Cambio gratuito",
  admin_assign: "Assegnazione admin",
  admin_remove: "Rimozione admin",
  admin_credits: "Crediti admin",
  reversal: "Annullamento",
};

const dateFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: LEAGUE_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function localDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width?: number }[],
  rows: Record<string, unknown>[],
) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ ...c, width: c.width ?? 14 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SuperLega";
  wb.created = new Date();
  return wb;
}

export function buildRostersWorkbook(rosters: RosterExportRow[], teams: TeamExportRow[]) {
  const wb = newWorkbook();
  addSheet(
    wb,
    "Rose",
    [
      { header: "Squadra", key: "team", width: 26 },
      { header: "Sigla", key: "shortName", width: 8 },
      { header: "Id", key: "playerId", width: 8 },
      { header: "Calciatore", key: "player", width: 24 },
      { header: "R", key: "role", width: 5 },
      { header: "Squadra Serie A", key: "serieATeam", width: 16 },
      { header: "Qt.A", key: "qtA", width: 8 },
      { header: "Prezzo pagato", key: "pricePaid", width: 14 },
      { header: "Acquisito il", key: "acquiredAt", width: 18 },
      { header: "Come", key: "acquiredVia", width: 16 },
      { header: "Fuori lista", key: "outOfList", width: 11 },
    ],
    rosters.map((r) => ({
      ...r,
      acquiredAt: localDate(r.acquiredAt),
      acquiredVia: ACQUIRED_LABEL[r.acquiredVia] ?? r.acquiredVia,
      outOfList: r.outOfList ? "*" : "",
    })),
  );
  addSheet(
    wb,
    "Squadre",
    [
      { header: "Squadra", key: "team", width: 26 },
      { header: "Sigla", key: "shortName", width: 8 },
      { header: "Manager", key: "manager", width: 22 },
      { header: "Crediti residui", key: "credits", width: 14 },
      { header: "Cambi usati", key: "swapsUsed", width: 12 },
      { header: "Giocatori", key: "players", width: 10 },
    ],
    teams.map((t) => ({ ...t, manager: t.manager ?? "" })),
  );
  return wb;
}

export function buildListoneWorkbook(players: PlayerExportRow[]) {
  const wb = newWorkbook();
  addSheet(
    wb,
    "Listone",
    [
      { header: "Id", key: "id", width: 8 },
      { header: "R", key: "roleClassic", width: 5 },
      { header: "RM", key: "roleMantra", width: 8 },
      { header: "Nome", key: "name", width: 24 },
      { header: "Squadra", key: "team", width: 16 },
      { header: "Qt.A", key: "qtA", width: 8 },
      { header: "Qt.I", key: "qtI", width: 8 },
      { header: "Diff.", key: "diff", width: 8 },
      { header: "Qt.A M", key: "qtAM", width: 8 },
      { header: "Qt.I M", key: "qtIM", width: 8 },
      { header: "Diff.M", key: "diffM", width: 8 },
      { header: "FVM", key: "fvm", width: 8 },
      { header: "FVM M", key: "fvmM", width: 8 },
      { header: "Stato", key: "status", width: 12 },
      { header: "In quante rose", key: "owners", width: 14 },
      { header: "Aggiornato il", key: "updatedAt", width: 18 },
    ],
    players.map((p) => ({
      ...p,
      status: p.status === "out_of_list" ? "Fuori lista" : "Attivo",
      updatedAt: localDate(p.updatedAt),
    })),
  );
  return wb;
}

export function buildTransactionsWorkbook(rows: TransactionExportRow[]) {
  const wb = newWorkbook();
  addSheet(
    wb,
    "Operazioni",
    [
      { header: "Quando", key: "createdAt", width: 18 },
      { header: "Squadra", key: "team", width: 26 },
      { header: "Sessione", key: "session", width: 22 },
      { header: "Operazione", key: "kind", width: 18 },
      { header: "Esce", key: "playerOut", width: 22 },
      { header: "Rientro", key: "playerOutPrice", width: 9 },
      { header: "Entra", key: "playerIn", width: 22 },
      { header: "Costo", key: "playerInPrice", width: 9 },
      { header: "Delta crediti", key: "creditsDelta", width: 12 },
      { header: "Conta nel limite", key: "countsTowardLimit", width: 14 },
      { header: "Annullata", key: "reversed", width: 10 },
      { header: "Note", key: "note", width: 30 },
    ],
    rows.map((r) => ({
      ...r,
      createdAt: localDate(r.createdAt),
      session: r.session ?? "",
      kind: KIND_LABEL[r.kind] ?? r.kind,
      playerOut: r.playerOut ?? "",
      playerIn: r.playerIn ?? "",
      countsTowardLimit: r.countsTowardLimit ? "sì" : "no",
      reversed: r.reversed ? "sì" : "",
      note: r.note ?? "",
    })),
  );
  return wb;
}

export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await wb.xlsx.writeBuffer();
  const view = new Uint8Array(buffer as ArrayBuffer);
  const copy = new Uint8Array(new ArrayBuffer(view.byteLength));
  copy.set(view);
  return copy;
}
