import ExcelJS from "exceljs";
import { MAX_IMPORT_ROWS, MAX_WORKBOOK_SHEETS } from "./workbookLimits.js";

type Request = { id: string; buffer: ArrayBuffer };
type Response = { id: string; ok: true; sheetNames: string[]; csvBySheet: Record<string, string> } | { id: string; ok: false; error: string };

function quote(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function sheetCsv(sheet: ExcelJS.Worksheet): string {
  const rows: string[] = [];
  let count = 0;
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const width = Math.max(sheet.columnCount, row.cellCount);
    const values: string[] = [];
    let populated = false;
    for (let column = 1; column <= width; column += 1) {
      const text = row.getCell(column).text ?? "";
      populated ||= text.trim().length > 0;
      values.push(quote(text));
    }
    if (!populated) continue;
    count += 1;
    if (count > MAX_IMPORT_ROWS + 1) throw new Error(`Worksheet ${sheet.name} exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row assessment limit.`);
    rows.push(values.join(","));
  }
  return rows.join("\n");
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, buffer } = event.data;
  let response: Response;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    if (workbook.worksheets.length > MAX_WORKBOOK_SHEETS) throw new Error(`Workbook contains more than ${MAX_WORKBOOK_SHEETS} worksheets.`);
    const sheetNames = workbook.worksheets.map(sheet => sheet.name);
    const csvBySheet = Object.fromEntries(workbook.worksheets.map(sheet => [sheet.name, sheetCsv(sheet)]));
    response = { id, ok: true, sheetNames, csvBySheet };
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : "Workbook parsing failed" };
  }
  self.postMessage(response);
};
