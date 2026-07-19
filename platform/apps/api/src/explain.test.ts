import { describe, expect, it } from "vitest";
import { calculateCapacity } from "@capacity/engine";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { routeApiRequest } from "./app.js";

describe("constraint explanation API", () => {
  it("returns fully reconciled product, operation, and demand lineage", () => {
    const calculation = calculateCapacity(northstarRecoveryModel, "recovery-1");
    const row = calculation.results
      .filter(item => item.load > 0)
      .sort((a, b) => b.load - a.load)[0]!;

    const response = routeApiRequest("POST", "/v1/explain", {
      model: northstarRecoveryModel,
      scenarioId: "recovery-1",
      resourceGroupId: row.resourceGroupId,
      periodStart: row.periodStart,
    });

    expect(response.statusCode).toBe(200);
    const explanation = response.body as {
      result: { load: number };
      totalExplainedLoad: number;
      unexplainedLoad: number;
      products: unknown[];
      operations: unknown[];
      contributions: Array<{ demandId: string; routingRevisionId: string; phaseAllocation: number }>;
      demandSourceScenarioId: string;
      appliedActionIds: string[];
    };

    expect(explanation.totalExplainedLoad).toBeCloseTo(explanation.result.load, 8);
    expect(explanation.unexplainedLoad).toBeCloseTo(0, 8);
    expect(explanation.products.length).toBeGreaterThan(0);
    expect(explanation.operations.length).toBeGreaterThan(0);
    expect(explanation.contributions[0]).toMatchObject({
      demandId: expect.any(String),
      routingRevisionId: expect.any(String),
      phaseAllocation: expect.any(Number),
    });
    expect(explanation.demandSourceScenarioId).toBe("baseline");
    expect(explanation.appliedActionIds).toHaveLength(3);
  });

  it("rejects a resource-period that is not present in the calculation horizon", () => {
    const response = routeApiRequest("POST", "/v1/explain", {
      model: northstarRecoveryModel,
      scenarioId: "baseline",
      resourceGroupId: "rg-weld",
      periodStart: "2035-01-01",
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "EXPLANATION_REJECTED" });
  });
});
