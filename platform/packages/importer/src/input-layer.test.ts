import { describe, expect, it } from "vitest";
import type { CapacityModel } from "@capacity/domain";
import {
  genericCalendarExceptionProfile,
  genericCalendarProfile,
  genericProductProfile,
  genericResourceGroupProfile,
  genericResourceProfile,
  genericRoutingProfile,
  importCalendarsCsv,
  importProductsCsv,
  importResourceGroupsCsv,
  importResourcesCsv,
  importRoutingCsv,
  mergeProductsImport,
} from "./index.js";

const baseModel: CapacityModel = {
  schemaVersion: "1.0.0",
  modelId: "test",
  name: "Importer Test",
  planningGranularity: "month",
  horizonStart: "2026-01-01",
  horizonEnd: "2027-12-31",
  organization: [{ id: "site", name: "Site", type: "site" }],
  calendars: [{
    id: "cal-base",
    name: "Base calendar",
    timezone: "America/New_York",
    weeklyMinutes: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 },
    exceptions: [],
  }],
  resourceGroups: [{
    id: "rg-base",
    name: "Base labor",
    organizationNodeId: "site",
    kind: "labor",
    capacityUnit: "hours",
    calendarId: "cal-base",
    pooled: true,
  }],
  resources: [],
  products: [{ id: "existing", name: "Existing", organizationNodeId: "site", externalKeys: { source: "EX" } }],
  routingRevisions: [],
  scenarios: [{ id: "baseline", name: "Baseline", kind: "baseline", createdAt: "2026-01-01T00:00:00.000Z" }],
  demand: [],
};

describe("product import", () => {
  it("creates products and reports replace-by-id totals", () => {
    const mapping = { ...genericProductProfile.mapping, organizationNodeColumn: "organizationNodeId" };
    const csv = [
      "productId,productName,externalKey,productFamily,organizationNodeId",
      "existing,Existing revised,EX,Legacy,site",
      "new,New product,NEW,Launch,site",
    ].join("\n");
    const result = importProductsCsv(csv, baseModel, mapping);
    expect(result.issues).toEqual([]);
    expect(result.controlTotals).toMatchObject({ acceptedRows: 2, addedRecords: 1, replacedRecords: 1 });
    const merged = mergeProductsImport(baseModel, result.records);
    expect(merged.products.map(product => product.id).sort()).toEqual(["existing", "new"]);
    expect(merged.products.find(product => product.id === "existing")?.name).toBe("Existing revised");
  });

  it("rejects duplicate product IDs and external keys", () => {
    const csv = [
      "productId,productName,externalKey,productFamily,organizationNodeId",
      "a,Product A,DUP,Family,site",
      "a,Product A2,DUP,Family,site",
    ].join("\n");
    const result = importProductsCsv(csv, baseModel, genericProductProfile.mapping);
    expect(result.records).toHaveLength(1);
    expect(result.issues.map(issue => issue.code)).toContain("PRODUCT_ID_DUPLICATE");
  });
});

describe("calendar import", () => {
  it("reconstructs weekly minutes and exceptions", () => {
    const csv = [
      "calendarId,calendarName,timezone,monMinutes,tueMinutes,wedMinutes,thuMinutes,friMinutes,satMinutes,sunMinutes",
      "cal-2,Second shift,America/New_York,480,480,480,480,480,240,0",
    ].join("\n");
    const exceptions = [
      "calendarId,exceptionDate,availableMinutes,reason",
      "cal-2,2026-12-25,0,Holiday",
    ].join("\n");
    const result = importCalendarsCsv(csv, exceptions, baseModel, genericCalendarProfile.mapping, genericCalendarExceptionProfile.mapping);
    expect(result.issues).toEqual([]);
    expect(result.records[0]?.weeklyMinutes[1]).toBe(480);
    expect(result.records[0]?.weeklyMinutes[0]).toBeUndefined();
    expect(result.records[0]?.exceptions[0]).toMatchObject({ date: "2026-12-25", availableMinutes: 0, reason: "Holiday" });
    expect(result.controlTotals).toMatchObject({ calendarCount: 1, exceptionCount: 1, earliestExceptionDate: "2026-12-25" });
  });

  it("rejects invalid daily minutes", () => {
    const csv = [
      "calendarId,calendarName,timezone,monMinutes,tueMinutes,wedMinutes,thuMinutes,friMinutes,satMinutes,sunMinutes",
      "bad,Bad,UTC,1500,480,480,480,480,0,0",
    ].join("\n");
    const result = importCalendarsCsv(csv, undefined, baseModel, genericCalendarProfile.mapping, undefined);
    expect(result.records).toHaveLength(0);
    expect(result.issues.map(issue => issue.code)).toContain("WEEKLY_MINUTES_INVALID");
  });
});

describe("resource group and resource import", () => {
  it("loads explicit resource groups before resources", () => {
    const groupCsv = [
      "resourceGroupId,resourceGroupName,resourceKind,capacityUnit,calendarId,organizationNodeId,pooled,tags",
      "rg-oven,Ovens,equipment,hours,cal-base,site,true,heat|critical",
    ].join("\n");
    const groupImport = importResourceGroupsCsv(groupCsv, baseModel, genericResourceGroupProfile.mapping);
    expect(groupImport.issues).toEqual([]);
    const withGroups = { ...baseModel, resourceGroups: [...baseModel.resourceGroups, ...groupImport.records] };

    const resourceCsv = [
      "resourceId,resourceName,resourceGroupId,calendarId,quantity,ratePerAvailableHour,availability,performance,quality,effectiveFrom,effectiveTo",
      "oven-1,Oven 1,rg-oven,cal-base,2,1,90,95,98,2026-01-01,2027-12-31",
    ].join("\n");
    const mapping = { ...genericResourceProfile.mapping, factorFormat: "percent" as const };
    const result = importResourcesCsv(resourceCsv, withGroups, mapping);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({ quantity: 2, availability: 0.9, performance: 0.95, quality: 0.98 });
    expect(result.controlTotals.totalQuantity).toBe(2);
  });

  it("does not silently normalize percentage-looking decimals", () => {
    const csv = [
      "resourceId,resourceName,resourceGroupId,calendarId,quantity,ratePerAvailableHour,availability,performance,quality,effectiveFrom,effectiveTo",
      "bad,Bad,rg-base,cal-base,1,1,90,1,1,,",
    ].join("\n");
    const result = importResourcesCsv(csv, baseModel, genericResourceProfile.mapping);
    expect(result.records).toHaveLength(0);
    expect(result.issues.map(issue => issue.code)).toContain("FACTOR_OUT_OF_RANGE");
  });
});

describe("routing import", () => {
  it("reconstructs a nested revision while rejecting one malformed operation", () => {
    const csv = [
      "productId,revisionId,revision,effectiveFrom,effectiveTo,phaseId,phaseName,startWeeksBeforeShip,endWeeksBeforeShip,allocation,operationId,operationName,operationSequence,resourceGroupId,requirementState,requirementValue,setupRequirementState,setupRequirementValue,setupQuantity,batchSize",
      "existing,A,A,2026-01-01,2026-12-31,fab,Fabrication,8,4,spread,op10,Cut,10,rg-base,value,2,,,,1",
      "existing,A,A,2026-01-01,2026-12-31,fab,Fabrication,8,4,spread,op20,Weld,20,rg-base,invalid,3,,,,1",
    ].join("\n");
    const result = importRoutingCsv(csv, baseModel, genericRoutingProfile.mapping);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.operations).toHaveLength(1);
    expect(result.records[0]?.operations[0]?.name).toBe("Cut");
    expect(result.controlTotals).toMatchObject({
      acceptedRevisionCount: 1,
      acceptedOperationCount: 1,
      rejectedOperationCount: 1,
      acceptedRequirementCount: 1,
      rejectedRequirementCount: 1,
    });
    expect(result.issues.map(issue => issue.code)).toContain("REQUIREMENT_STATE_INVALID");
  });

  it("rejects overlapping revisions for the same product", () => {
    const model: CapacityModel = {
      ...baseModel,
      routingRevisions: [{
        id: "existing:A",
        productId: "existing",
        revision: "A",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        phases: [{ id: "p", name: "P", startWeeksBeforeShip: 1, endWeeksBeforeShip: 0, allocation: "spread" }],
        operations: [{ id: "o", sequence: 10, name: "O", phaseId: "p", requirements: [{ id: "r", resourceGroupId: "rg-base", requirement: { state: "value", value: 1, unit: "hours" } }] }],
      }],
    };
    const csv = [
      "productId,revisionId,revision,effectiveFrom,effectiveTo,phaseId,phaseName,startWeeksBeforeShip,endWeeksBeforeShip,allocation,operationId,operationName,operationSequence,resourceGroupId,requirementState,requirementValue,setupRequirementState,setupRequirementValue,setupQuantity,batchSize",
      "existing,B,B,2026-06-01,2027-01-31,p,P,1,0,spread,o,O,10,rg-base,value,1,,,,1",
    ].join("\n");
    const result = importRoutingCsv(csv, model, genericRoutingProfile.mapping);
    expect(result.records).toHaveLength(0);
    expect(result.issues.map(issue => issue.code)).toContain("REVISION_OVERLAP");
  });
});
