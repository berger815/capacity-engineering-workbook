import { describe, expect, it } from "vitest";
import type { CapacityModel } from "./model.js";
import { capacityModelSchema } from "./schema.js";

function model(): CapacityModel {
  return {
    schemaVersion: "1.0.0",
    modelId: "planning-test",
    name: "Planning test",
    planningGranularity: "month",
    horizonStart: "2027-01-01",
    horizonEnd: "2027-12-31",
    organization: [{ id: "site", name: "Site", type: "site" }],
    calendars: [{ id: "calendar", name: "Calendar", timezone: "UTC", weeklyMinutes: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 }, exceptions: [] }],
    resourceGroups: [{ id: "space", name: "Staging", organizationNodeId: "site", kind: "space", capacityUnit: "squareFeet", calendarId: "calendar", pooled: true }],
    resources: [{ id: "space-resource", resourceGroupId: "space", name: "Staging area", quantity: 1000, ratePerAvailableHour: 1, availability: 1, performance: 1, quality: 1 }],
    products: [{ id: "product", name: "Product", family: "Family", organizationNodeId: "site" }],
    routingRevisions: [],
    scenarios: [{ id: "baseline", name: "Baseline", kind: "baseline", createdAt: "2027-01-01T00:00:00.000Z" }],
    demand: [{ id: "demand", scenarioId: "baseline", productId: "product", shipDate: "2027-06-15", quantity: 20 }],
    footprintPlans: [{ id: "plan", departmentOrArea: "Staging", organizationNodeId: "site", calendarId: "calendar", productId: "product", dwellWorkingDays: 5, spacePerUnit: 20, basis: "squareFeet", availableCapacity: 1000, peakFactor: 1.2, confidence: "medium" }],
    planningWip: [{ id: "wip", scenarioId: "baseline", productId: "product", periodStart: "2027-06-01", quantity: 8, basis: "reported", confidence: "high" }],
    actionLog: [{ id: "log", createdAt: "2027-01-02T00:00:00.000Z", category: "data", note: "Validate the footprint source.", relatedEntityType: "footprintPlan", relatedEntityId: "plan", owner: "Facilities", dueDate: "2027-02-01" }],
  };
}

describe("planning context contracts", () => {
  it("accepts footprint, display-only WIP, and action log records", () => {
    const parsed = capacityModelSchema.safeParse(model());
    expect(parsed.success).toBe(true);
  });

  it("rejects planning WIP that references an unknown product", () => {
    const candidate = model();
    candidate.planningWip![0]!.productId = "missing";
    const parsed = capacityModelSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.message === "WIP product does not exist")).toBe(true);
  });

  it("prevents ambiguous footprint product and family targeting", () => {
    const candidate = model();
    candidate.footprintPlans![0]!.productFamily = "Family";
    const parsed = capacityModelSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.message.includes("either productId or productFamily"))).toBe(true);
  });
});
