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

function normalizedComparison(comparison: ReturnType<typeof compareCapacityScenarios>) {
  return {
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
}

function annualUtilization(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string, year: string): number {
  const rows = result.results.filter(row => row.resourceGroupId === resourceGroupId && row.periodStart.startsWith(year));
  const load = rows.reduce((sum, row) => sum + row.load, 0);
  const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  return load / capacity;
}

function row(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string, periodStart: string) {
  const match = result.results.find(item => item.resourceGroupId === resourceGroupId && item.periodStart === periodStart);
  expect(match).toBeDefined();
  return match!;
}

function peakInYear(result: ReturnType<typeof calculateCapacity>, resourceGroupId: string, year: string) {
  const match = result.results
    .filter(item => item.resourceGroupId === resourceGroupId && item.periodStart.startsWith(year))
    .sort((left, right) => (right.utilization ?? -1) - (left.utilization ?? -1))[0];
  expect(match).toBeDefined();
  return match!;
}

const appliedRecoveryActions = [
  "action-weld-cross-train",
  "action-heat-overflow",
  "action-add-positioners",
  "action-weld-hiring",
  "action-add-assembly",
  "action-add-test-stand",
];

describe("Northstar golden reconciliation", () => {
  const baseline = calculateCapacity(northstarRecoveryModel, "baseline");
  const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");

  it("freezes the complete deterministic baseline and recovery result sets", () => {
    expect(checksum(normalizedCalculation(baseline))).toBe("70adff1c");
    expect(checksum(normalizedComparison(comparison))).toBe("a4016fd6");
    expect(comparison.appliedActionIds).toEqual(appliedRecoveryActions);
  });

  it("reconciles the source-aligned 2027 annual and peak constraint story", () => {
    expect(annualUtilization(baseline, "rg-weld", "2027")).toBeCloseTo(0.9336768546097935, 12);
    expect(annualUtilization(baseline, "rg-positioner", "2027")).toBeCloseTo(0.9803606973402837, 12);
    expect(annualUtilization(baseline, "rg-assembly", "2027")).toBeCloseTo(0.6718781475801828, 12);
    expect(annualUtilization(baseline, "rg-test", "2027")).toBeCloseTo(0.541162663744797, 12);

    expect(peakInYear(baseline, "rg-weld", "2027")).toMatchObject({ periodStart: "2027-10-01" });
    expect(peakInYear(baseline, "rg-weld", "2027").utilization).toBeCloseTo(1.2880986655198476, 12);
    expect(peakInYear(baseline, "rg-positioner", "2027")).toMatchObject({ periodStart: "2027-10-01" });
    expect(peakInYear(baseline, "rg-positioner", "2027").utilization).toBeCloseTo(1.3525035987958403, 12);
    expect(peakInYear(baseline, "rg-assembly", "2027")).toMatchObject({ periodStart: "2027-11-01" });
    expect(peakInYear(baseline, "rg-assembly", "2027").utilization).toBeCloseTo(1.1575707193544886, 12);
    expect(peakInYear(baseline, "rg-test", "2027")).toMatchObject({ periodStart: "2027-12-01" });
    expect(peakInYear(baseline, "rg-test", "2027").utilization).toBeCloseTo(0.9334212304450397, 12);
  });

  it("locks the selected October 2027 constraint records", () => {
    expect(row(baseline, "rg-weld", "2027-10-01")).toMatchObject({
      load: 3146.1314482758626,
      capacity: 2442.461538461539,
      gap: -703.6699098143235,
    });
    expect(row(baseline, "rg-positioner", "2027-10-01")).toMatchObject({
      load: 1048.7104827586206,
      capacity: 775.3846153846152,
      gap: -273.3258673740054,
    });
    expect(row(baseline, "rg-assembly", "2027-10-01").utilization).toBeCloseTo(1.0462179592995136, 12);
    expect(row(baseline, "rg-test", "2027-10-01").utilization).toBeCloseTo(0.7915901810459631, 12);
  });

  it("preserves pre-ramp work despite zero 2026 shipments", () => {
    const preRamp = baseline.results.filter(item => item.periodStart.startsWith("2026-") && item.load > 0);
    expect(northstarRecoveryModel.demand.some(item => item.shipDate.startsWith("2026-"))).toBe(false);
    expect(preRamp).toHaveLength(37);
    expect(preRamp.map(item => item.periodStart).sort()[0]).toBe("2026-05-01");
    expect(preRamp.reduce((sum, item) => sum + item.load, 0)).toBeCloseTo(8744.253037520057, 8);
  });

  it("locks the multi-year governing constraints and recovery comparison", () => {
    expect(baseline.governingConstraint).toMatchObject({
      resourceGroupId: "rg-positioner",
      periodStart: "2029-07-01",
    });
    expect(baseline.governingConstraint?.utilization).toBeCloseTo(1.7352765736179536, 12);
    expect(comparison.comparison.governingConstraint).toMatchObject({
      resourceGroupId: "rg-weld",
      periodStart: "2029-07-01",
    });
    expect(comparison.comparison.governingConstraint?.utilization).toBeCloseTo(1.2241810043160166, 12);
    expect(comparison).toMatchObject({
      resolvedGapPeriods: 53,
      remainingGapPeriods: 41,
      worsenedGapPeriods: 0,
    });
    expect(comparison.rows.every(item => item.loadDelta === 0)).toBe(true);
  });
});
