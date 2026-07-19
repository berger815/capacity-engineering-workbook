import type { CapacityModel, DemandRecord, Product } from "@capacity/domain";
import { parseCsvTable } from "./csv.js";

export type ProductMatchMode = "id" | "name" | "externalKey";
export type ImportDateFormat = "iso" | "us";

export interface DemandCsvMapping {
  productColumn: string;
  shipDateColumn: string;
  quantityColumn: string;
  productMatch: ProductMatchMode;
  productExternalKey?: string;
  dateFormat?: ImportDateFormat;
  demandClassColumn?: string;
  customerOrProgramColumn?: string;
  sourceRecordIdColumn?: string;
  defaultDemandClass?: "firm" | "forecast" | "upside" | "downside";
  sourceSystem?: string;
  delimiter?: string;
}

export interface ImportIssue {
  rowNumber: number;
  severity: "error" | "warning";
  code: string;
  message: string;
  column?: string;
  value?: string;
}

export interface DemandImportControlTotals {
  inputRows: number;
  acceptedRows: number;
  rejectedRows: number;
  totalQuantity: number;
  quantityByProduct: Record<string, number>;
  earliestShipDate: string | null;
  latestShipDate: string | null;
}

export interface DemandImportResult {
  records: DemandRecord[];
  issues: ImportIssue[];
  controlTotals: DemandImportControlTotals;
}

function normalizeDate(raw: string, format: ImportDateFormat): string | null {
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

function resolveProduct(products: Product[], raw: string, mapping: DemandCsvMapping): Product | undefined {
  const key = raw.trim();
  if (mapping.productMatch === "id") return products.find(product => product.id === key);
  if (mapping.productMatch === "name") return products.find(product => product.name === key);

  const externalKey = mapping.productExternalKey;
  if (!externalKey) throw new Error("productExternalKey is required when productMatch=externalKey");
  return products.find(product => product.externalKeys?.[externalKey] === key);
}

function parseDemandClass(value: string): DemandRecord["demandClass"] | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "firm" || normalized === "forecast" || normalized === "upside" || normalized === "downside"
    ? normalized
    : null;
}

function requiredColumns(mapping: DemandCsvMapping): string[] {
  return [
    mapping.productColumn,
    mapping.shipDateColumn,
    mapping.quantityColumn,
    ...(mapping.demandClassColumn ? [mapping.demandClassColumn] : []),
    ...(mapping.customerOrProgramColumn ? [mapping.customerOrProgramColumn] : []),
    ...(mapping.sourceRecordIdColumn ? [mapping.sourceRecordIdColumn] : []),
  ];
}

export function importDemandCsv(
  csv: string,
  products: Product[],
  scenarioId: string,
  mapping: DemandCsvMapping,
): DemandImportResult {
  const table = parseCsvTable(csv, mapping.delimiter ?? ",");
  const missingHeaders = requiredColumns(mapping).filter(column => !table.headers.includes(column));
  if (missingHeaders.length > 0) throw new Error(`CSV is missing mapped columns: ${missingHeaders.join(", ")}`);

  const records: DemandRecord[] = [];
  const issues: ImportIssue[] = [];
  const quantityByProduct: Record<string, number> = {};
  let totalQuantity = 0;
  let earliestShipDate: string | null = null;
  let latestShipDate: string | null = null;

  table.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowIssues: ImportIssue[] = [];
    const productRaw = row[mapping.productColumn] ?? "";
    const product = resolveProduct(products, productRaw, mapping);
    if (!product) {
      rowIssues.push({
        rowNumber,
        severity: "error",
        code: "PRODUCT_NOT_FOUND",
        message: `No product matched '${productRaw}'`,
        column: mapping.productColumn,
        value: productRaw,
      });
    }

    const dateRaw = row[mapping.shipDateColumn] ?? "";
    const shipDate = normalizeDate(dateRaw, mapping.dateFormat ?? "iso");
    if (!shipDate) {
      rowIssues.push({
        rowNumber,
        severity: "error",
        code: "SHIP_DATE_INVALID",
        message: `Invalid ship date '${dateRaw}'`,
        column: mapping.shipDateColumn,
        value: dateRaw,
      });
    }

    const quantityRaw = row[mapping.quantityColumn] ?? "";
    const quantity = Number(quantityRaw.trim().replaceAll(",", ""));
    if (!Number.isFinite(quantity) || quantity < 0) {
      rowIssues.push({
        rowNumber,
        severity: "error",
        code: "QUANTITY_INVALID",
        message: `Invalid nonnegative quantity '${quantityRaw}'`,
        column: mapping.quantityColumn,
        value: quantityRaw,
      });
    }

    let demandClass = mapping.defaultDemandClass;
    if (mapping.demandClassColumn) {
      const classRaw = row[mapping.demandClassColumn] ?? "";
      const parsed = parseDemandClass(classRaw);
      if (classRaw.trim().length > 0 && !parsed) {
        rowIssues.push({
          rowNumber,
          severity: "error",
          code: "DEMAND_CLASS_INVALID",
          message: `Invalid demand class '${classRaw}'`,
          column: mapping.demandClassColumn,
          value: classRaw,
        });
      } else if (parsed) {
        demandClass = parsed;
      }
    }

    issues.push(...rowIssues);
    if (rowIssues.some(issue => issue.severity === "error") || !product || !shipDate || !Number.isFinite(quantity) || quantity < 0) return;

    const sourceRecordId = mapping.sourceRecordIdColumn ? (row[mapping.sourceRecordIdColumn] ?? "").trim() : "";
    const customerOrProgram = mapping.customerOrProgramColumn ? (row[mapping.customerOrProgramColumn] ?? "").trim() : "";
    const record: DemandRecord = {
      id: sourceRecordId.length > 0 ? `import-${scenarioId}-${sourceRecordId}` : `import-${scenarioId}-row-${rowNumber}`,
      scenarioId,
      productId: product.id,
      shipDate,
      quantity,
      ...(demandClass ? { demandClass } : {}),
      ...(customerOrProgram.length > 0 ? { customerOrProgram } : {}),
      ...(mapping.sourceSystem ? { sourceSystem: mapping.sourceSystem } : {}),
      ...(sourceRecordId.length > 0 ? { sourceRecordId } : {}),
    };

    records.push(record);
    totalQuantity += quantity;
    quantityByProduct[product.id] = (quantityByProduct[product.id] ?? 0) + quantity;
    earliestShipDate = earliestShipDate === null || shipDate < earliestShipDate ? shipDate : earliestShipDate;
    latestShipDate = latestShipDate === null || shipDate > latestShipDate ? shipDate : latestShipDate;
  });

  return {
    records,
    issues,
    controlTotals: {
      inputRows: table.rows.length,
      acceptedRows: records.length,
      rejectedRows: table.rows.length - records.length,
      totalQuantity,
      quantityByProduct,
      earliestShipDate,
      latestShipDate,
    },
  };
}

export function mergeDemandImport(
  model: CapacityModel,
  scenarioId: string,
  records: DemandRecord[],
  mode: "append" | "replaceScenario" = "replaceScenario",
): CapacityModel {
  if (!model.scenarios.some(scenario => scenario.id === scenarioId)) throw new Error(`Scenario not found: ${scenarioId}`);
  if (records.some(record => record.scenarioId !== scenarioId)) throw new Error("Imported demand contains a different scenarioId");

  const retained = mode === "replaceScenario"
    ? model.demand.filter(record => record.scenarioId !== scenarioId)
    : model.demand;

  return { ...model, demand: [...retained, ...records] };
}
