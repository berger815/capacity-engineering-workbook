import type { CapacityModel, RequirementValue } from "@capacity/domain";

function cell(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: Array<Array<string | number | boolean | undefined>>): string {
  return [headers, ...rows].map(row => row.map(cell).join(",")).join("\n");
}

function externalValue(keys: Record<string, string> | undefined): string | undefined {
  if (!keys) return undefined;
  return keys.source ?? Object.values(keys)[0];
}

function requirementFields(requirement: RequirementValue | undefined): [string, number | undefined] {
  if (!requirement) return ["", undefined];
  return [requirement.state, requirement.value];
}

export function exportCalendarsCsv(model: CapacityModel): string {
  return csv(
    ["calendarId", "calendarName", "timezone", "monMinutes", "tueMinutes", "wedMinutes", "thuMinutes", "friMinutes", "satMinutes", "sunMinutes"],
    model.calendars.map(calendar => [
      calendar.id,
      calendar.name,
      calendar.timezone,
      calendar.weeklyMinutes[1] ?? 0,
      calendar.weeklyMinutes[2] ?? 0,
      calendar.weeklyMinutes[3] ?? 0,
      calendar.weeklyMinutes[4] ?? 0,
      calendar.weeklyMinutes[5] ?? 0,
      calendar.weeklyMinutes[6] ?? 0,
      calendar.weeklyMinutes[0] ?? 0,
    ]),
  );
}

export function exportCalendarExceptionsCsv(model: CapacityModel): string {
  return csv(
    ["calendarId", "exceptionDate", "availableMinutes", "reason"],
    model.calendars.flatMap(calendar => calendar.exceptions.map(exception => [calendar.id, exception.date, exception.availableMinutes, exception.reason])),
  );
}

export function exportResourceGroupsCsv(model: CapacityModel): string {
  return csv(
    ["resourceGroupId", "resourceGroupName", "resourceKind", "capacityUnit", "calendarId", "organizationNodeId", "pooled", "tags"],
    model.resourceGroups.map(group => [group.id, group.name, group.kind, group.capacityUnit, group.calendarId, group.organizationNodeId, group.pooled, group.tags?.join("|")]),
  );
}

export function exportResourcesCsv(model: CapacityModel): string {
  return csv(
    ["resourceId", "resourceName", "resourceGroupId", "calendarId", "quantity", "ratePerAvailableHour", "availability", "performance", "quality", "effectiveFrom", "effectiveTo", "externalKey"],
    model.resources.map(resource => {
      const group = model.resourceGroups.find(candidate => candidate.id === resource.resourceGroupId);
      return [
        resource.id,
        resource.name,
        resource.resourceGroupId,
        group?.calendarId,
        resource.quantity,
        resource.ratePerAvailableHour,
        resource.availability,
        resource.performance,
        resource.quality,
        resource.effectiveFrom,
        resource.effectiveTo,
        externalValue(resource.externalKeys),
      ];
    }),
  );
}

export function exportProductsCsv(model: CapacityModel): string {
  return csv(
    ["productId", "productName", "externalKey", "productFamily", "organizationNodeId"],
    model.products.map(product => [product.id, product.name, externalValue(product.externalKeys), product.family, product.organizationNodeId]),
  );
}

export function exportRoutingCsv(model: CapacityModel): string {
  const headers = [
    "productId", "revisionId", "revision", "effectiveFrom", "effectiveTo",
    "phaseId", "phaseName", "startWeeksBeforeShip", "endWeeksBeforeShip", "allocation",
    "operationId", "operationName", "operationSequence", "resourceGroupId",
    "requirementState", "requirementValue", "setupRequirementState", "setupRequirementValue", "setupQuantity", "batchSize",
  ];
  const rows = model.routingRevisions.flatMap(revision => revision.operations.flatMap(operation => {
    const phase = revision.phases.find(candidate => candidate.id === operation.phaseId);
    if (!phase) return [];
    return operation.requirements.map(requirement => {
      const [requirementState, requirementValue] = requirementFields(requirement.requirement);
      const [setupState, setupValue] = requirementFields(requirement.setupRequirement);
      return [
        revision.productId,
        revision.sourceRevision ?? revision.revision,
        revision.revision,
        revision.effectiveFrom,
        revision.effectiveTo,
        phase.id,
        phase.name,
        phase.startWeeksBeforeShip,
        phase.endWeeksBeforeShip,
        phase.allocation,
        operation.id,
        operation.name,
        operation.sequence,
        requirement.resourceGroupId,
        requirementState,
        requirementValue,
        setupState,
        setupValue,
        requirement.setupQuantity,
        requirement.batchSize,
      ];
    });
  }));
  return csv(headers, rows);
}

export function exportDemandCsv(model: CapacityModel, scenarioId: string): string {
  return csv(
    ["productId", "shipDate", "quantity", "demandClass", "customerOrProgram", "sourceRecordId"],
    model.demand.filter(record => record.scenarioId === scenarioId).map(record => [
      record.productId,
      record.shipDate,
      record.quantity,
      record.demandClass,
      record.customerOrProgram,
      record.sourceRecordId,
    ]),
  );
}
