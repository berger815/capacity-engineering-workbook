import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { northstarRecoveryModel } from "@capacity/fixtures";
import {
  genericProductProfile,
  genericResourceGroupProfile,
  genericRoutingProfile,
} from "@capacity/importer";
import { createCapacityApiServer, routeApiRequest } from "./appV2.js";

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
      counts: { products: 4, resourceGroups: 12, routingRevisions: 4, demandRecords: 48, scenarios: 2, scenarioActions: 3 },
    });
  });

  it("previews and transactionally applies a product import", () => {
    const csv = [
      "productId,productName,externalKey,productFamily,organizationNodeId",
      "new-product,New Product,NEW,Launch,site-northstar",
    ].join("\n");
    const preview = routeApiRequest("POST", "/v1/import/products/preview", {
      model: northstarRecoveryModel,
      csv,
      mapping: genericProductProfile.mapping,
      mode: "replaceById",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toMatchObject({ controlTotals: { acceptedRows: 1, addedRecords: 1, rejectedRows: 0 } });

    const applied = routeApiRequest("POST", "/v1/import/products/apply", {
      model: northstarRecoveryModel,
      csv,
      mapping: genericProductProfile.mapping,
      mode: "replaceById",
    });
    expect(applied.statusCode).toBe(200);
    const body = applied.body as { model: { products: Array<{ id: string }> } };
    expect(body.model.products.some(product => product.id === "new-product")).toBe(true);
    expect(northstarRecoveryModel.products.some(product => product.id === "new-product")).toBe(false);
  });

  it("blocks an invalid resource-group dependency without mutating the model", () => {
    const csv = [
      "resourceGroupId,resourceGroupName,resourceKind,capacityUnit,calendarId,organizationNodeId,pooled,tags",
      "rg-new,New Group,labor,hours,missing-calendar,site-northstar,true,test",
    ].join("\n");
    const response = routeApiRequest("POST", "/v1/import/resource-groups/apply", {
      model: northstarRecoveryModel,
      csv,
      mapping: genericResourceGroupProfile.mapping,
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({ code: "IMPORT_HAS_REJECTED_ROWS" });
    expect(northstarRecoveryModel.resourceGroups.some(group => group.id === "rg-new")).toBe(false);
  });

  it("applies the valid sibling operation from a partially rejected routing revision only when accepted", () => {
    const productId = northstarRecoveryModel.products[0]?.id ?? "";
    const groupId = northstarRecoveryModel.resourceGroups[0]?.id ?? "";
    const csv = [
      "productId,revisionId,revision,effectiveFrom,effectiveTo,phaseId,phaseName,startWeeksBeforeShip,endWeeksBeforeShip,allocation,operationId,operationName,operationSequence,resourceGroupId,requirementState,requirementValue,setupRequirementState,setupRequirementValue,setupQuantity,batchSize",
      `${productId},future-z,Z,2030-01-01,2030-12-31,p1,Build,8,4,spread,o1,Good operation,10,${groupId},value,2,,,,1`,
      `${productId},future-z,Z,2030-01-01,2030-12-31,p1,Build,8,4,spread,o2,Bad operation,20,${groupId},invalid,2,,,,1`,
    ].join("\n");
    const blocked = routeApiRequest("POST", "/v1/import/routing/apply", {
      model: northstarRecoveryModel,
      csv,
      mapping: genericRoutingProfile.mapping,
    });
    expect(blocked.statusCode).toBe(422);

    const applied = routeApiRequest("POST", "/v1/import/routing/apply", {
      model: northstarRecoveryModel,
      csv,
      mapping: genericRoutingProfile.mapping,
      acceptPartial: true,
    });
    expect(applied.statusCode).toBe(200);
    const body = applied.body as { model: { routingRevisions: Array<{ revision: string; operations: unknown[] }> }; import: { controlTotals: { rejectedOperationCount: number } } };
    const revision = body.model.routingRevisions.find(item => item.revision === "Z");
    expect(revision?.operations).toHaveLength(1);
    expect(body.import.controlTotals.rejectedOperationCount).toBe(1);
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
    expect(response.body).toMatchObject({ controlTotals: { inputRows: 2, acceptedRows: 2, rejectedRows: 0, totalQuantity: 15 } });
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
    const response = routeApiRequest("POST", "/v1/calculate", { model: northstarRecoveryModel, scenarioId: "baseline" });
    expect(response.statusCode).toBe(200);
    const result = response.body as { results: Array<{ periodStart: string; load: number; resourceGroupId: string }>; governingConstraint: unknown; issues: unknown[] };
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
    const comparison = response.body as { appliedActionIds: string[]; rows: Array<{ resourceGroupId: string; periodStart: string; capacityDelta: number; loadDelta: number }>; comparison: { demandSourceScenarioId: string } };
    expect(comparison.appliedActionIds).toHaveLength(3);
    expect(comparison.comparison.demandSourceScenarioId).toBe("baseline");
    expect(comparison.rows.some(row => row.resourceGroupId === "rg-oven" && row.periodStart === "2027-07-01" && row.capacityDelta > 0)).toBe(true);
    expect(comparison.rows.every(row => row.loadDelta === 0)).toBe(true);
  });

  it("generates standalone HTML and portable JSON reports", () => {
    const html = routeApiRequest("POST", "/v1/report/decision", {
      model: northstarRecoveryModel,
      baselineScenarioId: "baseline",
      comparisonScenarioId: "recovery-1",
      format: "html",
    });
    expect(html.statusCode).toBe(200);
    expect((html.body as { content: string }).content).toContain("Capacity Assurance Decision Package");

    const json = routeApiRequest("POST", "/v1/report/decision", {
      model: northstarRecoveryModel,
      baselineScenarioId: "baseline",
      comparisonScenarioId: "recovery-1",
      format: "json",
    });
    expect(json.statusCode).toBe(200);
    const portable = JSON.parse((json.body as { content: string }).content) as { assessmentSnapshot: { model: { products: unknown[] }; comparison: { appliedActionIds: string[] } } };
    expect(portable.assessmentSnapshot.model.products).toHaveLength(4);
    expect(portable.assessmentSnapshot.comparison.appliedActionIds).toHaveLength(3);
  });

  it("rejects invalid models before calculation", () => {
    const response = routeApiRequest("POST", "/v1/calculate", { model: { modelId: "broken" }, scenarioId: "baseline" });
    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({ code: "MODEL_VALIDATION_FAILED" });
  });

  it("serves entity imports and scenario comparison over HTTP", async () => {
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
      body: JSON.stringify({ model: northstarRecoveryModel, baselineScenarioId: "baseline", comparisonScenarioId: "recovery-1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { modelId: string; rows: unknown[]; appliedActionIds: string[] };
    expect(body.modelId).toBe("northstar-v2");
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.appliedActionIds).toHaveLength(3);
  });
});
