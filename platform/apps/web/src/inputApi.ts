import { capacityModelSchema, type CapacityModel } from "@capacity/domain";
import {
  importCalendarsCsv,
  importDemandCsv,
  importProductsCsv,
  importResourceGroupsCsv,
  importResourcesCsv,
  importRoutingCsv,
  mergeCalendarsImport,
  mergeDemandImport,
  mergeProductsImport,
  mergeResourceGroupsImport,
  mergeResourcesImport,
  mergeRoutingImport,
  type CalendarCsvMapping,
  type CalendarExceptionCsvMapping,
  type DemandCsvMapping,
  type ImportResult,
  type MergeMode,
  type ProductCsvMapping,
  type ResourceCsvMapping,
  type ResourceGroupCsvMapping,
  type RoutingCsvMapping,
} from "@capacity/importer";

const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "true";

export type InputEntity = "calendars" | "resource-groups" | "resources" | "products" | "routing" | "demand";
export type InputPreview = ImportResult<unknown>;

export interface InputImportOptions {
  mode?: MergeMode;
  acceptPartial?: boolean;
  scenarioId?: string;
  exceptionsCsv?: string;
  exceptionMapping?: CalendarExceptionCsvMapping;
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T | ApiErrorPayload;
  if (!response.ok) {
    const error = payload as ApiErrorPayload;
    throw new Error(error.message ?? error.code ?? `Request failed with status ${response.status}`);
  }
  return payload as T;
}

function localPreview(
  entity: InputEntity,
  model: CapacityModel,
  csv: string,
  mapping: Record<string, unknown>,
  options: InputImportOptions,
): InputPreview {
  const mode = options.mode ?? "replaceById";
  switch (entity) {
    case "calendars":
      return importCalendarsCsv(
        csv,
        options.exceptionsCsv,
        model,
        mapping as unknown as CalendarCsvMapping,
        options.exceptionMapping,
        mode,
      ) as InputPreview;
    case "resource-groups":
      return importResourceGroupsCsv(csv, model, mapping as unknown as ResourceGroupCsvMapping, mode) as InputPreview;
    case "resources":
      return importResourcesCsv(csv, model, mapping as unknown as ResourceCsvMapping, mode) as InputPreview;
    case "products":
      return importProductsCsv(csv, model, mapping as unknown as ProductCsvMapping, mode) as InputPreview;
    case "routing":
      return importRoutingCsv(csv, model, mapping as unknown as RoutingCsvMapping) as InputPreview;
    case "demand": {
      const scenarioId = options.scenarioId;
      if (!scenarioId) throw new Error("scenarioId is required for demand import");
      return importDemandCsv(csv, model.products, scenarioId, mapping as unknown as DemandCsvMapping) as InputPreview;
    }
  }
}

function localApply(
  entity: InputEntity,
  model: CapacityModel,
  imported: InputPreview,
  options: InputImportOptions,
): CapacityModel {
  const mode = options.mode ?? "replaceById";
  switch (entity) {
    case "calendars":
      return mergeCalendarsImport(model, imported.records as CapacityModel["calendars"], mode);
    case "resource-groups":
      return mergeResourceGroupsImport(model, imported.records as CapacityModel["resourceGroups"], mode);
    case "resources":
      return mergeResourcesImport(model, imported.records as CapacityModel["resources"], mode);
    case "products":
      return mergeProductsImport(model, imported.records as CapacityModel["products"], mode);
    case "routing":
      return mergeRoutingImport(model, imported.records as CapacityModel["routingRevisions"]);
    case "demand": {
      const scenarioId = options.scenarioId;
      if (!scenarioId) throw new Error("scenarioId is required for demand import");
      return mergeDemandImport(model, scenarioId, imported.records as CapacityModel["demand"]);
    }
  }
}

export function previewInputImport(
  entity: InputEntity,
  model: CapacityModel,
  csv: string,
  mapping: Record<string, unknown>,
  options: InputImportOptions = {},
): Promise<InputPreview> {
  if (STATIC_DEMO) return Promise.resolve(localPreview(entity, model, csv, mapping, options));
  const path = `/v1/import/${entity}/preview`;
  return request<InputPreview>(path, {
    model,
    csv,
    mapping,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.scenarioId ? { scenarioId: options.scenarioId } : {}),
    ...(options.exceptionsCsv !== undefined ? { exceptionsCsv: options.exceptionsCsv } : {}),
    ...(options.exceptionMapping ? { exceptionMapping: options.exceptionMapping } : {}),
  });
}

export async function applyInputImport(
  entity: InputEntity,
  model: CapacityModel,
  csv: string,
  mapping: Record<string, unknown>,
  options: InputImportOptions = {},
): Promise<{ model: CapacityModel; import: InputPreview }> {
  if (!STATIC_DEMO) {
    return request<{ model: CapacityModel; import: InputPreview }>(`/v1/import/${entity}/apply`, {
      model,
      csv,
      mapping,
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.acceptPartial ? { acceptPartial: true } : {}),
      ...(options.scenarioId ? { scenarioId: options.scenarioId } : {}),
      ...(options.exceptionsCsv !== undefined ? { exceptionsCsv: options.exceptionsCsv } : {}),
      ...(options.exceptionMapping ? { exceptionMapping: options.exceptionMapping } : {}),
    });
  }

  const imported = localPreview(entity, model, csv, mapping, options);
  const hasErrors = imported.issues.some(issue => issue.severity === "error");
  if (hasErrors && !options.acceptPartial) throw new Error("Import contains rejected records; enable partial import to apply accepted records");
  const candidate = localApply(entity, model, imported, options);
  const validation = capacityModelSchema.safeParse(candidate);
  if (!validation.success) throw new Error("Accepted records would produce an invalid model; no changes were applied");
  return { model: validation.data as CapacityModel, import: imported };
}
