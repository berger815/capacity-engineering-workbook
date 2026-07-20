import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { calculateCapacity, compareCapacityScenarios } from "./index.js";

function checksum(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizedCalculation(result: ReturnType<typeof calculateCapacity>) {
  return {
    modelId: result.modelId,
    scenarioId: result.scenarioId,
    results: result.results,
    governingConstraint: result.governingConstraint,
    issues: result.issues,
    demandSourceScenarioId: result.demandSourceScenarioId,
    appliedActionIds: result.appliedActionIds,
  };
}

function annualUtilization(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string, year: string): number | null {
  const rows = result.results.filter(row => row.resourceGroupId === resourceGroupId && row.periodStart.startsWith(year));
  const load = rows.reduce((sum, row) => sum + row.load, 0);
  const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  return capacity > 0 ? load / capacity : null;
}

function peak(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string, year?: string) {
  return result.results
    .filter(row => row.resourceGroupId === resourceGroupId && (!year || row.periodStart.startsWith(year)))
    .sort((left, right) => (right.utilization ?? -1) - (left.utilization ?? -1))[0] ?? null;
}

function period(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string, periodStart: string) {
  return result.results.find(row => row.resourceGroupId === resourceGroupId && row.periodStart === periodStart) ?? null;
}

describe("Northstar golden diagnostic", () => {
  it("captures the current deterministic control values", () => {
    const baseline = calculateCapacity(northstarRecoveryModel, "baseline");
    const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
    const normalizedComparison = {
      modelId: comparison.modelId,
      baselineScenarioId: comparison.baselineScenarioId,
      comparisonScenarioId: comparison.comparisonScenarioId,
      baseline: normalizedCalculation(comparison.baseline),
      comparison: normalizedCalculation(comparison.comparison),
      rows: comparison.rows,
      resolvedGapPeriods: comparison.resolvedGapPeriods,
      remainingGapPeriods: comparison.remainingGapPeriods,
      worsenedGapPeriods: comparison.worsenedGapPeriods,
      appliedActionIds: comparison.appliedActionIds,
    };
    const preRampRows = baseline.results.filter(row => row.periodStart.startsWith("2026-") && row.load > 0);
    const resourceIds = ["rg-weld", "rg-positioner", "rg-assembly", "rg-test"];
    const diagnostic = {
      baselineChecksum: checksum(normalizedCalculation(baseline)),
      comparisonChecksum: checksum(normalizedComparison),
      baselineGoverning: baseline.governingConstraint,
      recoveryGoverning: comparison.comparison.governingConstraint,
      comparisonCounts: {
        resolvedGapPeriods: comparison.resolvedGapPeriods,
        remainingGapPeriods: comparison.remainingGapPeriods,
        worsenedGapPeriods: comparison.worsenedGapPeriods,
      },
      annual2027: Object.fromEntries(resourceIds.map(id => [id, annualUtilization(baseline, id, "2027")])),
      peak2027: Object.fromEntries(resourceIds.map(id => [id, peak(baseline, id, "2027")])),
      october2027: Object.fromEntries(resourceIds.map(id => [id, period(baseline, id, "2027-10-01")])),
      allHorizonPeaks: Object.fromEntries(resourceIds.map(id => [id, peak(baseline, id)])),
      preRamp: {
        nonzeroRows: preRampRows.length,
        totalLoad: preRampRows.reduce((sum, row) => sum + row.load, 0),
        firstPeriod: preRampRows.map(row => row.periodStart).sort()[0] ?? null,
      },
    };
    writeFileSync("/tmp/golden-diagnostic.json", JSON.stringify(diagnostic, null, 2));
    expect(preRampRows.length).toBeGreaterThan(0);
  });
});
