import type {
  CalculationResult,
  CapacityModel,
  CanonicalProgramRequirement,
  DemandRecord,
  LeadTimePhase,
  ModelIssue,
  Program,
  ResourceGroup,
  ResourcePeriodResult,
  RoutingRevision,
  Scenario,
  ScenarioAction,
  ScenarioComparisonResult,
  WorkingCalendar,
} from "@capacity/domain";
import { canonicalProgramRequirements, collectModelIssues } from "@capacity/domain";

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

function availableMinutesForDate(calendar: WorkingCalendar, date: Date): number {
  const key = iso(date);
  const exception = calendar.exceptions.find(item => item.date === key);
  if (exception) return exception.availableMinutes;
  const weekday = date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  return calendar.weeklyMinutes[weekday] ?? 0;
}

function availableMinutes(calendar: WorkingCalendar, start: Date, end: Date): number {
  return datesInclusive(start, end).reduce((sum, date) => sum + availableMinutesForDate(calendar, date), 0);
}

function isActive(date: string, effectiveFrom?: string, effectiveTo?: string): boolean {
  return (!effectiveFrom || effectiveFrom <= date) && (!effectiveTo || effectiveTo >= date);
}

function resolveScenarioChain(model: CapacityModel, scenarioId: string): Scenario[] {
  const scenarios = new Map(model.scenarios.map(item => [item.id, item]));
  const target = scenarios.get(scenarioId);
  if (!target) throw new Error(`Scenario not found: ${scenarioId}`);

  const reversed: Scenario[] = [];
  const visited = new Set<string>();
  let cursor: Scenario | undefined = target;
  while (cursor) {
    if (visited.has(cursor.id)) throw new Error(`Scenario parent cycle detected at ${cursor.id}`);
    visited.add(cursor.id);
    reversed.push(cursor);
    cursor = cursor.parentScenarioId ? scenarios.get(cursor.parentScenarioId) : undefined;
    if (reversed.at(-1)?.parentScenarioId && !cursor) {
      throw new Error(`Parent scenario not found: ${reversed.at(-1)?.parentScenarioId}`);
    }
  }
  return reversed.reverse();
}

function demandForScenario(model: CapacityModel, scenarioId: string): { records: DemandRecord[]; sourceScenarioId: string } {
  const chain = resolveScenarioChain(model, scenarioId);
  for (const scenario of [...chain].reverse()) {
    const records = model.demand.filter(item => item.scenarioId === scenario.id && item.quantity > 0);
    if (records.length > 0) return { records, sourceScenarioId: scenario.id };
  }
  return { records: [], sourceScenarioId: scenarioId };
}

function actionsForScenario(model: CapacityModel, scenarioId: string): ScenarioAction[] {
  const scenarioIds = new Set(resolveScenarioChain(model, scenarioId).map(item => item.id));
  return (model.scenarioActions ?? [])
    .filter(action => scenarioIds.has(action.scenarioId))
    .filter(action => action.included && action.status !== "rejected")
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id));
}

function revisionForDemand(revisions: RoutingRevision[], demand: DemandRecord): RoutingRevision | undefined {
  return revisionForProductAt(revisions, demand.productId, demand.shipDate);
}

function revisionForProductAt(revisions: RoutingRevision[], productId: string, date: string): RoutingRevision | undefined {
  return revisions
    .filter(revision => revision.productId === productId)
    .filter(revision => revision.effectiveFrom <= date && (!revision.effectiveTo || revision.effectiveTo >= date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

function addIssueOnce(issues: ModelIssue[], issue: ModelIssue): void {
  if (!issues.some(current => current.code === issue.code && current.entityType === issue.entityType && current.entityId === issue.entityId)) {
    issues.push(issue);
  }
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

function capacityForPeriod(
  model: CapacityModel,
  group: ResourceGroup,
  start: Date,
  end: Date,
  actions: ScenarioAction[],
): number {
  const calendar = model.calendars.find(item => item.id === group.calendarId);
  if (!calendar) return 0;
  const resources = model.resources.filter(resource => resource.resourceGroupId === group.id);

  return datesInclusive(start, end).reduce((periodCapacity, date) => {
    const dateKey = iso(date);
    const availableHours = availableMinutesForDate(calendar, date) / 60;
    if (availableHours === 0) return periodCapacity;

    const baseCapacity = resources.reduce((resourceCapacity, resource) => {
      if (!isActive(dateKey, resource.effectiveFrom, resource.effectiveTo)) return resourceCapacity;
      const quantityDelta = actions
        .filter(action => action.kind === "resourceQuantityDelta")
        .filter(action => action.resourceId === resource.id)
        .filter(action => isActive(dateKey, action.effectiveFrom, action.effectiveTo))
        .reduce((sum, action) => sum + action.quantityDelta, 0);
      const effectiveRate = resource.ratePerAvailableHour * resource.availability * resource.performance * resource.quality;
      return resourceCapacity + (resource.quantity + quantityDelta) * availableHours * effectiveRate;
    }, 0);

    const multiplier = actions
      .filter(action => action.kind === "resourceCapacityMultiplier")
      .filter(action => action.resourceGroupId === group.id)
      .filter(action => isActive(dateKey, action.effectiveFrom, action.effectiveTo))
      .reduce((product, action) => product * action.multiplier, 1);

    return periodCapacity + baseCapacity * multiplier;
  }, 0);
}

function adjustedDemandQuantity(demand: DemandRecord, actions: ScenarioAction[]): number {
  const multiplier = actions
    .filter(action => action.kind === "demandMultiplier")
    .filter(action => !action.productId || action.productId === demand.productId)
    .filter(action => isActive(demand.shipDate, action.effectiveFrom, action.effectiveTo))
    .reduce((product, action) => product * action.multiplier, 1);
  return demand.quantity * multiplier;
}

function loadForPeriod(
  model: CapacityModel,
  demands: DemandRecord[],
  groupId: string,
  period: { start: Date; end: Date },
  actions: ScenarioAction[],
  issues: ModelIssue[],
): number {
  let load = 0;
  for (const demand of demands) {
    const demandQuantity = adjustedDemandQuantity(demand, actions);
    if (demandQuantity <= 0) continue;
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
        if ((requirement.basis ?? "perUnit") !== "perUnit") continue;
        const value = requirement.requirement;
        if (value.state === "missing") {
          addIssueOnce(issues, { severity: "warning", code: "REQUIREMENT_MISSING", message: `Missing requirement ${requirement.id}`, entityType: "routingRequirement", entityId: requirement.id });
          continue;
        }
        if (value.state !== "value" || value.value === undefined) continue;
        let requirementLoad = value.value * demandQuantity;
        if (requirement.setupRequirement?.state === "value" && requirement.setupRequirement.value !== undefined) {
          const batchSize = requirement.batchSize ?? operation.maximumBatchSize ?? operation.minimumBatchSize ?? demandQuantity;
          const batches = batchSize > 0 ? Math.ceil(demandQuantity / batchSize) : 1;
          requirementLoad += requirement.setupRequirement.value * batches;
        }
        load += requirementLoad * allocation;
      }
    }
  }
  return load;
}

function programLoadForPeriod(
  model: CapacityModel,
  program: Program,
  requirements: CanonicalProgramRequirement[],
  groupId: string,
  period: { start: Date; end: Date },
  issues: ModelIssue[],
): number {
  let load = 0;
  for (const record of requirements) {
    const { requirement, basis, phase } = record;
    if (requirement.resourceGroupId !== groupId) continue;
    const value = requirement.requirement;
    if (value.state === "missing") {
      addIssueOnce(issues, { severity: "warning", code: "REQUIREMENT_MISSING", message: `Missing requirement ${requirement.id}`, entityType: "routingRequirement", entityId: requirement.id });
      continue;
    }
    if (value.state !== "value" || value.value === undefined) continue;
    if (basis === "perProgram") {
      load += value.value * phaseAllocation(phase, program.anchorDate, period);
      continue;
    }
    const activeEnd = parseDate(program.endDate ?? model.horizonEnd);
    if (overlapDays(parseDate(program.anchorDate), activeEnd, period.start, period.end) > 0) load += value.value;
  }
  return load;
}

export function calculateCapacity(model: CapacityModel, scenarioId: string): CalculationResult {
  const issues: ModelIssue[] = collectModelIssues(model);
  const demandSelection = demandForScenario(model, scenarioId);
  const actions = actionsForScenario(model, scenarioId);
  const periods = enumeratePeriods(model.horizonStart, model.horizonEnd, model.planningGranularity);
  const programs = model.programs ?? [];
  const programRequirements = new Map(
    programs.map(program => [program.id, canonicalProgramRequirements(model, program).records]),
  );
  const results: ResourcePeriodResult[] = [];

  for (const group of model.resourceGroups) {
    for (const period of periods) {
      const capacity = capacityForPeriod(model, group, period.start, period.end, actions);
      const demandLoad = loadForPeriod(model, demandSelection.records, group.id, period, actions, issues);
      const programLoad = programs.reduce(
        (sum, program) => sum + programLoadForPeriod(
          model,
          program,
          programRequirements.get(program.id) ?? [],
          group.id,
          period,
          issues,
        ),
        0,
      );
      const load = demandLoad + programLoad;
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

  const appliedActionIds = actions
    .filter(action => action.effectiveFrom <= model.horizonEnd && (!action.effectiveTo || action.effectiveTo >= model.horizonStart))
    .map(action => action.id);

  return {
    modelId: model.modelId,
    scenarioId,
    generatedAt: new Date().toISOString(),
    results,
    governingConstraint,
    issues,
    demandSourceScenarioId: demandSelection.sourceScenarioId,
    appliedActionIds,
  };
}

function comparisonKey(row: ResourcePeriodResult): string {
  return `${row.resourceGroupId}|${row.periodStart}`;
}

export function compareCapacityScenarios(
  model: CapacityModel,
  baselineScenarioId: string,
  comparisonScenarioId: string,
): ScenarioComparisonResult {
  const baseline = calculateCapacity(model, baselineScenarioId);
  const comparison = calculateCapacity(model, comparisonScenarioId);
  const comparisonRows = new Map(comparison.results.map(row => [comparisonKey(row), row]));

  const rows = baseline.results.map(baselineRow => {
    const comparisonRow = comparisonRows.get(comparisonKey(baselineRow));
    if (!comparisonRow) throw new Error(`Comparison row missing for ${comparisonKey(baselineRow)}`);
    const utilizationDelta = baselineRow.utilization !== null && comparisonRow.utilization !== null
      && Number.isFinite(baselineRow.utilization) && Number.isFinite(comparisonRow.utilization)
      ? comparisonRow.utilization - baselineRow.utilization
      : null;
    return {
      resourceGroupId: baselineRow.resourceGroupId,
      periodStart: baselineRow.periodStart,
      periodEnd: baselineRow.periodEnd,
      baseline: baselineRow,
      comparison: comparisonRow,
      loadDelta: comparisonRow.load - baselineRow.load,
      capacityDelta: comparisonRow.capacity - baselineRow.capacity,
      gapDelta: comparisonRow.gap - baselineRow.gap,
      utilizationDelta,
    };
  });

  return {
    modelId: model.modelId,
    baselineScenarioId,
    comparisonScenarioId,
    generatedAt: new Date().toISOString(),
    baseline,
    comparison,
    rows,
    resolvedGapPeriods: rows.filter(row => row.baseline.gap < 0 && row.comparison.gap >= 0).length,
    remainingGapPeriods: rows.filter(row => row.comparison.gap < 0).length,
    worsenedGapPeriods: rows.filter(row => row.comparison.gap < row.baseline.gap).length,
    appliedActionIds: comparison.appliedActionIds ?? [],
  };
}

export const engineInternals = {
  enumeratePeriods,
  availableMinutes,
  phaseDates,
  phaseAllocation,
  revisionForProductAt,
  programLoadForPeriod,
  resolveScenarioChain,
  demandForScenario,
  actionsForScenario,
};
