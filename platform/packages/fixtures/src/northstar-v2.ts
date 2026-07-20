import type {
  CapacityModel,
  LeadTimePhase,
  RoutingOperation,
  RoutingRequirement,
} from "@capacity/domain";

const source = "Northstar synthetic demonstration v2";
const productiveHoursRate = 1800 / 2080;
const laborAvailability = 0.84;

function hours(id: string, resourceGroupId: string, value: number): RoutingRequirement {
  return {
    id,
    resourceGroupId,
    requirement: {
      state: "value",
      value,
      unit: "hours",
      source,
      confidence: "high",
    },
  };
}

function withRework(value: number, percent: number): number {
  return value * (1 + percent / 100);
}

function operation(
  id: string,
  sequence: number,
  name: string,
  phaseId: string,
  requirements: RoutingRequirement[],
): RoutingOperation {
  return { id, sequence, name, phaseId, requirements };
}

const hx100Phases: LeadTimePhase[] = [
  { id: "hx100-configure", name: "Applications / Configure", startWeeksBeforeShip: 20, endWeeksBeforeShip: 17, allocation: "spread" },
  { id: "hx100-detail", name: "Detailed Engineering", startWeeksBeforeShip: 17, endWeeksBeforeShip: 12, allocation: "spread" },
  { id: "hx100-plate", name: "Plate Preparation", startWeeksBeforeShip: 12, endWeeksBeforeShip: 9, allocation: "spread" },
  { id: "hx100-weld", name: "Welding", startWeeksBeforeShip: 9, endWeeksBeforeShip: 5, allocation: "spread" },
  { id: "hx100-assembly", name: "Assembly", startWeeksBeforeShip: 4, endWeeksBeforeShip: 2, allocation: "spread" },
  { id: "hx100-test", name: "Final Test & Ship Prep", startWeeksBeforeShip: 2, endWeeksBeforeShip: 0, allocation: "spread" },
];

const hx200Phases: LeadTimePhase[] = [
  { id: "hx200-configure", name: "Applications / Configure", startWeeksBeforeShip: 36, endWeeksBeforeShip: 32, allocation: "spread" },
  { id: "hx200-detail", name: "Detailed Engineering", startWeeksBeforeShip: 32, endWeeksBeforeShip: 22, allocation: "spread" },
  { id: "hx200-plate", name: "Plate Preparation", startWeeksBeforeShip: 22, endWeeksBeforeShip: 17, allocation: "spread" },
  { id: "hx200-weld", name: "Welding", startWeeksBeforeShip: 17, endWeeksBeforeShip: 10, allocation: "spread" },
  { id: "hx200-heat", name: "Heat Treatment", startWeeksBeforeShip: 10, endWeeksBeforeShip: 7, allocation: "spread" },
  { id: "hx200-assembly", name: "Assembly", startWeeksBeforeShip: 7, endWeeksBeforeShip: 3, allocation: "spread" },
  { id: "hx200-test", name: "Final Test", startWeeksBeforeShip: 3, endWeeksBeforeShip: 1, allocation: "spread" },
  { id: "hx200-ship", name: "Ship Prep", startWeeksBeforeShip: 1, endWeeksBeforeShip: 0, allocation: "spread" },
];

const hx300Phases: LeadTimePhase[] = [
  { id: "hx300-configure", name: "Configuration", startWeeksBeforeShip: 14, endWeeksBeforeShip: 12, allocation: "spread" },
  { id: "hx300-detail", name: "Detail Release", startWeeksBeforeShip: 12, endWeeksBeforeShip: 8, allocation: "spread" },
  { id: "hx300-purchased", name: "Purchased Module Lead — Fabrication Bypass", startWeeksBeforeShip: 8, endWeeksBeforeShip: 6, allocation: "spread" },
  { id: "hx300-integration", name: "Integration Assembly", startWeeksBeforeShip: 6, endWeeksBeforeShip: 2, allocation: "spread" },
  { id: "hx300-test", name: "Final Test & Ship Prep", startWeeksBeforeShip: 2, endWeeksBeforeShip: 0, allocation: "spread" },
];

const servicePhases: LeadTimePhase[] = [
  { id: "serv-scope", name: "Scope & Quote", startWeeksBeforeShip: 8, endWeeksBeforeShip: 6, allocation: "spread" },
  { id: "serv-engineering", name: "Retrofit Engineering", startWeeksBeforeShip: 6, endWeeksBeforeShip: 4, allocation: "spread" },
  { id: "serv-kit", name: "Parts Kitting — Fabrication Bypass", startWeeksBeforeShip: 4, endWeeksBeforeShip: 2, allocation: "spread" },
  { id: "serv-assembly", name: "Shop Assembly", startWeeksBeforeShip: 2, endWeeksBeforeShip: 1, allocation: "spread" },
  { id: "serv-test", name: "Final Verification & Ship", startWeeksBeforeShip: 1, endWeeksBeforeShip: 0, allocation: "spread" },
];

const demandByProduct: Record<string, Record<number, number[]>> = {
  hx100: {
    2027: [50, 55, 60, 65, 70, 75, 80, 85, 90, 100, 120, 150],
    2028: [95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150],
    2029: [115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170],
  },
  hx200: {
    2027: [15, 15, 20, 20, 25, 30, 35, 40, 45, 50, 50, 55],
    2028: [35, 35, 40, 40, 45, 45, 50, 50, 55, 55, 60, 60],
    2029: [45, 45, 50, 50, 55, 55, 60, 60, 65, 65, 70, 70],
  },
  hx300: {
    2027: [0, 0, 10, 15, 20, 25, 30, 35, 40, 50, 60, 65],
    2028: [45, 45, 50, 50, 55, 55, 60, 60, 65, 65, 70, 70],
    2029: [55, 55, 60, 60, 65, 65, 70, 70, 75, 75, 80, 80],
  },
  service: {
    2027: Array(12).fill(20),
    2028: Array(12).fill(22),
    2029: Array(12).fill(24),
  },
};

const demand = Object.entries(demandByProduct).flatMap(([productId, years]) =>
  Object.entries(years).flatMap(([year, values]) => values.map((quantity, monthIndex) => ({
    id: `baseline-${productId}-${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    scenarioId: "baseline",
    productId,
    shipDate: `${year}-${String(monthIndex + 1).padStart(2, "0")}-15`,
    quantity,
    demandClass: "forecast" as const,
    customerOrProgram: "Harbor Works launch",
    sourceSystem: "synthetic-v2",
  }))),
);

export const northstarV2Model: CapacityModel = {
  schemaVersion: "1.0.0",
  modelId: "northstar-v2",
  name: "Northstar Thermal Systems — Harbor Works",
  planningGranularity: "month",
  horizonStart: "2026-01-01",
  horizonEnd: "2029-12-31",
  organization: [
    { id: "northstar", name: "Northstar Thermal Systems", type: "enterprise" },
    { id: "harbor-works", name: "Harbor Works", type: "site", parentId: "northstar" },
    { id: "engineering", name: "Engineering", type: "area", parentId: "harbor-works" },
    { id: "fabrication", name: "Fabrication", type: "area", parentId: "harbor-works" },
    { id: "integration", name: "Integration & Verification", type: "area", parentId: "harbor-works" },
  ],
  calendars: [
    {
      id: "harbor-standard",
      name: "Harbor Works standard calendar",
      timezone: "America/New_York",
      weeklyMinutes: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 },
      exceptions: [
        { date: "2026-07-03", availableMinutes: 0, reason: "Independence Day shutdown" },
        { date: "2026-11-26", availableMinutes: 0, reason: "Thanksgiving shutdown" },
        { date: "2026-12-24", availableMinutes: 0, reason: "Winter shutdown" },
        { date: "2026-12-25", availableMinutes: 0, reason: "Winter shutdown" },
        { date: "2027-07-05", availableMinutes: 0, reason: "Independence Day shutdown" },
        { date: "2027-11-25", availableMinutes: 0, reason: "Thanksgiving shutdown" },
        { date: "2027-12-24", availableMinutes: 0, reason: "Winter shutdown" },
        { date: "2028-07-04", availableMinutes: 0, reason: "Independence Day shutdown" },
        { date: "2028-11-23", availableMinutes: 0, reason: "Thanksgiving shutdown" },
        { date: "2028-12-25", availableMinutes: 0, reason: "Winter shutdown" },
        { date: "2029-07-04", availableMinutes: 0, reason: "Independence Day shutdown" },
        { date: "2029-11-22", availableMinutes: 0, reason: "Thanksgiving shutdown" },
        { date: "2029-12-24", availableMinutes: 0, reason: "Winter shutdown" },
        { date: "2029-12-25", availableMinutes: 0, reason: "Winter shutdown" },
      ],
    },
  ],
  resourceGroups: [
    { id: "rg-app", name: "Applications Engineering", organizationNodeId: "engineering", kind: "labor", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-detail", name: "Detailed Engineering", organizationNodeId: "engineering", kind: "labor", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-plate", name: "Plate Preparation", organizationNodeId: "fabrication", kind: "labor", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-weld", name: "Qualified Welding Labor", organizationNodeId: "fabrication", kind: "skill", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-heat", name: "Heat Treatment Labor", organizationNodeId: "fabrication", kind: "labor", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-assembly", name: "Assembly Labor", organizationNodeId: "integration", kind: "labor", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-test", name: "Final Test Labor", organizationNodeId: "integration", kind: "skill", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-warehouse", name: "Warehouse Labor", organizationNodeId: "integration", kind: "labor", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-positioner", name: "Welding Positioners", organizationNodeId: "fabrication", kind: "equipment", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-oven", name: "Heat-Treat Oven Slots", organizationNodeId: "fabrication", kind: "equipment", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-mod-fixture", name: "Modular Integration Fixtures", organizationNodeId: "integration", kind: "tooling", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
    { id: "rg-test-stand", name: "Hydrostatic Test Bays", organizationNodeId: "integration", kind: "equipment", capacityUnit: "hours", calendarId: "harbor-standard", pooled: true },
  ],
  resources: [
    { id: "res-app", resourceGroupId: "rg-app", name: "Applications FTE pool", quantity: 6, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-detail", resourceGroupId: "rg-detail", name: "Detailed engineering FTE pool", quantity: 10, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-plate", resourceGroupId: "rg-plate", name: "Plate preparation FTE pool", quantity: 12, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-weld", resourceGroupId: "rg-weld", name: "Qualified welder pool", quantity: 20, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-heat", resourceGroupId: "rg-heat", name: "Heat treatment FTE pool", quantity: 8, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-assembly", resourceGroupId: "rg-assembly", name: "Assembly FTE pool", quantity: 19, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-test", resourceGroupId: "rg-test", name: "Test technician pool", quantity: 14, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-warehouse", resourceGroupId: "rg-warehouse", name: "Warehouse FTE pool", quantity: 8, ratePerAvailableHour: productiveHoursRate, availability: laborAvailability, performance: 1, quality: 1 },
    { id: "res-positioner", resourceGroupId: "rg-positioner", name: "Installed welding positioners", quantity: 6, ratePerAvailableHour: 2000 / 2080, availability: 0.8, performance: 1, quality: 1 },
    { id: "res-oven", resourceGroupId: "rg-oven", name: "Heat-treat oven slots", quantity: 4, ratePerAvailableHour: 2000 / 2080, availability: 0.82, performance: 1, quality: 1 },
    { id: "res-mod-fixture", resourceGroupId: "rg-mod-fixture", name: "Modular integration fixtures", quantity: 4, ratePerAvailableHour: 1800 / 2080, availability: 0.85, performance: 1, quality: 1 },
    { id: "res-test-stand", resourceGroupId: "rg-test-stand", name: "Hydrostatic test bays", quantity: 5, ratePerAvailableHour: 1900 / 2080, availability: 0.78, performance: 1, quality: 1 },
  ],
  products: [
    { id: "hx100", name: "HX-100 Standard", family: "Industrial Heat Exchangers", organizationNodeId: "harbor-works", tags: ["medium-risk"] },
    { id: "hx200", name: "HX-200 High Pressure", family: "Industrial Heat Exchangers", organizationNodeId: "harbor-works", tags: ["high-risk", "heat-treatment"] },
    { id: "hx300", name: "HX-300 Modular", family: "Industrial Heat Exchangers", organizationNodeId: "harbor-works", tags: ["critical-risk", "fabrication-bypass"] },
    { id: "service", name: "Service & Retrofit", family: "Aftermarket", organizationNodeId: "harbor-works", tags: ["fabrication-bypass"] },
  ],
  routingRevisions: [
    {
      id: "route-hx100-a",
      productId: "hx100",
      revision: "A",
      effectiveFrom: "2026-01-01",
      phases: hx100Phases,
      operations: [
        operation("hx100-app", 10, "Applications engineering", "hx100-configure", [hours("hx100-app-labor", "rg-app", withRework(1.5 * 0.65, 1))]),
        operation("hx100-detail", 20, "Detailed engineering", "hx100-detail", [hours("hx100-detail-labor", "rg-detail", withRework(5 * 0.35, 1))]),
        operation("hx100-plate", 30, "Plate preparation", "hx100-plate", [hours("hx100-plate-labor", "rg-plate", withRework(3, 3))]),
        operation("hx100-weld", 40, "Welding", "hx100-weld", [hours("hx100-weld-labor", "rg-weld", withRework(15, 3)), hours("hx100-positioner", "rg-positioner", withRework(5, 3))]),
        operation("hx100-assembly", 50, "Assembly", "hx100-assembly", [hours("hx100-assembly-labor", "rg-assembly", withRework(7, 3))]),
        operation("hx100-test", 60, "Final test", "hx100-test", [hours("hx100-test-labor", "rg-test", withRework(4, 1)), hours("hx100-test-stand", "rg-test-stand", withRework(1.5, 1))]),
        operation("hx100-warehouse", 70, "Ship preparation", "hx100-test", [hours("hx100-warehouse-labor", "rg-warehouse", 0.5)]),
      ],
      sourceSystem: "synthetic-v2",
    },
    {
      id: "route-hx200-a",
      productId: "hx200",
      revision: "A",
      effectiveFrom: "2026-01-01",
      phases: hx200Phases,
      operations: [
        operation("hx200-app", 10, "Applications engineering", "hx200-configure", [hours("hx200-app-labor", "rg-app", withRework(4, 1))]),
        operation("hx200-detail", 20, "Detailed engineering", "hx200-detail", [hours("hx200-detail-labor", "rg-detail", withRework(14, 1))]),
        operation("hx200-plate", 30, "Plate preparation", "hx200-plate", [hours("hx200-plate-labor", "rg-plate", withRework(6, 3))]),
        operation("hx200-weld", 40, "High-pressure welding", "hx200-weld", [hours("hx200-weld-labor", "rg-weld", withRework(24, 3)), hours("hx200-positioner", "rg-positioner", withRework(8, 3))]),
        operation("hx200-heat", 50, "Heat treatment", "hx200-heat", [hours("hx200-heat-labor", "rg-heat", withRework(8, 1)), hours("hx200-oven", "rg-oven", withRework(2.4, 1))]),
        operation("hx200-assembly", 60, "Assembly", "hx200-assembly", [hours("hx200-assembly-labor", "rg-assembly", withRework(12, 3))]),
        operation("hx200-test", 70, "Final test", "hx200-test", [hours("hx200-test-labor", "rg-test", withRework(8, 1)), hours("hx200-test-stand", "rg-test-stand", withRework(3.5, 1))]),
        operation("hx200-warehouse", 80, "Ship preparation", "hx200-ship", [hours("hx200-warehouse-labor", "rg-warehouse", 1)]),
      ],
      sourceSystem: "synthetic-v2",
    },
    {
      id: "route-hx300-a",
      productId: "hx300",
      revision: "A",
      effectiveFrom: "2026-01-01",
      phases: hx300Phases,
      operations: [
        operation("hx300-app", 10, "Configuration", "hx300-configure", [hours("hx300-app-labor", "rg-app", withRework(0.75 * 0.5, 1))]),
        operation("hx300-detail", 20, "Detail release", "hx300-detail", [hours("hx300-detail-labor", "rg-detail", withRework(3 * 0.25, 1))]),
        operation("hx300-module", 30, "Purchased module coordination", "hx300-purchased", [hours("hx300-warehouse-labor", "rg-warehouse", 0.4)]),
        operation("hx300-integration", 40, "Integration assembly", "hx300-integration", [hours("hx300-assembly-labor", "rg-assembly", withRework(14, 3)), hours("hx300-fixture", "rg-mod-fixture", withRework(4, 3))]),
        operation("hx300-test", 50, "Final test", "hx300-test", [hours("hx300-test-labor", "rg-test", withRework(10, 1)), hours("hx300-test-stand", "rg-test-stand", withRework(2.8, 1))]),
        operation("hx300-warehouse", 60, "Ship preparation", "hx300-test", [hours("hx300-warehouse-ship", "rg-warehouse", 0.4)]),
      ],
      sourceSystem: "synthetic-v2",
    },
    {
      id: "route-service-a",
      productId: "service",
      revision: "A",
      effectiveFrom: "2026-01-01",
      phases: servicePhases,
      operations: [
        operation("serv-app", 10, "Scope and quote", "serv-scope", [hours("serv-app-labor", "rg-app", withRework(1 * 0.8, 1))]),
        operation("serv-detail", 20, "Retrofit engineering", "serv-engineering", [hours("serv-detail-labor", "rg-detail", withRework(2 * 0.6, 1))]),
        operation("serv-kit", 30, "Parts kitting", "serv-kit", [hours("serv-warehouse-kit", "rg-warehouse", 0.3)]),
        operation("serv-assembly", 40, "Shop assembly", "serv-assembly", [hours("serv-assembly-labor", "rg-assembly", withRework(3, 3))]),
        operation("serv-test", 50, "Final verification", "serv-test", [hours("serv-test-labor", "rg-test", withRework(2, 1)), hours("serv-test-stand", "rg-test-stand", withRework(0.8, 1))]),
      ],
      sourceSystem: "synthetic-v2",
    },
  ],
  scenarios: [
    {
      id: "baseline",
      name: "2027–2029 launch baseline",
      kind: "baseline",
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "synthetic-fixture",
      assumptions: {
        "zero-routing-values": "translated as absent sparse operations",
        "demand-basis": "monthly 2027–2029 synthetic forecast",
        "capacity-basis": "v6.86 nominal hours, loss factors, rework, and equipment OEE translated to calendar capacity",
      },
    },
  ],
  demand,
  metadata: {
    synthetic: true,
    sourceVersion: "Capacity Workbook v6.86 / Northstar v2",
    purpose: "Golden regression and demonstration fixture",
  },
};
