import { describe, expect, it } from "vitest";
import { northstarV2Model } from "@capacity/fixtures";
import { definitionsForScope, definitionForEntity, dependencyCount } from "./entityDefinitions.js";
import { pointsForFootprintPlan } from "./FootprintWipEditor.js";

describe("model workbench registry", () => {
  it("shows every modeled entity in expert scope", () => {
    expect(definitionsForScope("all").map(item => item.id)).toEqual([
      "products",
      "calendars",
      "resource-groups",
      "resources",
      "routing",
      "demand",
      "footprint",
      "actions",
    ]);
  });

  it("keeps guided data focused on calculation prerequisites", () => {
    expect(definitionsForScope("core-data").map(item => item.id)).toEqual([
      "products",
      "calendars",
      "resource-groups",
      "resources",
      "routing",
      "demand",
    ]);
  });

  it("does not advertise import for planning-only entities", () => {
    expect(definitionForEntity("footprint").inputEntity).toBeUndefined();
    expect(definitionForEntity("actions").inputEntity).toBeUndefined();
  });

  it("reports dependency counts from the canonical model", () => {
    expect(dependencyCount(northstarV2Model, "products")).toBe(northstarV2Model.products.length);
    expect(dependencyCount(northstarV2Model, "calendars")).toBe(northstarV2Model.calendars.length);
  });
});

describe("footprint planning", () => {
  it("uses reported WIP instead of derived WIP for a matching product-period", () => {
    const plan = northstarV2Model.footprintPlans?.find(item => item.productId === "hx300") ?? northstarV2Model.footprintPlans?.[0];
    expect(plan).toBeDefined();
    const points = pointsForFootprintPlan(northstarV2Model, plan!, "baseline");
    const reported = points.find(point => point.source === "reported");
    expect(reported).toBeDefined();
    expect(reported?.concurrentWip).toBeGreaterThan(0);
  });

  it("keeps footprint calculations separate from capacity-engine load", () => {
    const plan = northstarV2Model.footprintPlans?.[0];
    expect(plan).toBeDefined();
    const before = JSON.stringify(northstarV2Model.demand);
    pointsForFootprintPlan(northstarV2Model, plan!, "baseline");
    expect(JSON.stringify(northstarV2Model.demand)).toBe(before);
  });
});
