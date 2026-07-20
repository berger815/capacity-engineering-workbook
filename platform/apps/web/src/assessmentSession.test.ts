import { describe, expect, it } from "vitest";
import { capacityModelSchema } from "@capacity/domain";
import { createNewAssessment, parseAssessmentFile, serializeAssessmentSession } from "./assessmentSession.js";

const model = createNewAssessment({
  name: "Supplier A Capacity Assessment",
  horizonStart: "2026-01-01",
  horizonEnd: "2027-12-31",
  planningGranularity: "month",
});

describe("local assessment lifecycle", () => {
  it("creates a schema-valid starter assessment", () => {
    expect(capacityModelSchema.safeParse(model).success).toBe(true);
    expect(model.metadata).toMatchObject({ assessmentMode: "local", starterTemplate: true });
    expect(model.organization).toHaveLength(1);
    expect(model.calendars).toHaveLength(1);
  });

  it("round-trips a working assessment file", () => {
    const content = serializeAssessmentSession({
      sessionSchemaVersion: "1.0.0",
      savedAt: "2026-07-20T12:00:00.000Z",
      origin: "new",
      activeStep: "data",
      experience: "guided",
      model,
      calculation: null,
      comparison: null,
    });
    const opened = parseAssessmentFile(content);
    expect(opened.model).toEqual(model);
    expect(opened.calculation).toBeNull();
    expect(opened.comparison).toBeNull();
  });

  it("reopens a decision evidence package assessment snapshot", () => {
    const content = JSON.stringify({
      packageSchemaVersion: "1.0.0",
      assessmentSnapshot: { model, comparison: null },
    });
    expect(parseAssessmentFile(content).model.modelId).toBe(model.modelId);
  });

  it("rejects malformed or non-assessment JSON", () => {
    expect(() => parseAssessmentFile("not-json")).toThrow(/valid JSON/);
    expect(() => parseAssessmentFile(JSON.stringify({ hello: "world" }))).toThrow();
  });
});
