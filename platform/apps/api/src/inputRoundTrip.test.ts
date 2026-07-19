import { describe, expect, it } from "vitest";
import type { CapacityModel, RoutingRevision } from "@capacity/domain";
import { northstarV2Model } from "@capacity/fixtures";
import {
  exportCalendarExceptionsCsv,
  exportCalendarsCsv,
  exportDemandCsv,
  exportProductsCsv,
  exportResourceGroupsCsv,
  exportResourcesCsv,
  exportRoutingCsv,
  genericCalendarExceptionProfile,
  genericCalendarProfile,
  genericDemandProfile,
  genericProductProfile,
  genericResourceGroupProfile,
  genericResourceProfile,
  genericRoutingProfile,
  importCalendarsCsv,
  importDemandCsv,
  importProductsCsv,
  importResourceGroupsCsv,
  importResourcesCsv,
  importRoutingCsv,
  mergeCalendarsImport,
  mergeDemandImport,
  mergeProductsImport,
  mergeResourceGroupsImport,
  mergeResourcesImport,
  mergeRoutingImport,
} from "@capacity/importer";

function blankAssessment(source: CapacityModel): CapacityModel {
  return {
    ...source,
    calendars: [],
    resourceGroups: [],
    resources: [],
    products: [],
    routingRevisions: [],
    demand: [],
  };
}

function routingSignature(revision: RoutingRevision) {
  return {
    productId: revision.productId,
    revision: revision.revision,
    effectiveFrom: revision.effectiveFrom,
    effectiveTo: revision.effectiveTo ?? null,
    phases: revision.phases.map(phase => ({
      name: phase.name,
      startWeeksBeforeShip: phase.startWeeksBeforeShip,
      endWeeksBeforeShip: phase.endWeeksBeforeShip,
      allocation: phase.allocation,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    operations: revision.operations.map(operation => ({
      sequence: operation.sequence,
      name: operation.name,
      phaseName: revision.phases.find(phase => phase.id === operation.phaseId)?.name,
      requirements: operation.requirements.map(requirement => ({
        resourceGroupId: requirement.resourceGroupId,
        state: requirement.requirement.state,
        value: requirement.requirement.value ?? null,
        unit: requirement.requirement.unit,
        setupState: requirement.setupRequirement?.state ?? null,
        setupValue: requirement.setupRequirement?.value ?? null,
        setupQuantity: requirement.setupQuantity ?? null,
        batchSize: requirement.batchSize ?? null,
      })).sort((a, b) => a.resourceGroupId.localeCompare(b.resourceGroupId)),
    })).sort((a, b) => a.sequence - b.sequence),
  };
}

describe("Northstar input-layer round trip", () => {
  it("reconstructs calendars, resource groups, resources, products, routing, and demand", () => {
    let model = blankAssessment(northstarV2Model);

    const calendars = importCalendarsCsv(
      exportCalendarsCsv(northstarV2Model),
      exportCalendarExceptionsCsv(northstarV2Model),
      model,
      genericCalendarProfile.mapping,
      genericCalendarExceptionProfile.mapping,
    );
    expect(calendars.issues.filter(issue => issue.severity === "error")).toEqual([]);
    model = mergeCalendarsImport(model, calendars.records);

    const groups = importResourceGroupsCsv(exportResourceGroupsCsv(northstarV2Model), model, genericResourceGroupProfile.mapping);
    expect(groups.issues.filter(issue => issue.severity === "error")).toEqual([]);
    model = mergeResourceGroupsImport(model, groups.records);

    const resources = importResourcesCsv(exportResourcesCsv(northstarV2Model), model, genericResourceProfile.mapping);
    expect(resources.issues.filter(issue => issue.severity === "error")).toEqual([]);
    model = mergeResourcesImport(model, resources.records);

    const products = importProductsCsv(exportProductsCsv(northstarV2Model), model, genericProductProfile.mapping);
    expect(products.issues.filter(issue => issue.severity === "error")).toEqual([]);
    model = mergeProductsImport(model, products.records);

    const routing = importRoutingCsv(exportRoutingCsv(northstarV2Model), model, genericRoutingProfile.mapping);
    expect(routing.issues.filter(issue => issue.severity === "error")).toEqual([]);
    model = mergeRoutingImport(model, routing.records);

    const demand = importDemandCsv(exportDemandCsv(northstarV2Model, "baseline"), model.products, "baseline", genericDemandProfile.mapping);
    expect(demand.issues.filter(issue => issue.severity === "error")).toEqual([]);
    model = mergeDemandImport(model, "baseline", demand.records);

    expect(model.calendars).toEqual(northstarV2Model.calendars);
    expect(model.resourceGroups).toEqual(northstarV2Model.resourceGroups);
    expect(model.resources).toEqual(northstarV2Model.resources);
    expect(model.products.map(product => ({ id: product.id, name: product.name, family: product.family, organizationNodeId: product.organizationNodeId })))
      .toEqual(northstarV2Model.products.map(product => ({ id: product.id, name: product.name, family: product.family, organizationNodeId: product.organizationNodeId })));
    expect(model.routingRevisions.map(routingSignature).sort((a, b) => a.productId.localeCompare(b.productId)))
      .toEqual(northstarV2Model.routingRevisions.map(routingSignature).sort((a, b) => a.productId.localeCompare(b.productId)));
    expect(model.demand.map(record => ({ productId: record.productId, shipDate: record.shipDate, quantity: record.quantity, demandClass: record.demandClass, customerOrProgram: record.customerOrProgram })))
      .toEqual(northstarV2Model.demand.map(record => ({ productId: record.productId, shipDate: record.shipDate, quantity: record.quantity, demandClass: record.demandClass, customerOrProgram: record.customerOrProgram })));
  });
});
