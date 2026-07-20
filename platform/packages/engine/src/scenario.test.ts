import { describe, expect, it } from "vitest";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { calculateCapacity, compareCapacityScenarios } from "./index.js";

const appliedRecoveryActions = [
  "action-weld-cross-train",
  "action-heat-overflow",
  "action-add-positioners",
  "action-weld-hiring",
  "action-add-assembly",
  "action-add-test-stand",
];

function row(
  comparison: ReturnType<typeof compareCapacityScenarios>,
  resourceGroupId: string,
  periodStart: string,
) {
  const match = comparison.rows.find(item => item.resourceGroupId === resourceGroupId && item.periodStart === periodStart);
  expect(match).toBeDefined();
  return match!;
}

describe("governed recovery scenarios", () => {
  it("inherits baseline demand without copying demand records", () => {
    const baseline = calculateCapacity(northstarRecoveryModel, "baseline");
    const recovery = calculateCapacity(northstarRecoveryModel, "recovery-1");

    expect(recovery.demandSourceScenarioId).toBe("baseline");
    expect(recovery.appliedActionIds).toEqual(appliedRecoveryActions);
    expect(recovery.results.reduce((sum, item) => sum + item.load, 0)).toBeCloseTo(
      baseline.results.reduce((sum, item) => sum + item.load, 0),
      8,
    );
  });

  it("applies added equipment only from its effective date", () => {
    const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
    expect(row(comparison, "rg-positioner", "2027-08-01").capacityDelta).toBe(0);
    expect(row(comparison, "rg-positioner", "2027-09-01").capacityDelta).toBeGreaterThan(0);
  });

  it("applies overflow capacity only from its approved start", () => {
    const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
    expect(row(comparison, "rg-oven", "2027-07-01").capacityDelta).toBe(0);
    expect(row(comparison, "rg-oven", "2027-08-01").capacityDelta).toBeGreaterThan(0);
    expect(row(comparison, "rg-oven", "2027-12-01").capacityDelta).toBeGreaterThan(0);
  });

  it("preserves load while exposing capacity and gap deltas", () => {
    const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
    expect(comparison.rows.every(item => item.loadDelta === 0)).toBe(true);
    expect(comparison.rows.some(item => item.capacityDelta > 0 && item.gapDelta > 0)).toBe(true);
    expect(comparison.appliedActionIds).toEqual(appliedRecoveryActions);
  });
});
