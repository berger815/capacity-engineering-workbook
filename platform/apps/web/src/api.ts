import {
  capacityModelSchema,
  type CalculationResult,
  type CapacityModel,
  type ConstraintExplanation,
  type ScenarioComparisonResult,
} from "@capacity/domain";
import { calculateCapacity, compareCapacityScenarios } from "@capacity/engine";
import { explainConstraint } from "@capacity/engine/explain";
import { northstarRecoveryModel } from "@capacity/fixtures";
import type { DemandCsvMapping } from "@capacity/importer";
import { importDemandCsv, mergeDemandImport } from "@capacity/importer";
import { buildDecisionPackage, renderDecisionPackageHtml, serializeDecisionPackage } from "@capacity/reporting";

const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "true";

export interface ModelValidationResult {
  valid: boolean;
  modelId?: string;
  counts?: {
    products: number;
    resourceGroups: number;
    routingRevisions: number;
    demandRecords: number;
    scenarios?: number;
    scenarioActions?: number;
  };
  issues?: Array<{ path: string; message: string; code: string }>;
}

export interface DemandMapping {
  productColumn: string;
  shipDateColumn: string;
  quantityColumn: string;
  productMatch: "id" | "name" | "externalKey";
  productExternalKey?: string;
  dateFormat?: "iso" | "us";
  demandClassColumn?: string;
  customerOrProgramColumn?: string;
  sourceRecordIdColumn?: string;
  defaultDemandClass?: "firm" | "forecast" | "upside" | "downside";
  sourceSystem?: string;
}

export interface DemandImportPreview {
  records: CapacityModel["demand"];
  issues: Array<{
    rowNumber?: number;
    entityKey?: string;
    severity: "error" | "warning";
    code: string;
    message: string;
    column?: string;
    value?: string;
  }>;
  controlTotals: {
    inputRows: number;
    acceptedRows: number;
    rejectedRows: number;
    totalQuantity: number;
    quantityByProduct: Record<string, number>;
    earliestShipDate: string | null;
    latestShipDate: string | null;
  };
}

export interface DecisionReportDownload {
  filename: string;
  mimeType: string;
  content: string;
  decision: {
    classification: "supportable" | "conditional" | "notSupportable" | "incomplete";
    statement: string;
    baselineScenarioId: string;
    comparisonScenarioId: string;
    resolvedGapPeriods: number;
    remainingGapPeriods: number;
    worsenedGapPeriods: number;
  };
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
  issues?: unknown;
}

function copyModel(model: CapacityModel): CapacityModel {
  return JSON.parse(JSON.stringify(model)) as CapacityModel;
}

function localValidation(model: CapacityModel): ModelValidationResult {
  const validation = capacityModelSchema.safeParse(model);
  if (!validation.success) {
    return {
      valid: false,
      issues: validation.error.issues.map(issue => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
        code: issue.code,
      })),
    };
  }

  return {
    valid: true,
    modelId: validation.data.modelId,
    counts: {
      products: validation.data.products.length,
      resourceGroups: validation.data.resourceGroups.length,
      routingRevisions: validation.data.routingRevisions.length,
      demandRecords: validation.data.demand.length,
      scenarios: validation.data.scenarios.length,
      scenarioActions: validation.data.scenarioActions?.length ?? 0,
    },
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(path, { ...init, headers });
  const payload = await response.json() as T | ApiErrorPayload;
  if (!response.ok) {
    const error = payload as ApiErrorPayload;
    throw new Error(error.message ?? error.code ?? `Request failed with status ${response.status}`);
  }
  return payload as T;
}

export function loadNorthstar(): Promise<CapacityModel> {
  return STATIC_DEMO
    ? Promise.resolve(copyModel(northstarRecoveryModel))
    : request<CapacityModel>("/v1/fixtures/northstar-v2");
}

export function validateModel(model: CapacityModel): Promise<ModelValidationResult> {
  return STATIC_DEMO
    ? Promise.resolve(localValidation(model))
    : request<ModelValidationResult>("/v1/validate", {
        method: "POST",
        body: JSON.stringify({ model }),
      });
}

export function calculateModel(model: CapacityModel, scenarioId: string): Promise<CalculationResult> {
  return STATIC_DEMO
    ? Promise.resolve(calculateCapacity(model, scenarioId))
    : request<CalculationResult>("/v1/calculate", {
        method: "POST",
        body: JSON.stringify({ model, scenarioId }),
      });
}

export function compareModels(
  model: CapacityModel,
  baselineScenarioId: string,
  comparisonScenarioId: string,
): Promise<ScenarioComparisonResult> {
  return STATIC_DEMO
    ? Promise.resolve(compareCapacityScenarios(model, baselineScenarioId, comparisonScenarioId))
    : request<ScenarioComparisonResult>("/v1/compare", {
        method: "POST",
        body: JSON.stringify({ model, baselineScenarioId, comparisonScenarioId }),
      });
}

export function explainResourcePeriod(
  model: CapacityModel,
  scenarioId: string,
  resourceGroupId: string,
  periodStart: string,
): Promise<ConstraintExplanation> {
  return STATIC_DEMO
    ? Promise.resolve(explainConstraint(model, scenarioId, resourceGroupId, periodStart))
    : request<ConstraintExplanation>("/v1/explain", {
        method: "POST",
        body: JSON.stringify({ model, scenarioId, resourceGroupId, periodStart }),
      });
}

export function generateDecisionReport(
  model: CapacityModel,
  baselineScenarioId: string,
  comparisonScenarioId: string,
  format: "html" | "json",
): Promise<DecisionReportDownload> {
  if (STATIC_DEMO) {
    const comparison = compareCapacityScenarios(model, baselineScenarioId, comparisonScenarioId);
    const decisionPackage = buildDecisionPackage(model, comparison);
    const safeName = model.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
    return Promise.resolve(format === "html"
      ? {
          filename: `${safeName || "capacity-assurance"}-decision.html`,
          mimeType: "text/html;charset=utf-8",
          content: renderDecisionPackageHtml(decisionPackage),
          decision: decisionPackage.decision,
        }
      : {
          filename: `${safeName || "capacity-assurance"}-portable-assessment.json`,
          mimeType: "application/json;charset=utf-8",
          content: serializeDecisionPackage(decisionPackage),
          decision: decisionPackage.decision,
        });
  }

  return request<DecisionReportDownload>("/v1/report/decision", {
    method: "POST",
    body: JSON.stringify({ model, baselineScenarioId, comparisonScenarioId, format }),
  });
}

export function previewDemandImport(
  model: CapacityModel,
  scenarioId: string,
  csv: string,
  mapping: DemandMapping,
): Promise<DemandImportPreview> {
  return STATIC_DEMO
    ? Promise.resolve(importDemandCsv(csv, model.products, scenarioId, mapping as DemandCsvMapping))
    : request<DemandImportPreview>("/v1/import/demand/preview", {
        method: "POST",
        body: JSON.stringify({ model, scenarioId, csv, mapping }),
      });
}

export function applyDemandImport(
  model: CapacityModel,
  scenarioId: string,
  csv: string,
  mapping: DemandMapping,
  acceptPartial = false,
): Promise<{ model: CapacityModel; import: DemandImportPreview }> {
  if (STATIC_DEMO) {
    const imported = importDemandCsv(csv, model.products, scenarioId, mapping as DemandCsvMapping);
    const hasErrors = imported.issues.some(issue => issue.severity === "error");
    if (hasErrors && !acceptPartial) {
      return Promise.reject(new Error("Import contains rejected rows; enable partial import to apply accepted rows"));
    }
    return Promise.resolve({ model: mergeDemandImport(model, scenarioId, imported.records), import: imported });
  }

  return request<{ model: CapacityModel; import: DemandImportPreview }>("/v1/import/demand/apply", {
    method: "POST",
    body: JSON.stringify({ model, scenarioId, csv, mapping, acceptPartial }),
  });
}
