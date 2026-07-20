import { describe, expect, it } from "vitest";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { calculateCapacity, compareCapacityScenarios } from "./index.js";

function checksum(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
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

function peak(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string) {
  return result.results
    .filter(row => row.resourceGroupId === resourceGroupId)
    .sort((left, right) => (right.utilization ?? -1) - (left.utilization ?? -1))[0] ?? null;
}

describe("Northstar golden diagnostic", () => {
  it("prints the current deterministic control values", () => {
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
      annual2027: {
        weld: annualUtilization(baseline, "rg-weld", "2027"),
        positioner: annualUtilization(baseline, "rg-positioner", "2027"),
        assembly: annualUtilization(baseline, "rg-assembly", "2027"),
        test: annualUtilization(baseline, "rg-test", "2027"),
      },
      peaks: {
        weld: peak(baseline, "rg-weld"),
        positioner: peak(baseline, "rg-positioner"),
        assembly: peak(baseline, "rg-assembly"),
        test: peak(baseline, "rg-test"),
      },
      preRamp: {
        nonzeroRows: preRampRows.length,
        totalLoad: preRampRows.reduce((sum, row) => sum + row.load, 0),
        firstPeriod: preRampRows.map(row => row.periodStart).sort()[0] ?? null,
      },
    };
    console.log(`GOLDEN_DIAGNOSTIC=${JSON.stringify(diagnostic)}`);
    expect(preRampRows.length).toBeGreaterThan(0);
  });
});
