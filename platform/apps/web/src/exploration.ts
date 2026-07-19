import type { CapacityModel, ResourcePeriodResult } from "@capacity/domain";

export type ExploreResolution = "native" | "quarter" | "year";

export interface AggregatedResourcePoint {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  load: number;
  capacity: number;
  gap: number;
  utilization: number | null;
}

function monthLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function nativeLabel(row: ResourcePeriodResult): string {
  const parsed = new Date(`${row.periodStart}T00:00:00Z`);
  if (row.periodStart.slice(8) === "01") return monthLabel(row.periodStart);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function bucket(row: ResourcePeriodResult, resolution: ExploreResolution): { key: string; label: string } {
  if (resolution === "native") return { key: row.periodStart, label: nativeLabel(row) };
  const year = Number(row.periodStart.slice(0, 4));
  if (resolution === "year") return { key: String(year), label: String(year) };
  const month = Number(row.periodStart.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
}

export function aggregateResourceResults(
  rows: ResourcePeriodResult[],
  resourceGroupId: string,
  resolution: ExploreResolution,
): AggregatedResourcePoint[] {
  const grouped = new Map<string, AggregatedResourcePoint>();
  for (const row of rows.filter(item => item.resourceGroupId === resourceGroupId).sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
    const target = bucket(row, resolution);
    const current = grouped.get(target.key);
    if (!current) {
      grouped.set(target.key, {
        key: target.key,
        label: target.label,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        load: row.load,
        capacity: row.capacity,
        gap: row.gap,
        utilization: row.capacity > 0 ? row.load / row.capacity : row.load > 0 ? Number.POSITIVE_INFINITY : null,
      });
      continue;
    }
    current.load += row.load;
    current.capacity += row.capacity;
    current.gap += row.gap;
    if (row.periodStart < current.periodStart) current.periodStart = row.periodStart;
    if (row.periodEnd > current.periodEnd) current.periodEnd = row.periodEnd;
    current.utilization = current.capacity > 0
      ? current.load / current.capacity
      : current.load > 0
        ? Number.POSITIVE_INFINITY
        : null;
  }
  return [...grouped.values()];
}

export function resourceQuantityAt(model: CapacityModel, resourceGroupId: string, date: string): number {
  return model.resources
    .filter(resource => resource.resourceGroupId === resourceGroupId)
    .filter(resource => !resource.effectiveFrom || resource.effectiveFrom <= date)
    .filter(resource => !resource.effectiveTo || resource.effectiveTo >= date)
    .reduce((sum, resource) => sum + resource.quantity, 0);
}

export interface FtePoint extends AggregatedResourcePoint {
  availableFte: number;
  requiredFte: number | null;
  fteGap: number | null;
}

export function buildFtePoints(
  model: CapacityModel,
  resourceGroupId: string,
  points: AggregatedResourcePoint[],
): FtePoint[] {
  return points.map(point => {
    const availableFte = resourceQuantityAt(model, resourceGroupId, point.periodStart);
    const requiredFte = point.utilization === null || !Number.isFinite(point.utilization)
      ? null
      : availableFte * point.utilization;
    return {
      ...point,
      availableFte,
      requiredFte,
      fteGap: requiredFte === null ? null : availableFte - requiredFte,
    };
  });
}

export function highestUtilization(rows: ResourcePeriodResult[], resourceGroupId: string): ResourcePeriodResult | null {
  return rows
    .filter(row => row.resourceGroupId === resourceGroupId && row.load > 0)
    .sort((a, b) => {
      const aScore = a.utilization === null ? -1 : Number.isFinite(a.utilization) ? a.utilization : Number.MAX_SAFE_INTEGER;
      const bScore = b.utilization === null ? -1 : Number.isFinite(b.utilization) ? b.utilization : Number.MAX_SAFE_INTEGER;
      return bScore - aScore;
    })[0] ?? null;
}

export function riskBand(utilization: number | null): "none" | "green" | "amber" | "red" | "blocked" {
  if (utilization === null) return "none";
  if (!Number.isFinite(utilization)) return "blocked";
  if (utilization > 1) return "red";
  if (utilization >= 0.85) return "amber";
  return "green";
}
