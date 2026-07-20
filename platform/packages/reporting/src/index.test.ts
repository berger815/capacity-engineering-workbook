import { describe, expect, it } from "vitest";
import { compareCapacityScenarios } from "@capacity/engine";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { buildDecisionPackage, renderDecisionPackageHtml, serializeDecisionPackage } from "./index.js";

const appliedRecoveryActions = [
  "action-weld-cross-train",
  "action-heat-overflow",
  "action-add-positioners",
  "action-weld-hiring",
  "action-add-assembly",
  "action-add-test-stand",
];
const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
const decisionPackage = buildDecisionPackage(northstarRecoveryModel, comparison, "2026-07-18T18:00:00.000Z");

describe("portable decision package", () => {
  it("preserves the baseline, recovery, actions, and full assessment snapshot", () => {
    expect(decisionPackage.decision.baselineScenarioId).toBe("baseline");
    expect(decisionPackage.decision.comparisonScenarioId).toBe("recovery-1");
    expect(decisionPackage.actions).toHaveLength(6);
    expect(decisionPackage.lineage.appliedActionIds).toEqual(appliedRecoveryActions);
    expect(decisionPackage.assessmentSnapshot.model.modelId).toBe("northstar-v2");
    expect(decisionPackage.assessmentSnapshot.comparison.rows.length).toBeGreaterThan(0);
  });

  it("serializes as a self-contained JSON assessment package", () => {
    const json = serializeDecisionPackage(decisionPackage);
    const parsed = JSON.parse(json) as typeof decisionPackage;
    expect(parsed.packageSchemaVersion).toBe("1.0.0");
    expect(parsed.assessmentSnapshot.model.products).toHaveLength(4);
    expect(parsed.assessmentSnapshot.model.demand).toHaveLength(144);
    expect(parsed.assessmentSnapshot.comparison.appliedActionIds).toEqual(appliedRecoveryActions);
  });

  it("renders a standalone printable executive report", () => {
    const html = renderDecisionPackageHtml(decisionPackage);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Capacity Assurance Decision Package");
    expect(html).toContain("Install and qualify three welding positioners");
    expect(html).toContain("Add five qualified welders");
    expect(html).toContain("Applied action IDs");
    expect(html).not.toContain("<script");
  });
});
