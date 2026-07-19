import type { CapacityModel, Resource } from "@capacity/domain";
import { parseCsvTable } from "./csv.js";
import {
  type BaseImportControlTotals,
  type BaseImportMapping,
  type FactorFormat,
  type ImportDateFormat,
  type ImportIssue,
  type ImportResult,
  type MergeMode,
  mergeById,
  parseFactor,
  parseIsoDate,
  parseNumber,
  requiredHeaders,
  rowHasError,
  textValue,
  warningRowCount,
} from "./shared.js";

export interface ResourceCsvMapping extends BaseImportMapping {
  resourceIdColumn: string;
  resourceNameColumn: string;
  resourceGroupIdColumn: string;
  calendarIdColumn?: string;
  quantityColumn: string;
  ratePerAvailableHourColumn: string;
  availabilityColumn: string;
  performanceColumn: string;
  qualityColumn: string;
  effectiveFromColumn?: string;
  effectiveToColumn?: string;
  dateFormat?: ImportDateFormat;
  factorFormat?: FactorFormat;
  externalKeyColumn?: string;
  externalKeyName?: string;
}

export interface ResourceImportControlTotals extends BaseImportControlTotals {
  totalResources: number;
  totalQuantity: number;
  earliestEffectiveFrom: string | null;
  latestEffectiveTo: string | null;
}

export type ResourceImportResult = ImportResult<Resource, ResourceImportControlTotals>;

export function importResourcesCsv(
  csv: string,
  model: CapacityModel,
  mapping: ResourceCsvMapping,
  mode: MergeMode = "replaceById",
): ResourceImportResult {
  const table = parseCsvTable(csv, mapping.delimiter ?? ",");
  const missing = requiredHeaders(table.headers, [
    mapping.resourceIdColumn,
    mapping.resourceNameColumn,
    mapping.resourceGroupIdColumn,
    mapping.calendarIdColumn,
    mapping.quantityColumn,
    mapping.ratePerAvailableHourColumn,
    mapping.availabilityColumn,
    mapping.performanceColumn,
    mapping.qualityColumn,
    mapping.effectiveFromColumn,
    mapping.effectiveToColumn,
    mapping.externalKeyColumn,
  ]);
  if (missing.length > 0) throw new Error(`CSV is missing mapped columns: ${missing.join(", ")}`);
  if (mapping.externalKeyColumn && !mapping.externalKeyName) throw new Error("externalKeyName is required when externalKeyColumn is mapped");

  const groups = new Map(model.resourceGroups.map(group => [group.id, group]));
  const seenIds = new Set<string>();
  const records: Resource[] = [];
  const issues: ImportIssue[] = [];
  const issuesByRow = new Map<number, ImportIssue[]>();
  let totalQuantity = 0;
  let earliestEffectiveFrom: string | null = null;
  let latestEffectiveTo: string | null = null;

  table.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowIssues: ImportIssue[] = [];
    const id = textValue(row, mapping.resourceIdColumn, mapping);
    const name = textValue(row, mapping.resourceNameColumn, mapping);
    const resourceGroupId = textValue(row, mapping.resourceGroupIdColumn, mapping);
    const calendarId = textValue(row, mapping.calendarIdColumn, mapping);
    const quantityRaw = textValue(row, mapping.quantityColumn, mapping);
    const rateRaw = textValue(row, mapping.ratePerAvailableHourColumn, mapping);
    const availabilityRaw = textValue(row, mapping.availabilityColumn, mapping);
    const performanceRaw = textValue(row, mapping.performanceColumn, mapping);
    const qualityRaw = textValue(row, mapping.qualityColumn, mapping);
    const fromRaw = textValue(row, mapping.effectiveFromColumn, mapping);
    const toRaw = textValue(row, mapping.effectiveToColumn, mapping);
    const externalKey = textValue(row, mapping.externalKeyColumn, mapping);
    const group = groups.get(resourceGroupId);
    const quantity = parseNumber(quantityRaw);
    const rate = parseNumber(rateRaw);
    const factorFormat = mapping.factorFormat ?? "decimal";
    const availability = parseFactor(availabilityRaw, factorFormat);
    const performance = parseFactor(performanceRaw, factorFormat);
    const quality = parseFactor(qualityRaw, factorFormat);
    const effectiveFrom = fromRaw ? parseIsoDate(fromRaw, mapping.dateFormat ?? "iso") : null;
    const effectiveTo = toRaw ? parseIsoDate(toRaw, mapping.dateFormat ?? "iso") : null;

    if (!id) rowIssues.push({ rowNumber, severity: "error", code: "RESOURCE_ID_REQUIRED", message: "Resource ID is required", column: mapping.resourceIdColumn });
    if (!name) rowIssues.push({ rowNumber, severity: "error", code: "RESOURCE_NAME_REQUIRED", message: "Resource name is required", column: mapping.resourceNameColumn });
    if (id && seenIds.has(id)) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "RESOURCE_ID_DUPLICATE", message: `Duplicate resource ID '${id}'`, column: mapping.resourceIdColumn, value: id });
    if (!group) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "RESOURCE_GROUP_UNKNOWN", message: `Resource group '${resourceGroupId}' was not found`, column: mapping.resourceGroupIdColumn, value: resourceGroupId });
    if (calendarId && group && calendarId !== group.calendarId) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "CALENDAR_UNKNOWN", message: `Calendar '${calendarId}' does not match resource group calendar '${group.calendarId}'`, column: mapping.calendarIdColumn, value: calendarId });
    if (quantity === null || quantity <= 0) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "QUANTITY_INVALID", message: `Quantity must be greater than zero; received '${quantityRaw}'`, column: mapping.quantityColumn, value: quantityRaw });
    if (rate === null || rate <= 0) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "RATE_INVALID", message: `Capacity conversion rate must be greater than zero; received '${rateRaw}'`, column: mapping.ratePerAvailableHourColumn, value: rateRaw });
    ([
      ["availability", availability, availabilityRaw, mapping.availabilityColumn],
      ["performance", performance, performanceRaw, mapping.performanceColumn],
      ["quality", quality, qualityRaw, mapping.qualityColumn],
    ] as const).forEach(([label, value, raw, column]) => {
      if (value === null) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "FACTOR_OUT_OF_RANGE", message: `${label} must resolve to a value from 0 to 1; received '${raw}' using ${factorFormat} format`, column, value: raw });
    });
    if (fromRaw && !effectiveFrom) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "EFFECTIVE_DATE_INVALID", message: `Invalid effectiveFrom '${fromRaw}'`, column: mapping.effectiveFromColumn, value: fromRaw });
    if (toRaw && !effectiveTo) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "EFFECTIVE_DATE_INVALID", message: `Invalid effectiveTo '${toRaw}'`, column: mapping.effectiveToColumn, value: toRaw });
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "EFFECTIVE_RANGE_INVALID", message: "effectiveTo must be on or after effectiveFrom" });

    if (id) seenIds.add(id);
    issuesByRow.set(rowNumber, rowIssues);
    issues.push(...rowIssues);
    if (rowHasError(rowIssues) || !id || !name || !group || quantity === null || rate === null || availability === null || performance === null || quality === null) return;

    const record: Resource = {
      id,
      resourceGroupId,
      name,
      quantity,
      ratePerAvailableHour: rate,
      availability,
      performance,
      quality,
      ...(effectiveFrom ? { effectiveFrom } : {}),
      ...(effectiveTo ? { effectiveTo } : {}),
      ...(externalKey && mapping.externalKeyName ? { externalKeys: { [mapping.externalKeyName]: externalKey } } : {}),
    };
    records.push(record);
    totalQuantity += quantity;
    if (effectiveFrom) earliestEffectiveFrom = earliestEffectiveFrom === null || effectiveFrom < earliestEffectiveFrom ? effectiveFrom : earliestEffectiveFrom;
    if (effectiveTo) latestEffectiveTo = latestEffectiveTo === null || effectiveTo > latestEffectiveTo ? effectiveTo : latestEffectiveTo;
  });

  const merged = mergeById(model.resources, records, mode);
  return {
    records,
    issues,
    controlTotals: {
      inputRows: table.rows.length,
      acceptedRows: records.length,
      rejectedRows: table.rows.length - records.length,
      warningRows: warningRowCount(issuesByRow),
      addedRecords: merged.addedRecords,
      replacedRecords: merged.replacedRecords,
      unchangedRecords: merged.unchangedRecords,
      totalResources: records.length,
      totalQuantity,
      earliestEffectiveFrom,
      latestEffectiveTo,
    },
  };
}

export function mergeResourcesImport(model: CapacityModel, records: Resource[], mode: MergeMode = "replaceById"): CapacityModel {
  const merged = mergeById(model.resources, records, mode);
  return { ...model, resources: merged.records };
}
