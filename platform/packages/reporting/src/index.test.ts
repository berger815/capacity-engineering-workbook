import { describe, expect, it } from "vitest";
import { compareCapacityScenarios } from "@capacity/engine";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { buildDecisionPackage, renderDecisionPackageHtml, serializeDecisionPackage } from "./index.js";

const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
const decisionPackage = buildDecisionPackage(northstarRecoveryModel, comparison, "2026-07-18T18:00:00.000Z");

describe("portable decision package", () => {
  it("preserves the baseline, recovery, actions, and full assessment snapshot", () => {
    expect(decisionPackage.decision.baselineScenarioId).toBe("baseline");
    expect(decisionPackage.decision.comparisonScenarioId).toBe("recovery-1");
    expect(decisionPackage.actions).toHaveLength(3);
    expect(decisionPackage.lineage.appliedActionIds).toHaveLength(3);
    expect(decisionPackage.assessmentSnapshot.model.modelId).toBe("northstar-v2");
    expect(decisionPackage.assessmentSnapshot.comparison.rows.length).toBeGreaterThan(0);
  });

  it("serializes as a self-contained JSON assessment package", () => {
    const json = serializeDecisionPackage(decisionPackage);
    const parsed = JSON.parse(json) as typeof decisionPackage;
    expect(parsed.packageSchemaVersion).toBe("1.0.0");
    expect(parsed.assessmentSnapshot.model.products).toHaveLength(4);
    expect(parsed.assessmentSnapshot.comparison.appliedActionIds).toEqual([
      "action-add-oven",
      "action-weld-overtime",
      "action-add-test-stand",
    ]);
  });

  it("renders a standalone printable executive report", () => {
    const html = renderDecisionPackageHtml(decisionPackage);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Capacity Assurance Decision Package");
    expect(html).toContain("Install third heat-treatment oven");
    expect(html).toContain("Applied action IDs");
    expect(html).not.toContain("<script");
  });
});
