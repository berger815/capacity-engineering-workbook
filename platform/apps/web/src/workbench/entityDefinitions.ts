import type { CapacityModel } from "@capacity/domain";
import {
  exportCalendarExceptionsCsv,
  exportCalendarsCsv,
  exportDemandCsv,
  exportProductsCsv,
  exportResourceGroupsCsv,
  exportResourcesCsv,
  exportRoutingCsv,
  genericCalendarProfile,
  genericDemandProfile,
  genericProductProfile,
  genericResourceGroupProfile,
  genericResourceProfile,
  genericRoutingProfile,
} from "@capacity/importer";
import type { InputEntity } from "../inputApi.js";

export type WorkbenchEntity =
  | "products"
  | "calendars"
  | "resource-groups"
  | "resources"
  | "routing"
  | "demand"
  | "footprint"
  | "actions";

export type WorkbenchScope = "all" | "core-data" | "footprint" | "actions";
export type WorkbenchExperience = "guided" | "expert";

export interface WorkbenchTarget {
  entity: WorkbenchEntity;
  recordId?: string;
  parentRecordId?: string;
  returnTo?: {
    step: "scope" | "data" | "readiness" | "analysis" | "capacity" | "footprint" | "recovery" | "actions" | "decision";
    label: string;
    view?: string;
    resourceGroupId?: string;
    periodStart?: string;
  };
}

export interface WorkbenchEntityDefinition {
  id: WorkbenchEntity;
  label: string;
  note: string;
  guidedLabel: string;
  guidedNote: string;
  count: (model: CapacityModel) => number;
  scopes: WorkbenchScope[];
  inputEntity?: InputEntity;
  dependencies?: InputEntity[];
  profile?: { id: string; label: string; mapping: Record<string, unknown> };
  exportCsv?: (model: CapacityModel, scenarioId: string) => string;
}

export interface EntityReadiness {
  ready: boolean;
  reason: string;
}

export const calculationEntities: WorkbenchEntity[] = ["products", "calendars", "resource-groups", "resources", "routing", "demand"];

export const workbenchEntities: WorkbenchEntityDefinition[] = [
  {
    id: "products",
    label: "Products",
    note: "Canonical product IDs, names, families, and aliases",
    guidedLabel: "Products",
    guidedNote: "Parts or product families included in this supplier assessment",
    count: model => model.products.length,
    scopes: ["all", "core-data"],
    inputEntity: "products",
    dependencies: [],
    profile: genericProductProfile as unknown as WorkbenchEntityDefinition["profile"],
    exportCsv: model => exportProductsCsv(model),
  },
  {
    id: "calendars",
    label: "Calendars",
    note: "Weekly availability and dated exceptions",
    guidedLabel: "Working time",
    guidedNote: "Shifts, scheduled minutes, shutdowns, holidays, and exceptions",
    count: model => model.calendars.length,
    scopes: ["all", "core-data"],
    inputEntity: "calendars",
    dependencies: [],
    profile: genericCalendarProfile as unknown as WorkbenchEntityDefinition["profile"],
    exportCsv: model => exportCalendarsCsv(model),
  },
  {
    id: "resource-groups",
    label: "Resource Groups",
    note: "Constraint class, capacity unit, calendar, and ownership",
    guidedLabel: "Work areas",
    guidedNote: "Departments, labor pools, machine groups, tooling, or space constraints",
    count: model => model.resourceGroups.length,
    scopes: ["all", "core-data"],
    inputEntity: "resource-groups",
    dependencies: ["calendars"],
    profile: genericResourceGroupProfile as unknown as WorkbenchEntityDefinition["profile"],
    exportCsv: model => exportResourceGroupsCsv(model),
  },
  {
    id: "resources",
    label: "Resources",
    note: "Effective quantity, conversion rate, and OEE factors",
    guidedLabel: "People & machines",
    guidedNote: "How many productive people or machines are available in each work area",
    count: model => model.resources.length,
    scopes: ["all", "core-data"],
    inputEntity: "resources",
    dependencies: ["calendars", "resource-groups"],
    profile: genericResourceProfile as unknown as WorkbenchEntityDefinition["profile"],
    exportCsv: model => exportResourcesCsv(model),
  },
  {
    id: "routing",
    label: "Routing",
    note: "Revisions, phases, operations, and sparse requirements",
    guidedLabel: "Hours per part",
    guidedNote: "Where each product is worked, how long it takes, and when the work occurs",
    count: model => model.routingRevisions.length,
    scopes: ["all", "core-data"],
    inputEntity: "routing",
    dependencies: ["products", "resource-groups"],
    profile: genericRoutingProfile as unknown as WorkbenchEntityDefinition["profile"],
    exportCsv: model => exportRoutingCsv({ ...model, routingRevisions: [] }),
  },
  {
    id: "demand",
    label: "Demand",
    note: "Product, ship date, quantity, and demand class",
    guidedLabel: "Demand",
    guidedNote: "What must ship, how many units, and when the customer needs them",
    count: model => model.demand.length,
    scopes: ["all", "core-data"],
    inputEntity: "demand",
    dependencies: ["products"],
    profile: genericDemandProfile as unknown as WorkbenchEntityDefinition["profile"],
    exportCsv: (model, scenarioId) => exportDemandCsv(model, scenarioId),
  },
  {
    id: "footprint",
    label: "Footprint / WIP",
    note: "Dwell, space per unit, available area, and planning WIP",
    guidedLabel: "Space & WIP",
    guidedNote: "Floor space, storage positions, dwell, and work waiting in the process",
    count: model => (model.footprintPlans?.length ?? 0) + (model.planningWip?.length ?? 0),
    scopes: ["all", "footprint"],
  },
  {
    id: "actions",
    label: "Action Log",
    note: "Data gaps, assumptions, risks, decisions, and follow-up",
    guidedLabel: "Assessment actions",
    guidedNote: "Open questions, risks, owners, decisions, and supplier follow-up",
    count: model => model.actionLog?.length ?? 0,
    scopes: ["all", "actions"],
  },
];

export function entityDefinition(entity: WorkbenchEntity): WorkbenchEntityDefinition {
  return workbenchEntities.find(item => item.id === entity) ?? workbenchEntities[0]!;
}

export function entityCopy(definition: WorkbenchEntityDefinition, experience: WorkbenchExperience): { label: string; note: string } {
  return experience === "guided"
    ? { label: definition.guidedLabel, note: definition.guidedNote }
    : { label: definition.label, note: definition.note };
}

export function entitiesForScope(scope: WorkbenchScope): WorkbenchEntityDefinition[] {
  return workbenchEntities.filter(item => item.scopes.includes(scope));
}

export function entityReadiness(model: CapacityModel, entity: WorkbenchEntity, scenarioId: string): EntityReadiness {
  switch (entity) {
    case "products":
      return model.products.length > 0 ? { ready: true, reason: `${model.products.length} product${model.products.length === 1 ? "" : "s"}` } : { ready: false, reason: "Add at least one product" };
    case "calendars": {
      const usable = model.calendars.filter(calendar => Object.values(calendar.weeklyMinutes).reduce((sum, value) => sum + (value ?? 0), 0) > 0).length;
      return usable > 0 ? { ready: true, reason: `${usable} working calendar${usable === 1 ? "" : "s"}` } : { ready: false, reason: "Add working time greater than zero" };
    }
    case "resource-groups":
      return model.resourceGroups.length > 0 ? { ready: true, reason: `${model.resourceGroups.length} work area${model.resourceGroups.length === 1 ? "" : "s"}` } : { ready: false, reason: "Add a work area or constraint" };
    case "resources": {
      const usable = model.resources.filter(resource => resource.quantity > 0 && resource.ratePerAvailableHour > 0).length;
      return usable > 0 ? { ready: true, reason: `${usable} capacity record${usable === 1 ? "" : "s"}` } : { ready: false, reason: "Add available people or machines" };
    }
    case "routing": {
      const usable = model.routingRevisions.filter(revision => revision.operations.some(operation => operation.requirements.some(requirement => requirement.requirement.state === "value" && (requirement.requirement.value ?? 0) > 0))).length;
      return usable > 0 ? { ready: true, reason: `${usable} usable route${usable === 1 ? "" : "s"}` } : { ready: false, reason: "Add at least one positive hours-per-part requirement" };
    }
    case "demand": {
      const usable = model.demand.filter(record => record.scenarioId === scenarioId && record.quantity > 0).length;
      return usable > 0 ? { ready: true, reason: `${usable} demand record${usable === 1 ? "" : "s"}` } : { ready: false, reason: "Add demand for the baseline scenario" };
    }
    case "footprint":
      return (model.footprintPlans?.length ?? 0) > 0 ? { ready: true, reason: "Footprint context entered" } : { ready: false, reason: "Optional planning context" };
    case "actions":
      return (model.actionLog?.length ?? 0) > 0 ? { ready: true, reason: "Assessment actions recorded" } : { ready: false, reason: "No actions recorded yet" };
  }
}

export function dependencyCount(model: CapacityModel, entity: InputEntity): number {
  const definition = workbenchEntities.find(item => item.inputEntity === entity);
  return definition?.count(model) ?? 0;
}

export function calendarExceptionsCsv(model: CapacityModel): string {
  return exportCalendarExceptionsCsv(model);
}
