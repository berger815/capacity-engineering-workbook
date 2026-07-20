export interface CsvTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export const MAX_CSV_DATA_ROWS = 100_000;

export function parseCsvRows(input: string, delimiter = ",", maxRows = MAX_CSV_DATA_ROWS + 1): string[][] {
  if (delimiter.length !== 1) throw new Error("CSV delimiter must be one character");
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("CSV row limit must be a positive integer");

  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushRow = (): void => {
    rows.push(row);
    if (rows.length > maxRows) throw new Error(`CSV exceeds the ${Math.max(0, maxRows - 1).toLocaleString()} data-row assessment limit`);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      field = "";
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    pushRow();
  }

  return rows.filter(values => values.some(value => value.trim().length > 0));
}

export function parseCsvTable(input: string, delimiter = ",", maxDataRows = MAX_CSV_DATA_ROWS): CsvTable {
  if (!Number.isInteger(maxDataRows) || maxDataRows < 0) throw new Error("CSV data-row limit must be a non-negative integer");
  const rows = parseCsvRows(input, delimiter, maxDataRows + 1);
  const first = rows[0];
  if (!first) throw new Error("CSV is empty");

  const headers = first.map(header => header.trim());
  if (headers.some(header => header.length === 0)) throw new Error("CSV contains a blank header");
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate headers");

  return {
    headers,
    rows: rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  };
}
