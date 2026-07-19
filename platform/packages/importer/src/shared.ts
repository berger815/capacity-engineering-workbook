import type { CapacityModel } from "@capacity/domain";

export type MergeMode = "append" | "replaceById";
export type ImportDateFormat = "iso" | "us";
export type FactorFormat = "decimal" | "percent";

export interface BaseImportMapping {
  sourceSystem?: string;
  delimiter?: string;
  trimWhitespace?: boolean;
  emptyStringAsNull?: boolean;
}

export interface ImportIssue {
  rowNumber?: number | undefined;
  entityKey?: string | undefined;
  severity: "error" | "warning";
  code: string;
  message: string;
  column?: string | undefined;
  value?: string | undefined;
}

export interface BaseImportControlTotals {
  inputRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
  addedRecords: number;
  replacedRecords: number;
  unchangedRecords: number;
}

export interface ImportResult<TRecord, TTotals extends BaseImportControlTotals = BaseImportControlTotals> {
  records: TRecord[];
  issues: ImportIssue[];
  controlTotals: TTotals;
}

export interface ImportPreviewRow<TRecord> {
  sourceRowNumbers: number[];
  status: "accepted" | "warning" | "rejected";
  record?: TRecord;
  issues: ImportIssue[];
}

export interface ImportApplyResult<TTotals extends BaseImportControlTotals = BaseImportControlTotals> {
  model: CapacityModel;
  import: ImportResult<unknown, TTotals>;
}

export function textValue(
  row: Record<string, string>,
  column: string | undefined,
  mapping: BaseImportMapping,
): string {
  if (!column) return "";
  const raw = row[column] ?? "";
  return mapping.trimWhitespace === false ? raw : raw.trim();
}

export function requiredHeaders(headers: string[], columns: Array<string | undefined>): string[] {
  const required = columns.filter((column): column is string => Boolean(column));
  return required.filter(column => !headers.includes(column));
}

export function parseIsoDate(raw: string, format: ImportDateFormat = "iso"): string | null {
  const trimmed = raw.trim();
  let value = trimmed;
  if (format === "us") {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (!match) return null;
    const month = match[1];
    const day = match[2];
    const year = match[3];
    if (!month || !day || !year) return null;
    value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

export function parseNumber(raw: string): number | null {
  const normalized = raw.trim().replaceAll(",", "");
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseBoolean(raw: string, defaultValue: boolean): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return defaultValue;
  if (["true", "yes", "y", "1", "pooled"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "dedicated"].includes(normalized)) return false;
  return null;
}

export function parseFactor(raw: string, format: FactorFormat): number | null {
  const parsed = parseNumber(raw);
  if (parsed === null) return null;
  const value = format === "percent" ? parsed / 100 : parsed;
  return value >= 0 && value <= 1 ? value : null;
}

export function rowHasError(issues: ImportIssue[]): boolean {
  return issues.some(issue => issue.severity === "error");
}

export function warningRowCount(issuesByRow: Map<number, ImportIssue[]>): number {
  return [...issuesByRow.values()].filter(issues => !rowHasError(issues) && issues.some(issue => issue.severity === "warning")).length;
}

export function mergeById<T extends { id: string }>(
  existing: T[],
  imported: T[],
  mode: MergeMode,
): { records: T[]; addedRecords: number; replacedRecords: number; unchangedRecords: number } {
  const current = new Map(existing.map(record => [record.id, record]));
  let addedRecords = 0;
  let replacedRecords = 0;
  let unchangedRecords = 0;

  for (const record of imported) {
    const prior = current.get(record.id);
    if (prior && mode === "append") throw new Error(`ID already exists in append mode: ${record.id}`);
    if (!prior) addedRecords += 1;
    else if (JSON.stringify(prior) === JSON.stringify(record)) unchangedRecords += 1;
    else replacedRecords += 1;
    current.set(record.id, record);
  }

  return { records: [...current.values()], addedRecords, replacedRecords, unchangedRecords };
}

export function assertAtomicModel(model: CapacityModel, validate: (model: CapacityModel) => boolean): CapacityModel {
  const copy = JSON.parse(JSON.stringify(model)) as CapacityModel;
  if (!validate(copy)) throw new Error("Imported records produce an invalid capacity model");
  return copy;
}
