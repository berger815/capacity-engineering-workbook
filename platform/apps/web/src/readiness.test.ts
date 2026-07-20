import { describe, expect, it } from "vitest";
import { northstarRecoveryModel } from "@capacity/fixtures";
import { calculationEntities, entityCopy, entityDefinition, entityReadiness } from "./workbench/entityDefinitions.js";

describe("Workbench calculation readiness", () => {
  it("recognizes a fully populated supplier model", () => {
    const states = calculationEntities.map(entity => entityReadiness(northstarRecoveryModel, entity, "baseline"));
    expect(states.every(state => state.ready)).toBe(true);
  });

  it("identifies missing resources and demand", () => {
    const model = { ...northstarRecoveryModel, resources: [], demand: [] };
    expect(entityReadiness(model, "resources", "baseline").ready).toBe(false);
    expect(entityReadiness(model, "demand", "baseline").ready).toBe(false);
    expect(entityReadiness(model, "products", "baseline").ready).toBe(true);
  });

  it("uses plain language in Guided mode", () => {
    const routing = entityDefinition("routing");
    expect(entityCopy(routing, "guided").label).toBe("Hours per part");
    expect(entityCopy(routing, "expert").label).toBe("Routing");
  });
});
