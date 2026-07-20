import { describe, expect, it } from "vitest";
import { capacityModelSchema, type CapacityModel } from "@capacity/domain";
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
  mergeCalendarsImport,
  mergeProductsImport,
  mergeResourceGroupsImport,
  mergeResourcesImport,
  mergeRoutingImport,
} from "./index.js";

const model: CapacityModel = {
  schemaVersion: "1.0.0",
  modelId: "contract-test",
  name: "Importer Contract Test",
  planningGranularity: "month",
  horizonStart: "2026-01-01",
  horizonEnd: "2027-12-31",
  organization: [{ id: "site", name: "Site", type: "site" }],
  calendars: [{ id: "cal-base", name: "Base", timezone: "UTC", weeklyMinutes: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 }, exceptions: [] }],
  resourceGroups: [{ id: "rg-base", name: "Base labor", organizationNodeId: "site", kind: "labor", capacityUnit: "hours", calendarId: "cal-base", pooled: true }],
  resources: [{ id: "res-base", resourceGroupId: "rg-base", name: "Base resource", quantity: 1, ratePerAvailableHour: 1, availability: 1, performance: 1, quality: 1 }],
  products: [{ id: "product-base", name: "Base product", organizationNodeId: "site", externalKeys: { source: "BASE" } }],
  routingRevisions: [],
  scenarios: [{ id: "baseline", name: "Baseline", kind: "baseline", createdAt: "2026-01-01T00:00:00.000Z" }],
  demand: [],
};

const routingHeader = "productId,revisionId,revision,effectiveFrom,effectiveTo,phaseId,phaseName,startWeeksBeforeShip,endWeeksBeforeShip,allocation,operationId,operationName,operationSequence,resourceGroupId,requirementState,requirementValue,setupRequirementState,setupRequirementValue,setupQuantity,batchSize";
const codes = (result: { issues: Array<{ code: string }> }) => result.issues.map(issue => issue.code);

describe("product importer contract", () => {
  it("fails fast when a required mapped column is absent", () => {
    expect(() => importProductsCsv("productId,externalKey,productFamily,organizationNodeId\nnew,NEW,Family,site", model, genericProductProfile.mapping)).toThrow(/productName/);
  });

  it("fully rejects malformed rows and reconciles totals", () => {
    const csv = ["productId,productName,externalKey,productFamily,organizationNodeId", "good,Good,GOOD,Family,site", ",Missing ID,BAD,Family,site", "bad-org,Bad organization,BADORG,Family,unknown"].join("\n");
    const result = importProductsCsv(csv, model, genericProductProfile.mapping);
    expect(result.records.map(item => item.id)).toEqual(["good"]);
    expect(result.controlTotals).toMatchObject({ inputRows: 3, acceptedRows: 1, rejectedRows: 2, totalProducts: 1 });
    expect(codes(result)).toEqual(expect.arrayContaining(["PRODUCT_ID_REQUIRED", "ORGANIZATION_UNKNOWN"]));
  });

  it("rejects append collisions and produces a valid replacement model", () => {
    const csv = ["productId,productName,externalKey,productFamily,organizationNodeId", "product-base,Revised product,BASE,Family,site"].join("\n");
    expect(() => importProductsCsv(csv, model, genericProductProfile.mapping, "append")).toThrow(/already exists/);
    const imported = importProductsCsv(csv, model, genericProductProfile.mapping, "replaceById");
    const merged = mergeProductsImport(model, imported.records, "replaceById");
    expect(merged.products[0]?.name).toBe("Revised product");
    expect(capacityModelSchema.safeParse(merged).success).toBe(true);
  });
});

describe("calendar importer contract", () => {
  it("fails fast when the weekly schedule shape is incomplete", () => {
    expect(() => importCalendarsCsv("calendarId,calendarName,timezone,monMinutes\ncal,Calendar,UTC,480", undefined, model, genericCalendarProfile.mapping, undefined)).toThrow(/tueMinutes/);
  });

  it("rejects invalid exceptions without contaminating accepted calendars", () => {
    const csv = ["calendarId,calendarName,timezone,monMinutes,tueMinutes,wedMinutes,thuMinutes,friMinutes,satMinutes,sunMinutes", "cal-new,New calendar,UTC,480,480,480,480,480,0,0"].join("\n");
    const exceptions = ["calendarId,exceptionDate,availableMinutes,reason", "cal-new,not-a-date,0,Bad date", "missing,2026-12-25,0,Unknown calendar", "cal-new,2026-12-26,1500,Bad minutes", "cal-new,2026-12-25,0,Holiday"].join("\n");
    const result = importCalendarsCsv(csv, exceptions, model, genericCalendarProfile.mapping, genericCalendarExceptionProfile.mapping);
    expect(result.records[0]?.exceptions).toEqual([{ date: "2026-12-25", availableMinutes: 0, reason: "Holiday" }]);
    expect(result.controlTotals).toMatchObject({ calendarCount: 1, exceptionCount: 1, earliestExceptionDate: "2026-12-25", latestExceptionDate: "2026-12-25" });
    expect(codes(result)).toEqual(expect.arrayContaining(["EXCEPTION_DATE_INVALID", "EXCEPTION_CALENDAR_NOT_FOUND", "EXCEPTION_MINUTES_INVALID"]));
    expect(capacityModelSchema.safeParse(mergeCalendarsImport(model, result.records)).success).toBe(true);
  });
});

describe("resource-group importer contract", () => {
  it("rejects invalid foreign keys, kinds, units, and pooled values by row", () => {
    const csv = ["resourceGroupId,resourceGroupName,resourceKind,capacityUnit,calendarId,organizationNodeId,pooled,tags", "rg-good,Good equipment,equipment,hours,cal-base,site,true,critical", "rg-calendar,Bad calendar,equipment,hours,missing,site,true,", "rg-kind,Bad kind,machine,hours,cal-base,site,true,", "rg-unit,Bad unit,labor,people,cal-base,site,true,", "rg-pooled,Bad pooled,labor,hours,cal-base,site,sometimes,"].join("\n");
    const result = importResourceGroupsCsv(csv, model, genericResourceGroupProfile.mapping);
    expect(result.records.map(item => item.id)).toEqual(["rg-good"]);
    expect(result.controlTotals).toMatchObject({ inputRows: 5, acceptedRows: 1, rejectedRows: 4, totalResourceGroups: 1 });
    expect(codes(result)).toEqual(expect.arrayContaining(["CALENDAR_UNKNOWN", "RESOURCE_KIND_INVALID", "CAPACITY_UNIT_INVALID", "POOLED_INVALID"]));
    expect(capacityModelSchema.safeParse(mergeResourceGroupsImport(model, result.records)).success).toBe(true);
  });
});

describe("resource importer contract", () => {
  it("rejects bad references, factors, rates, quantities, and effective ranges while preserving a valid sibling", () => {
    const csv = ["resourceId,resourceName,resourceGroupId,calendarId,quantity,ratePerAvailableHour,availability,performance,quality,effectiveFrom,effectiveTo", "res-good,Good resource,rg-base,cal-base,2,1,0.9,0.95,0.99,2026-01-01,2027-12-31", "res-group,Bad group,missing,cal-base,1,1,1,1,1,,", "res-calendar,Bad calendar,rg-base,wrong,1,1,1,1,1,,", "res-qty,Bad quantity,rg-base,cal-base,0,1,1,1,1,,", "res-rate,Bad rate,rg-base,cal-base,1,0,1,1,1,,", "res-factor,Bad factor,rg-base,cal-base,1,1,90,1,1,,", "res-range,Bad range,rg-base,cal-base,1,1,1,1,1,2027-01-01,2026-01-01"].join("\n");
    const result = importResourcesCsv(csv, model, genericResourceProfile.mapping);
    expect(result.records.map(item => item.id)).toEqual(["res-good"]);
    expect(result.controlTotals).toMatchObject({ inputRows: 7, acceptedRows: 1, rejectedRows: 6, totalResources: 1, totalQuantity: 2 });
    expect(codes(result)).toEqual(expect.arrayContaining(["RESOURCE_GROUP_UNKNOWN", "CALENDAR_UNKNOWN", "QUANTITY_INVALID", "RATE_INVALID", "FACTOR_OUT_OF_RANGE", "EFFECTIVE_RANGE_INVALID"]));
    expect(capacityModelSchema.safeParse(mergeResourcesImport(model, result.records)).success).toBe(true);
  });

  it("rejects append collisions explicitly", () => {
    const csv = ["resourceId,resourceName,resourceGroupId,calendarId,quantity,ratePerAvailableHour,availability,performance,quality,effectiveFrom,effectiveTo", "res-base,Duplicate,rg-base,cal-base,1,1,1,1,1,,"].join("\n");
    expect(() => importResourcesCsv(csv, model, genericResourceProfile.mapping, "append")).toThrow(/already exists/);
  });
});

describe("routing importer hierarchy", () => {
  it("rejects revision-level failures as a whole", () => {
    const csv = [routingHeader, "missing,A,A,2026-01-01,2026-12-31,p,Phase,4,0,spread,o,Operation,10,rg-base,value,1,,,,1", "product-base,B,B,bad-date,2026-12-31,p,Phase,4,0,spread,o,Operation,10,rg-base,value,1,,,,1"].join("\n");
    const result = importRoutingCsv(csv, model, genericRoutingProfile.mapping);
    expect(result.records).toHaveLength(0);
    expect(result.controlTotals).toMatchObject({ acceptedRevisionCount: 0, rejectedRevisionCount: 2 });
    expect(codes(result)).toEqual(expect.arrayContaining(["PRODUCT_UNKNOWN", "REVISION_EFFECTIVE_DATE_INVALID"]));
  });

  it("rejects one malformed phase while preserving a valid sibling", () => {
    const csv = [routingHeader, "product-base,A,A,2026-01-01,2026-12-31,good,Good phase,8,4,spread,op10,Good operation,10,rg-base,value,2,,,,1", "product-base,A,A,2026-01-01,2026-12-31,bad,Bad phase,2,6,invalid,op20,Bad operation,20,rg-base,value,2,,,,1"].join("\n");
    const result = importRoutingCsv(csv, model, genericRoutingProfile.mapping);
    expect(result.records[0]?.phases.map(item => item.name)).toEqual(["Good phase"]);
    expect(result.records[0]?.operations.map(item => item.name)).toEqual(["Good operation"]);
    expect(result.controlTotals).toMatchObject({ acceptedRevisionCount: 1, acceptedPhaseCount: 1, rejectedPhaseCount: 1, acceptedOperationCount: 1, rejectedOperationCount: 1 });
    expect(codes(result)).toEqual(expect.arrayContaining(["PHASE_RANGE_INVALID", "PHASE_ALLOCATION_INVALID"]));
    expect(capacityModelSchema.safeParse(mergeRoutingImport(model, result.records)).success).toBe(true);
  });

  it("rejects a malformed requirement at operation level without dropping a valid sibling operation", () => {
    const csv = [routingHeader, "product-base,A,A,2026-01-01,2026-12-31,p,Phase,4,0,spread,op10,Good operation,10,rg-base,value,1,,,,1", "product-base,A,A,2026-01-01,2026-12-31,p,Phase,4,0,spread,op20,Bad requirement,20,rg-base,missing,3,,,,1"].join("\n");
    const result = importRoutingCsv(csv, model, genericRoutingProfile.mapping);
    expect(result.records[0]?.operations.map(item => item.name)).toEqual(["Good operation"]);
    expect(result.controlTotals).toMatchObject({ acceptedOperationCount: 1, rejectedOperationCount: 1, acceptedRequirementCount: 1, rejectedRequirementCount: 1 });
    expect(codes(result)).toContain("REQUIREMENT_VALUE_INVALID");
  });
});
