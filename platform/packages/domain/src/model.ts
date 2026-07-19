export type Id = string;
export type IsoDate = string;

export type PlanningGranularity = "week" | "month";
export type ResourceKind =
  | "labor"
  | "equipment"
  | "skill"
  | "tooling"
  | "space"
  | "external"
  | "other";
export type CapacityUnit =
  | "hours"
  | "units"
  | "squareFeet"
  | "palletPositions"
  | "custom";
export type ApplicabilityState = "notApplicable" | "missing" | "zero" | "value";
export type PhaseAllocation =
  | "spread"
  | "shiftToStart"
  | "shiftToEnd"
  | "shiftToMidpoint";

export interface OrganizationNode {
  id: Id;
  name: string;
  type: "enterprise" | "businessUnit" | "site" | "area" | "workCenter";
  parentId?: Id;
  externalKeys?: Record<string, string>;
}

export interface CalendarException {
  date: IsoDate;
  availableMinutes: number;
  reason?: string;
}

export interface WorkingCalendar {
  id: Id;
  name: string;
  timezone: string;
  weeklyMinutes: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number>>;
  exceptions: CalendarException[];
}

export interface ResourceGroup {
  id: Id;
  name: string;
  organizationNodeId: Id;
  kind: ResourceKind;
  capacityUnit: CapacityUnit;
  calendarId: Id;
  pooled: boolean;
  tags?: string[];
  externalKeys?: Record<string, string>;
}

export interface Resource {
  id: Id;
  resourceGroupId: Id;
  name: string;
  quantity: number;
  ratePerAvailableHour: number;
  availability: number;
  performance: number;
  quality: number;
  effectiveFrom?: IsoDate;
  effectiveTo?: IsoDate;
  externalKeys?: Record<string, string>;
}

export interface Product {
  id: Id;
  name: string;
  family?: string;
  organizationNodeId: Id;
  externalKeys?: Record<string, string>;
  tags?: string[];
}

export interface LeadTimePhase {
  id: Id;
  name: string;
  startWeeksBeforeShip: number;
  endWeeksBeforeShip: number;
  allocation: PhaseAllocation;
}

export interface RequirementValue {
  state: ApplicabilityState;
  value?: number;
  unit: CapacityUnit;
  source?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
}

export interface RoutingRequirement {
  id: Id;
  resourceGroupId: Id;
  requirement: RequirementValue;
  setupQuantity?: number;
  setupRequirement?: RequirementValue;
  batchSize?: number;
}

export interface RoutingOperation {
  id: Id;
  sequence: number;
  name: string;
  phaseId: Id;
  requirements: RoutingRequirement[];
  alternateGroup?: string;
  minimumBatchSize?: number;
  maximumBatchSize?: number;
}

export interface RoutingRevision {
  id: Id;
  productId: Id;
  revision: string;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate;
  phases: LeadTimePhase[];
  operations: RoutingOperation[];
  sourceSystem?: string;
  sourceRevision?: string;
}

export interface DemandRecord {
  id: Id;
  scenarioId: Id;
  productId: Id;
  shipDate: IsoDate;
  quantity: number;
  demandClass?: "firm" | "forecast" | "upside" | "downside";
  customerOrProgram?: string;
  sourceSystem?: string;
  sourceRecordId?: string;
}

export type ActionLogCategory = "data" | "assumption" | "risk" | "decision" | "followUp" | "general";

export interface ActionLogEntry {
  id: Id;
  createdAt: string;
  createdBy?: string;
  category: ActionLogCategory;
  note: string;
  relatedEntityType?: string;
  relatedEntityId?: Id;
  owner?: string;
  dueDate?: IsoDate;
  resolvedAt?: string;
}

export type PlanningWipBasis = "estimated" | "reported" | "derived";

export interface PlanningWipRecord {
  id: Id;
  scenarioId: Id;
  productId: Id;
  periodStart: IsoDate;
  quantity: number;
  basis: PlanningWipBasis;
  sourceSystem?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
  notes?: string;
}

export interface FootprintPlan {
  id: Id;
  departmentOrArea: string;
  organizationNodeId?: Id;
  calendarId?: Id;
  productId?: Id;
  productFamily?: string;
  dwellWorkingDays: number;
  spacePerUnit: number;
  basis: "squareFeet" | "palletPositions" | "custom";
  availableCapacity: number;
  peakFactor: number;
  source?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
  notes?: string;
}

export interface Scenario {
  id: Id;
  name: string;
  kind: "baseline" | "recovery" | "sensitivity";
  parentScenarioId?: Id;
  createdAt: string;
  createdBy?: string;
  assumptions?: Record<string, string | number | boolean>;
}

export type ScenarioActionStatus = "proposed" | "approved" | "implemented" | "rejected";
export type ScenarioActionConfidence = "high" | "medium" | "low" | "unknown";

export interface ScenarioActionBase {
  id: Id;
  scenarioId: Id;
  name: string;
  kind: "resourceQuantityDelta" | "resourceCapacityMultiplier" | "demandMultiplier";
  included: boolean;
  status: ScenarioActionStatus;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate;
  owner?: string;
  rationale?: string;
  confidence?: ScenarioActionConfidence;
  source?: string;
}

export interface ResourceQuantityDeltaAction extends ScenarioActionBase {
  kind: "resourceQuantityDelta";
  resourceId: Id;
  quantityDelta: number;
}

export interface ResourceCapacityMultiplierAction extends ScenarioActionBase {
  kind: "resourceCapacityMultiplier";
  resourceGroupId: Id;
  multiplier: number;
}

export interface DemandMultiplierAction extends ScenarioActionBase {
  kind: "demandMultiplier";
  productId?: Id;
  multiplier: number;
}

export type ScenarioAction =
  | ResourceQuantityDeltaAction
  | ResourceCapacityMultiplierAction
  | DemandMultiplierAction;

export interface CapacityModel {
  schemaVersion: string;
  modelId: Id;
  name: string;
  planningGranularity: PlanningGranularity;
  horizonStart: IsoDate;
  horizonEnd: IsoDate;
  organization: OrganizationNode[];
  calendars: WorkingCalendar[];
  resourceGroups: ResourceGroup[];
  resources: Resource[];
  products: Product[];
  routingRevisions: RoutingRevision[];
  scenarios: Scenario[];
  demand: DemandRecord[];
  scenarioActions?: ScenarioAction[];
  actionLog?: ActionLogEntry[];
  footprintPlans?: FootprintPlan[];
  planningWip?: PlanningWipRecord[];
  metadata?: Record<string, string | number | boolean>;
}

export interface ResourcePeriodResult {
  scenarioId: Id;
  resourceGroupId: Id;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  load: number;
  capacity: number;
  gap: number;
  utilization: number | null;
}

export interface ModelIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  entityType?: string;
  entityId?: Id;
}

export interface CalculationResult {
  modelId: Id;
  scenarioId: Id;
  generatedAt: string;
  results: ResourcePeriodResult[];
  governingConstraint: ResourcePeriodResult | null;
  issues: ModelIssue[];
  demandSourceScenarioId?: Id;
  appliedActionIds?: Id[];
}

export interface ScenarioComparisonRow {
  resourceGroupId: Id;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  baseline: ResourcePeriodResult;
  comparison: ResourcePeriodResult;
  loadDelta: number;
  capacityDelta: number;
  gapDelta: number;
  utilizationDelta: number | null;
}

export interface ScenarioComparisonResult {
  modelId: Id;
  baselineScenarioId: Id;
  comparisonScenarioId: Id;
  generatedAt: string;
  baseline: CalculationResult;
  comparison: CalculationResult;
  rows: ScenarioComparisonRow[];
  resolvedGapPeriods: number;
  remainingGapPeriods: number;
  worsenedGapPeriods: number;
  appliedActionIds: Id[];
}
