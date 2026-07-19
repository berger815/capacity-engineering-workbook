import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { createCapacityApiServer, routeApiRequest } from "./app.js";

const openServers: Server[] = [];

const demandMapping = {
  productColumn: "product_id",
  shipDateColumn: "ship_date",
  quantityColumn: "quantity",
  productMatch: "id",
  dateFormat: "iso",
  demandClassColumn: "class",
  sourceRecordIdColumn: "record_id",
  sourceSystem: "test-export",
};

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

describe("Capacity Assurance API", () => {
  it("validates the canonical Northstar fixture and recovery plan", () => {
    const response = routeApiRequest("POST", "/v1/validate", { model: northstarRecoveryModel });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      valid: true,
      modelId: "northstar-v2",
      counts: {
        products: 4,
        resourceGroups: 12,
        routingRevisions: 4,
        demandRecords: 48,
        scenarios: 2,
        scenarioActions: 3,
      },
    });
  });

  it("previews mapped demand with reconciliation totals", () => {
    const csv = [
      "product_id,ship_date,quantity,class,record_id",
      "hx100,2027-10-15,10,forecast,R1",
      "hx200,2027-11-15,5,firm,R2",
    ].join("\n");

    const response = routeApiRequest("POST", "/v1/import/demand/preview", {
      model: northstarRecoveryModel,
      scenarioId: "baseline",
      csv,
      mapping: demandMapping,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      controlTotals: {
        inputRows: 2,
        acceptedRows: 2,
        rejectedRows: 0,
        totalQuantity: 15,
      },
    });
  });

  it("blocks partial demand replacement unless explicitly accepted", () => {
    const csv = [
      "product_id,ship_date,quantity,class,record_id",
      "hx100,2027-10-15,10,forecast,R1",
      "unknown,2027-11-15,5,firm,R2",
    ].join("\n");

    const blocked = routeApiRequest("POST", "/v1/import/demand/apply", {
      model: northstarRecoveryModel,
      scenarioId: "baseline",
      csv,
      mapping: demandMapping,
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toMatchObject({ code: "IMPORT_HAS_REJECTED_ROWS" });

    const accepted = routeApiRequest("POST", "/v1/import/demand/apply", {
      model: northstarRecoveryModel,
      scenarioId: "baseline",
      csv,
      mapping: demandMapping,
      acceptPartial: true,
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.body as { model: { demand: unknown[] }; import: { controlTotals: { acceptedRows: number; rejectedRows: number } } };
    expect(body.model.demand).toHaveLength(1);
    expect(body.import.controlTotals).toMatchObject({ acceptedRows: 1, rejectedRows: 1 });
  });

  it("calculates Northstar and pulls long-lead work into 2026", () => {
    const response = routeApiRequest("POST", "/v1/calculate", {
      model: northstarRecoveryModel,
      scenarioId: "baseline",
    });
    expect(response.statusCode).toBe(200);

    const result = response.body as {
      results: Array<{ periodStart: string; load: number; resourceGroupId: string }>;
      governingConstraint: unknown;
      issues: unknown[];
    };

    expect(result.governingConstraint).not.toBeNull();
    expect(result.results.some(row => row.periodStart.startsWith("2026-") && row.load > 0)).toBe(true);
    expect(result.results.some(row => row.resourceGroupId === "rg-oven" && row.load > 0)).toBe(true);
  });

  it("compares an immutable baseline with its governed recovery scenario", () => {
    const response = routeApiRequest("POST", "/v1/compare", {
      model: northstarRecoveryModel,
      baselineScenarioId: "baseline",
      comparisonScenarioId: "recovery-1",
    });
    expect(response.statusCode).toBe(200);

    const comparison = response.body as {
      appliedActionIds: string[];
      rows: Array<{ resourceGroupId: string; periodStart: string; capacityDelta: number; loadDelta: number }>;
      comparison: { demandSourceScenarioId: string };
    };
    expect(comparison.appliedActionIds).toHaveLength(3);
    expect(comparison.comparison.demandSourceScenarioId).toBe("baseline");
    expect(comparison.rows.some(row => row.resourceGroupId === "rg-oven" && row.periodStart === "2027-07-01" && row.capacityDelta > 0)).toBe(true);
    expect(comparison.rows.every(row => row.loadDelta === 0)).toBe(true);
  });

  it("generates a standalone printable executive report", () => {
    const response = routeApiRequest("POST", "/v1/report/decision", {
      model: northstarRecoveryModel,
      baselineScenarioId: "baseline",
      comparisonScenarioId: "recovery-1",
      format: "html",
    });
    expect(response.statusCode).toBe(200);
    const report = response.body as { filename: string; mimeType: string; content: string; decision: { classification: string } };
    expect(report.filename).toMatch(/decision\.html$/);
    expect(report.mimeType).toContain("text/html");
    expect(report.content).toContain("Capacity Assurance Decision Package");
    expect(report.content).toContain("Install third heat-treatment oven");
    expect(report.decision.classification).toMatch(/supportable|conditional|notSupportable|incomplete/);
  });

  it("generates a portable JSON assessment with the full model snapshot", () => {
    const response = routeApiRequest("POST", "/v1/report/decision", {
      model: northstarRecoveryModel,
      baselineScenarioId: "baseline",
      comparisonScenarioId: "recovery-1",
      format: "json",
    });
    expect(response.statusCode).toBe(200);
    const report = response.body as { filename: string; mimeType: string; content: string };
    expect(report.filename).toMatch(/portable-assessment\.json$/);
    expect(report.mimeType).toContain("application/json");
    const portable = JSON.parse(report.content) as { assessmentSnapshot: { model: { products: unknown[] }; comparison: { appliedActionIds: string[] } } };
    expect(portable.assessmentSnapshot.model.products).toHaveLength(4);
    expect(portable.assessmentSnapshot.comparison.appliedActionIds).toHaveLength(3);
  });

  it("rejects invalid models before calculation", () => {
    const response = routeApiRequest("POST", "/v1/calculate", {
      model: { modelId: "broken" },
      scenarioId: "baseline",
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({ code: "MODEL_VALIDATION_FAILED" });
  });

  it("serves scenario comparison over HTTP", async () => {
    const server = createCapacityApiServer();
    openServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: northstarRecoveryModel,
        baselineScenarioId: "baseline",
        comparisonScenarioId: "recovery-1",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { modelId: string; rows: unknown[]; appliedActionIds: string[] };
    expect(body.modelId).toBe("northstar-v2");
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.appliedActionIds).toHaveLength(3);
  });
});
