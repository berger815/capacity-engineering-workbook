import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { calculateCapacity, compareCapacityScenarios } from "./index.js";

function digest(value: unknown): string {
  const normalized = structuredClone(value) as Record<string, unknown>;
  delete normalized.generatedAt;
  if (normalized.baseline && typeof normalized.baseline === "object") delete (normalized.baseline as Record<string, unknown>).generatedAt;
  if (normalized.comparison && typeof normalized.comparison === "object") delete (normalized.comparison as Record<string, unknown>).generatedAt;
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function annualUtilization(result: ReturnType<typeof calculateCapacity>, groupId: string, year: string): number {
  const rows = result.results.filter(row => row.resourceGroupId === groupId && row.periodStart.startsWith(year));
  return rows.reduce((sum, row) => sum + row.load, 0) / rows.reduce((sum, row) => sum + row.capacity, 0);
}

function period(result: ReturnType<typeof calculateCapacity>, groupId: string, periodStart: string) {
  const row = result.results.find(item => item.resourceGroupId === groupId && item.periodStart === periodStart);
  expect(row).toBeDefined();
  return row!;
}

describe("Northstar golden reconciliation", () => {
  const baseline = calculateCapacity(northstarRecoveryModel, "baseline");
  const recovery = calculateCapacity(northstarRecoveryModel, "recovery-1");
  const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");

  it("preserves the source-aligned basis-free baseline and recovery results", () => {
    expect(northstarRecoveryModel.programs).toBeUndefined();
    expect(digest(baseline)).toBe("a693627e0cad82a91f83bb19fb08ca5ded39fe4ece5b41c59f52cee2cedb35ac");
    expect(digest(recovery)).toBe("71db7a962fd6838f1513d80f4627cee2235c18f31c0e123f4fec69dc4cef946f");
    expect(digest(comparison)).toBe("PENDING_COMPARISON_HASH");
  });

  it("locks the 2027 annual and October constraint story", () => {
    expect(annualUtilization(baseline, "rg-weld", "2027")).toBeCloseTo(0.9336768546097935, 12);
    expect(annualUtilization(baseline, "rg-positioner", "2027")).toBeCloseTo(0.9803606973402837, 12);
    expect(annualUtilization(baseline, "rg-assembly", "2027")).toBeCloseTo(0.6718781475801828, 12);
    expect(annualUtilization(baseline, "rg-test", "2027")).toBeCloseTo(0.541162663744797, 12);
    expect(period(baseline, "rg-weld", "2027-10-01").utilization).toBeCloseTo(1.2880986655198476, 12);
    expect(period(baseline, "rg-positioner", "2027-10-01").utilization).toBeCloseTo(1.3525035987958403, 12);
    expect(period(baseline, "rg-assembly", "2027-10-01").utilization).toBeCloseTo(1.0462179592995136, 12);
    expect(period(baseline, "rg-test", "2027-10-01").utilization).toBeCloseTo(0.7915901810459631, 12);
  });

  it("preserves pre-ramp work and recovery lineage", () => {
    const preRamp = baseline.results.filter(row => row.periodStart.startsWith("2026-") && row.load > 0);
    expect(northstarRecoveryModel.demand.some(row => row.shipDate.startsWith("2026-"))).toBe(false);
    expect(preRamp).toHaveLength(37);
    expect(preRamp.reduce((sum, row) => sum + row.load, 0)).toBeCloseTo(8744.253037520057, 8);
    expect(comparison).toMatchObject({ resolvedGapPeriods: 53, remainingGapPeriods: 41, worsenedGapPeriods: 0 });
    expect(comparison.rows.every(row => row.loadDelta === 0)).toBe(true);
  });
});
