import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildListoneWorkbook,
  buildRostersWorkbook,
  buildTransactionsWorkbook,
  workbookToBuffer,
} from "@/lib/export/workbooks";

async function reload(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  return wb;
}

function rowValues(sheet: ExcelJS.Worksheet, index: number) {
  const values = sheet.getRow(index).values as unknown[];
  return values.slice(1);
}

describe("admin Excel exports", () => {
  it("writes rosters with Italian headers, one sheet per view", async () => {
    const wb = buildRostersWorkbook(
      [
        {
          team: "Alpha",
          shortName: "ALP",
          manager: "Mario",
          credits: 12,
          swapsUsed: 3,
          playerId: 5841,
          player: "Svilar",
          role: "P",
          serieATeam: "Roma",
          qtA: 18,
          pricePaid: 17,
          acquiredAt: "2026-08-20T20:00:00.000Z",
          acquiredVia: "initial_import",
          outOfList: false,
        },
      ],
      [
        {
          team: "Alpha",
          shortName: "ALP",
          manager: "Mario",
          credits: 12,
          swapsUsed: 3,
          players: 23,
        },
      ],
    );
    const loaded = await reload(await workbookToBuffer(wb));
    const rose = loaded.getWorksheet("Rose")!;
    expect(rowValues(rose, 1)).toEqual([
      "Squadra",
      "Sigla",
      "Id",
      "Calciatore",
      "R",
      "Squadra Serie A",
      "Qt.A",
      "Prezzo pagato",
      "Acquisito il",
      "Come",
      "Fuori lista",
    ]);
    expect(rowValues(rose, 2)).toEqual([
      "Alpha",
      "ALP",
      5841,
      "Svilar",
      "P",
      "Roma",
      18,
      17,
      "20/08/2026, 22:00",
      "Import iniziale",
      "",
    ]);
    const squadre = loaded.getWorksheet("Squadre")!;
    expect(rowValues(squadre, 2)).toEqual(["Alpha", "ALP", "Mario", 12, 3, 23]);
  });

  it("mirrors the official quotations columns in the listone export", async () => {
    const wb = buildListoneWorkbook([
      {
        id: 254,
        name: "Dimarco",
        team: "Inter",
        roleClassic: "D",
        roleMantra: "E;W",
        qtA: 31,
        qtI: 32,
        diff: -1,
        qtAM: 30,
        qtIM: 30,
        diffM: 0,
        fvm: 250,
        fvmM: 250,
        status: "out_of_list",
        owners: 4,
        updatedAt: "2026-09-01T04:30:00.000Z",
      },
    ]);
    const sheet = (await reload(await workbookToBuffer(wb))).getWorksheet("Listone")!;
    expect(rowValues(sheet, 1).slice(0, 13)).toEqual([
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
    ]);
    expect(rowValues(sheet, 2).slice(13)).toEqual(["Fuori lista", 4, "01/09/2026, 06:30"]);
  });

  it("labels transactions and marks reversed ones", async () => {
    const wb = buildTransactionsWorkbook([
      {
        createdAt: "2026-09-10T18:00:00.000Z",
        team: "Alpha",
        session: "Prima sessione",
        kind: "swap",
        playerOut: "Meret",
        playerOutPrice: 11,
        playerIn: "Svilar",
        playerInPrice: 18,
        creditsDelta: -7,
        countsTowardLimit: true,
        note: null,
        reversed: true,
      },
    ]);
    const sheet = (await reload(await workbookToBuffer(wb))).getWorksheet("Operazioni")!;
    expect(rowValues(sheet, 2)).toEqual([
      "10/09/2026, 20:00",
      "Alpha",
      "Prima sessione",
      "Cambio",
      "Meret",
      11,
      "Svilar",
      18,
      -7,
      "sì",
      "sì",
      "",
    ]);
  });
});
