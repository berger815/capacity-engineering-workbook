import { describe, expect, it } from "vitest";
import { capacityModelSchema } from "@capacity/domain";
import { northstarV2Model } from "./northstar-v2.js";

function routedGroups(productId: string): Set<string> {
  const revision = northstarV2Model.routingRevisions.find(item => item.productId === productId);
  if (!revision) throw new Error(`Missing route for ${productId}`);
  return new Set(revision.operations.flatMap(operation => operation.requirements.map(item => item.resourceGroupId)));
}

function requirement(productId: string, resourceGroupId: string): number {
  const revision = northstarV2Model.routingRevisions.find(item => item.productId === productId);
  const record = revision?.operations.flatMap(operation => operation.requirements).find(item => item.resourceGroupId === resourceGroupId);
  if (record?.requirement.state !== "value" || record.requirement.value === undefined) throw new Error(`Missing ${resourceGroupId} requirement for ${productId}`);
  return record.requirement.value;
}

describe("Northstar v2 canonical fixture", () => {
  it("passes runtime schema validation", () => {
    expect(capacityModelSchema.safeParse(northstarV2Model).success).toBe(true);
  });

  it("preserves four product-specific lead-time envelopes", () => {
    const maximumLeadTime = Object.fromEntries(
      northstarV2Model.routingRevisions.map(revision => [
        revision.productId,
        Math.max(...revision.phases.map(phase => phase.startWeeksBeforeShip)),
      ]),
    );

    expect(maximumLeadTime).toEqual({ hx100: 20, hx200: 36, hx300: 14, service: 8 });
  });

  it("stores bypasses sparsely rather than as ambiguous zero-hour requirements", () => {
    expect(routedGroups("hx300").has("rg-weld")).toBe(false);
    expect(routedGroups("hx300").has("rg-heat")).toBe(false);
    expect(routedGroups("hx300").has("rg-positioner")).toBe(false);
    expect(routedGroups("service").has("rg-plate")).toBe(false);
    expect(routedGroups("service").has("rg-weld")).toBe(false);
    expect(routedGroups("hx200").has("rg-weld")).toBe(true);
    expect(routedGroups("hx200").has("rg-oven")).toBe(true);
  });

  it("contains the complete monthly 2027 through 2029 launch demand series", () => {
    expect(northstarV2Model.horizonEnd).toBe("2029-12-31");
    expect(northstarV2Model.demand).toHaveLength(144);
    expect(northstarV2Model.demand.reduce((sum, row) => sum + row.quantity, 0)).toBe(8482);
    const byYear = Object.fromEntries(["2027", "2028", "2029"].map(year => [
      year,
      northstarV2Model.demand.filter(row => row.shipDate.startsWith(year)).reduce((sum, row) => sum + row.quantity, 0),
    ]));
    expect(byYear).toEqual({ 2027: 1990, 2028: 2994, 2029: 3498 });
  });

  it("translates source equipment counts and routing standards", () => {
    const quantities = Object.fromEntries(northstarV2Model.resources.filter(resource => ["res-positioner", "res-oven", "res-test-stand", "res-mod-fixture"].includes(resource.id)).map(resource => [resource.id, resource.quantity]));
    expect(quantities).toEqual({ "res-positioner": 6, "res-oven": 4, "res-mod-fixture": 4, "res-test-stand": 5 });
    expect(requirement("hx100", "rg-positioner")).toBeCloseTo(5.15, 10);
    expect(requirement("hx200", "rg-positioner")).toBeCloseTo(8.24, 10);
    expect(requirement("hx200", "rg-oven")).toBeCloseTo(2.424, 10);
    expect(requirement("hx300", "rg-mod-fixture")).toBeCloseTo(4.12, 10);
    expect(requirement("hx200", "rg-test-stand")).toBeCloseTo(3.535, 10);
  });
});
