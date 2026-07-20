import { describe, expect, it } from "vitest";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { calculateCapacity } from "./index.js";
import { explainConstraint } from "./explain.js";

const appliedRecoveryActions = [
  "action-weld-cross-train",
  "action-heat-overflow",
  "action-add-positioners",
  "action-weld-hiring",
  "action-add-assembly",
  "action-add-test-stand",
];

function loadedRow(scenarioId: string) {
  const calculation = calculateCapacity(northstarRecoveryModel, scenarioId);
  const row = calculation.results
    .filter(item => item.load > 0)
    .sort((a, b) => b.load - a.load)[0];
  expect(row).toBeDefined();
  return row!;
}

describe("constraint explanation", () => {
  it("reconciles detailed demand contributions to the calculated period load", () => {
    const row = loadedRow("baseline");
    const explanation = explainConstraint(
      northstarRecoveryModel,
      "baseline",
      row.resourceGroupId,
      row.periodStart,
    );

    expect(explanation.contributions.length).toBeGreaterThan(0);
    expect(explanation.totalExplainedLoad).toBeCloseTo(row.load, 8);
    expect(explanation.unexplainedLoad).toBeCloseTo(0, 8);
    expect(explanation.products.reduce((sum, item) => sum + item.load, 0)).toBeCloseTo(row.load, 8);
    expect(explanation.operations.reduce((sum, item) => sum + item.load, 0)).toBeCloseTo(row.load, 8);
  });

  it("identifies the precise routing and demand lineage for each contribution", () => {
    const row = loadedRow("baseline");
    const explanation = explainConstraint(
      northstarRecoveryModel,
      "baseline",
      row.resourceGroupId,
      row.periodStart,
    );
    const contribution = explanation.contributions[0]!;

    expect(contribution.demandId).toBeTruthy();
    expect(contribution.productId).toBeTruthy();
    expect(contribution.routingRevisionId).toBeTruthy();
    expect(contribution.operationId).toBeTruthy();
    expect(contribution.requirementId).toBeTruthy();
    expect(contribution.phaseAllocation).toBeGreaterThan(0);
    expect(contribution.totalLoad).toBeCloseTo(contribution.runLoad + contribution.setupLoad, 8);
  });

  it("preserves recovery lineage while explaining inherited baseline demand", () => {
    const row = loadedRow("recovery-1");
    const explanation = explainConstraint(
      northstarRecoveryModel,
      "recovery-1",
      row.resourceGroupId,
      row.periodStart,
    );

    expect(explanation.demandSourceScenarioId).toBe("baseline");
    expect(explanation.appliedActionIds).toEqual(appliedRecoveryActions);
    expect(explanation.totalExplainedLoad).toBeCloseTo(row.load, 8);
  });
});
