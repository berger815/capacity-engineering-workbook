import { describe, expect, it } from "vitest";
import { compareCapacityScenarios } from "@capacity/engine";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { buildDecisionPackage } from "@capacity/reporting";
import { renderFieldDecisionPackageHtml } from "./fieldDecisionReport.js";

describe("supplier finding report", () => {
  it("puts the supplier verdict and governing facts on page one", () => {
    const comparison = compareCapacityScenarios(northstarRecoveryModel, "baseline", "recovery-1");
    const html = renderFieldDecisionPackageHtml(buildDecisionPackage(northstarRecoveryModel, comparison));
    expect(html).toContain("Supplier Capacity Assessment &amp; Verification");
    expect(html).toContain("Governing constraint");
    expect(html).toContain("Binding period");
    expect(html).toMatch(/Capacity shortage|Remaining margin/);
    expect(html).toContain("This is a modeled finding—not a guarantee");
  });
});
