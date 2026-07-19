import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CapacityModel } from "@capacity/domain";
import { capacityModelSchema } from "@capacity/domain";
import { calculateCapacity, compareCapacityScenarios } from "@capacity/engine";
import { explainConstraint } from "@capacity/engine/explain";
import { northstarRecoveryModel } from "@capacity/fixtures";
import type { DemandCsvMapping } from "@capacity/importer";
import { importDemandCsv, mergeDemandImport } from "@capacity/importer";
import { buildDecisionPackage, renderDecisionPackageHtml, serializeDecisionPackage } from "@capacity/reporting";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface ApiResult {
  statusCode: number;
  body: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationFailure(issues: Array<{ path: PropertyKey[]; message: string; code: string }>): ApiResult {
  return {
    statusCode: 422,
    body: {
      code: "MODEL_VALIDATION_FAILED",
      issues: issues.map(issue => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
        code: issue.code,
      })),
    },
  };
}

function validateImportRequest(body: unknown):
  | { ok: true; model: CapacityModel; scenarioId: string; csv: string; mapping: DemandCsvMapping; acceptPartial: boolean }
  | { ok: false; result: ApiResult } {
  if (!isRecord(body)) {
    return { ok: false, result: { statusCode: 400, body: { code: "INVALID_REQUEST", message: "JSON object required" } } };
  }

  const scenarioId = body.scenarioId;
  const csv = body.csv;
  const mapping = body.mapping;
  if (typeof scenarioId !== "string" || scenarioId.length === 0) {
    return { ok: false, result: { statusCode: 400, body: { code: "SCENARIO_REQUIRED", message: "scenarioId is required" } } };
  }
  if (typeof csv !== "string") {
    return { ok: false, result: { statusCode: 400, body: { code: "CSV_REQUIRED", message: "csv must be a string" } } };
  }
  if (!isRecord(mapping)) {
    return { ok: false, result: { statusCode: 400, body: { code: "MAPPING_REQUIRED", message: "mapping must be an object" } } };
  }

  const validation = capacityModelSchema.safeParse(body.model);
  if (!validation.success) return { ok: false, result: validationFailure(validation.error.issues) };

  return {
    ok: true,
    model: validation.data as CapacityModel,
    scenarioId,
    csv,
    mapping: mapping as unknown as DemandCsvMapping,
    acceptPartial: body.acceptPartial === true,
  };
}

function validatedModel(body: Record<string, unknown>): { model: CapacityModel } | { result: ApiResult } {
  const validation = capacityModelSchema.safeParse(body.model);
  return validation.success
    ? { model: validation.data as CapacityModel }
    : { result: validationFailure(validation.error.issues) };
}

function comparisonIds(body: Record<string, unknown>):
  | { baselineScenarioId: string; comparisonScenarioId: string }
  | { result: ApiResult } {
  const baselineScenarioId = body.baselineScenarioId;
  const comparisonScenarioId = body.comparisonScenarioId;
  if (typeof baselineScenarioId !== "string" || baselineScenarioId.length === 0) {
    return { result: { statusCode: 400, body: { code: "BASELINE_SCENARIO_REQUIRED", message: "baselineScenarioId is required" } } };
  }
  if (typeof comparisonScenarioId !== "string" || comparisonScenarioId.length === 0) {
    return { result: { statusCode: 400, body: { code: "COMPARISON_SCENARIO_REQUIRED", message: "comparisonScenarioId is required" } } };
  }
  return { baselineScenarioId, comparisonScenarioId };
}

export function routeApiRequest(method: string, path: string, body?: unknown): ApiResult {
  if (method === "GET" && path === "/health") {
    return {
      statusCode: 200,
      body: {
        status: "ok",
        service: "capacity-assurance-api",
        schemaVersion: "1.0.0",
      },
    };
  }

  if (method === "GET" && path === "/v1/fixtures/northstar-v2") {
    return { statusCode: 200, body: northstarRecoveryModel };
  }

  if (method === "POST" && path === "/v1/validate") {
    const candidate = isRecord(body) && "model" in body ? body.model : body;
    const validation = capacityModelSchema.safeParse(candidate);
    return validation.success
      ? {
          statusCode: 200,
          body: {
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
          },
        }
      : {
          ...validationFailure(validation.error.issues),
          body: {
            valid: false,
            ...(validationFailure(validation.error.issues).body as Record<string, unknown>),
          },
        };
  }

  if (method === "POST" && path === "/v1/import/demand/preview") {
    const request = validateImportRequest(body);
    if (!request.ok) return request.result;
    try {
      return { statusCode: 200, body: importDemandCsv(request.csv, request.model.products, request.scenarioId, request.mapping) };
    } catch (error) {
      return {
        statusCode: 400,
        body: { code: "IMPORT_REJECTED", message: error instanceof Error ? error.message : "Import rejected" },
      };
    }
  }

  if (method === "POST" && path === "/v1/import/demand/apply") {
    const request = validateImportRequest(body);
    if (!request.ok) return request.result;
    try {
      const imported = importDemandCsv(request.csv, request.model.products, request.scenarioId, request.mapping);
      const hasErrors = imported.issues.some(issue => issue.severity === "error");
      if (hasErrors && !request.acceptPartial) {
        return {
          statusCode: 422,
          body: {
            code: "IMPORT_HAS_REJECTED_ROWS",
            message: "Import contains rejected rows; set acceptPartial=true to apply accepted rows",
            import: imported,
          },
        };
      }
      const model = mergeDemandImport(request.model, request.scenarioId, imported.records);
      return { statusCode: 200, body: { model, import: imported } };
    } catch (error) {
      return {
        statusCode: 400,
        body: { code: "IMPORT_REJECTED", message: error instanceof Error ? error.message : "Import rejected" },
      };
    }
  }

  if (method === "POST" && path === "/v1/calculate") {
    if (!isRecord(body)) return { statusCode: 400, body: { code: "INVALID_REQUEST", message: "JSON object required" } };
    const scenarioId = body.scenarioId;
    if (typeof scenarioId !== "string" || scenarioId.length === 0) {
      return { statusCode: 400, body: { code: "SCENARIO_REQUIRED", message: "scenarioId is required" } };
    }
    const validation = validatedModel(body);
    if ("result" in validation) return validation.result;

    try {
      return { statusCode: 200, body: calculateCapacity(validation.model, scenarioId) };
    } catch (error) {
      return {
        statusCode: 400,
        body: { code: "CALCULATION_REJECTED", message: error instanceof Error ? error.message : "Calculation rejected" },
      };
    }
  }

  if (method === "POST" && path === "/v1/compare") {
    if (!isRecord(body)) return { statusCode: 400, body: { code: "INVALID_REQUEST", message: "JSON object required" } };
    const ids = comparisonIds(body);
    if ("result" in ids) return ids.result;
    const validation = validatedModel(body);
    if ("result" in validation) return validation.result;

    try {
      return {
        statusCode: 200,
        body: compareCapacityScenarios(validation.model, ids.baselineScenarioId, ids.comparisonScenarioId),
      };
    } catch (error) {
      return {
        statusCode: 400,
        body: { code: "COMPARISON_REJECTED", message: error instanceof Error ? error.message : "Comparison rejected" },
      };
    }
  }

  if (method === "POST" && path === "/v1/explain") {
    if (!isRecord(body)) return { statusCode: 400, body: { code: "INVALID_REQUEST", message: "JSON object required" } };
    const scenarioId = body.scenarioId;
    const resourceGroupId = body.resourceGroupId;
    const periodStart = body.periodStart;
    if (typeof scenarioId !== "string" || scenarioId.length === 0) {
      return { statusCode: 400, body: { code: "SCENARIO_REQUIRED", message: "scenarioId is required" } };
    }
    if (typeof resourceGroupId !== "string" || resourceGroupId.length === 0) {
      return { statusCode: 400, body: { code: "RESOURCE_GROUP_REQUIRED", message: "resourceGroupId is required" } };
    }
    if (typeof periodStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
      return { statusCode: 400, body: { code: "PERIOD_START_INVALID", message: "periodStart must be an ISO date" } };
    }
    const validation = validatedModel(body);
    if ("result" in validation) return validation.result;

    try {
      return {
        statusCode: 200,
        body: explainConstraint(validation.model, scenarioId, resourceGroupId, periodStart),
      };
    } catch (error) {
      return {
        statusCode: 400,
        body: { code: "EXPLANATION_REJECTED", message: error instanceof Error ? error.message : "Constraint explanation rejected" },
      };
    }
  }

  if (method === "POST" && path === "/v1/report/decision") {
    if (!isRecord(body)) return { statusCode: 400, body: { code: "INVALID_REQUEST", message: "JSON object required" } };
    const ids = comparisonIds(body);
    if ("result" in ids) return ids.result;
    const validation = validatedModel(body);
    if ("result" in validation) return validation.result;
    const format = body.format ?? "html";
    if (format !== "html" && format !== "json") {
      return { statusCode: 400, body: { code: "REPORT_FORMAT_INVALID", message: "format must be html or json" } };
    }

    try {
      const comparison = compareCapacityScenarios(validation.model, ids.baselineScenarioId, ids.comparisonScenarioId);
      const decisionPackage = buildDecisionPackage(validation.model, comparison);
      const safeName = validation.model.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
      return format === "html"
        ? {
            statusCode: 200,
            body: {
              filename: `${safeName || "capacity-assurance"}-decision.html`,
              mimeType: "text/html;charset=utf-8",
              content: renderDecisionPackageHtml(decisionPackage),
              decision: decisionPackage.decision,
            },
          }
        : {
            statusCode: 200,
            body: {
              filename: `${safeName || "capacity-assurance"}-portable-assessment.json`,
              mimeType: "application/json;charset=utf-8",
              content: serializeDecisionPackage(decisionPackage),
              decision: decisionPackage.decision,
            },
          };
    } catch (error) {
      return {
        statusCode: 400,
        body: { code: "REPORT_REJECTED", message: error instanceof Error ? error.message : "Decision report rejected" },
      };
    }
  }

  return { statusCode: 404, body: { code: "NOT_FOUND", message: `${method} ${path} not found` } };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJson(response: ServerResponse, result: ApiResult): void {
  const payload = JSON.stringify(result.body);
  response.statusCode = result.statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

export function createCapacityApiServer(): Server {
  return createServer((request, response) => {
    void (async () => {
      try {
        const method = request.method ?? "GET";
        const url = new URL(request.url ?? "/", "http://capacity.local");
        const body = method === "POST" || method === "PUT" || method === "PATCH" ? await readJsonBody(request) : undefined;
        writeJson(response, routeApiRequest(method, url.pathname, body));
      } catch (error) {
        if (error instanceof SyntaxError) {
          writeJson(response, { statusCode: 400, body: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
          return;
        }
        if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
          writeJson(response, { statusCode: 413, body: { code: "REQUEST_TOO_LARGE", message: "Request exceeds 10 MB" } });
          return;
        }
        writeJson(response, { statusCode: 500, body: { code: "INTERNAL_ERROR", message: "Unexpected server error" } });
      }
    })();
  });
}
