import type {
  CalculationResult,
  CapacityModel,
  DemandRecord,
  LeadTimePhase,
  ModelIssue,
  ResourceGroup,
  ResourcePeriodResult,
  RoutingRevision,
  WorkingCalendar,
} from "@capacity/domain";

const DAY_MS = 86_400_000;

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfWeek(date: Date): Date {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(date, mondayOffset);
}

function addPeriod(date: Date, granularity: "week" | "month"): Date {
  return granularity === "week"
    ? addDays(date, 7)
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function periodStart(date: Date, granularity: "week" | "month"): Date {
  return granularity === "week" ? startOfWeek(date) : startOfMonth(date);
}

function enumeratePeriods(start: string, end: string, granularity: "week" | "month") {
  const horizonEnd = parseDate(end);
  const periods: Array<{ start: Date; end: Date }> = [];
  for (let cursor = periodStart(parseDate(start), granularity); cursor <= horizonEnd; cursor = addPeriod(cursor, granularity)) {
    const next = addPeriod(cursor, granularity);
    periods.push({ start: cursor, end: addDays(next, -1) });
  }
  return periods;
}

function datesInclusive(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

function availableMinutes(calendar: WorkingCalendar, start: Date, end: Date): number {
  const exceptions = new Map(calendar.exceptions.map(item => [item.date, item.availableMinutes]));
  return datesInclusive(start, end).reduce((sum, date) => {
    const key = iso(date);
    const override = exceptions.get(key);
    if (override !== undefined) return sum + override;
    const weekday = date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    return sum + (calendar.weeklyMinutes[weekday] ?? 0);
  }, 0);
}

function revisionForDemand(revisions: RoutingRevision[], demand: DemandRecord): RoutingRevision | undefined {
  const date = demand.shipDate;
  return revisions
    .filter(revision => revision.productId === demand.productId)
    .filter(revision => revision.effectiveFrom <= date && (!revision.effectiveTo || revision.effectiveTo >= date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

function phaseDates(shipDate: string, phase: LeadTimePhase): { start: Date; end: Date } {
  const ship = parseDate(shipDate);
  const start = addDays(ship, -Math.round(phase.startWeeksBeforeShip * 7));
  const end = addDays(ship, -Math.round(phase.endWeeksBeforeShip * 7));
  return start <= end ? { start, end } : { start: end, end: start };
}

function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end < start ? 0 : Math.floor((end - start) / DAY_MS) + 1;
}

function phaseAllocation(
  phase: LeadTimePhase,
  shipDate: string,
  period: { start: Date; end: Date },
): number {
  const range = phaseDates(shipDate, phase);
  if (phase.allocation === "shiftToStart") return iso(period.start) <= iso(range.start) && iso(range.start) <= iso(period.end) ? 1 : 0;
  if (phase.allocation === "shiftToEnd") return iso(period.start) <= iso(range.end) && iso(range.end) <= iso(period.end) ? 1 : 0;
  if (phase.allocation === "shiftToMidpoint") {
    const midpoint = new Date((range.start.getTime() + range.end.getTime()) / 2);
    return iso(period.start) <= iso(midpoint) && iso(midpoint) <= iso(period.end) ? 1 : 0;
  }
  const totalDays = overlapDays(range.start, range.end, range.start, range.end);
  return totalDays === 0 ? 0 : overlapDays(range.start, range.end, period.start, period.end) / totalDays;
}

function capacityForPeriod(model: CapacityModel, group: ResourceGroup, start: Date, end: Date): number {
  const calendar = model.calendars.find(item => item.id === group.calendarId);
  if (!calendar) return 0;
  const availableHours = availableMinutes(calendar, start, end) / 60;
  return model.resources
    .filter(resource => resource.resourceGroupId === group.id)
    .filter(resource => !resource.effectiveFrom || resource.effectiveFrom <= iso(end))
    .filter(resource => !resource.effectiveTo || resource.effectiveTo >= iso(start))
    .reduce((sum, resource) => {
      const effectiveRate = resource.ratePerAvailableHour * resource.availability * resource.performance * resource.quality;
      return sum + resource.quantity * availableHours * effectiveRate;
    }, 0);
}

function loadForPeriod(
  model: CapacityModel,
  scenarioId: string,
  groupId: string,
  period: { start: Date; end: Date },
  issues: ModelIssue[],
): number {
  let load = 0;
  for (const demand of model.demand.filter(item => item.scenarioId === scenarioId && item.quantity > 0)) {
    const revision = revisionForDemand(model.routingRevisions, demand);
    if (!revision) {
      issues.push({ severity: "error", code: "ROUTING_REVISION_MISSING", message: `No routing revision for demand ${demand.id}`, entityType: "demand", entityId: demand.id });
      continue;
    }
    const phases = new Map(revision.phases.map(phase => [phase.id, phase]));
    for (const operation of revision.operations) {
      const phase = phases.get(operation.phaseId);
      if (!phase) {
        issues.push({ severity: "error", code: "PHASE_MISSING", message: `Operation ${operation.id} references missing phase ${operation.phaseId}`, entityType: "operation", entityId: operation.id });
        continue;
      }
      const allocation = phaseAllocation(phase, demand.shipDate, period);
      if (allocation === 0) continue;
      for (const requirement of operation.requirements.filter(item => item.resourceGroupId === groupId)) {
        const value = requirement.requirement;
        if (value.state === "missing") {
          issues.push({ severity: "warning", code: "REQUIREMENT_MISSING", message: `Missing requirement ${requirement.id}`, entityType: "routingRequirement", entityId: requirement.id });
          continue;
        }
        if (value.state !== "value" || value.value === undefined) continue;
        let requirementLoad = value.value * demand.quantity;
        if (requirement.setupRequirement?.state === "value" && requirement.setupRequirement.value !== undefined) {
          const batchSize = requirement.batchSize ?? operation.maximumBatchSize ?? operation.minimumBatchSize ?? demand.quantity;
          const batches = batchSize > 0 ? Math.ceil(demand.quantity / batchSize) : 1;
          requirementLoad += requirement.setupRequirement.value * batches;
        }
        load += requirementLoad * allocation;
      }
    }
  }
  return load;
}

export function calculateCapacity(model: CapacityModel, scenarioId: string): CalculationResult {
  const issues: ModelIssue[] = [];
  if (!model.scenarios.some(item => item.id === scenarioId)) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }
  const periods = enumeratePeriods(model.horizonStart, model.horizonEnd, model.planningGranularity);
  const results: ResourcePeriodResult[] = [];

  for (const group of model.resourceGroups) {
    for (const period of periods) {
      const capacity = capacityForPeriod(model, group, period.start, period.end);
      const load = loadForPeriod(model, scenarioId, group.id, period, issues);
      const gap = capacity - load;
      results.push({
        scenarioId,
        resourceGroupId: group.id,
        periodStart: iso(period.start),
        periodEnd: iso(period.end),
        load,
        capacity,
        gap,
        utilization: capacity > 0 ? load / capacity : load > 0 ? Number.POSITIVE_INFINITY : null,
      });
    }
  }

  const governingConstraint = results
    .filter(result => result.load > 0)
    .sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))[0] ?? null;

  return {
    modelId: model.modelId,
    scenarioId,
    generatedAt: new Date().toISOString(),
    results,
    governingConstraint,
    issues,
  };
}

export const engineInternals = { enumeratePeriods, availableMinutes, phaseDates, phaseAllocation };
