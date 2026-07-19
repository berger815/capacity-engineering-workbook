import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ratio = z.number().min(0).max(1);

export const capacityUnitSchema = z.enum(["hours","units","squareFeet","palletPositions","custom"]);
export const applicabilityStateSchema = z.enum(["notApplicable","missing","zero","value"]);

export const requirementValueSchema = z.object({
  state: applicabilityStateSchema,
  value: z.number().nonnegative().optional(),
  unit: capacityUnitSchema,
  source: z.string().optional(),
  confidence: z.enum(["high","medium","low","unknown"]).optional(),
}).superRefine((value, ctx) => {
  if (value.state === "value" && value.value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "state=value requires a numeric value" });
  }
  if (value.state !== "value" && value.value !== undefined && value.value !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only state=value may carry a non-zero value" });
  }
});

const organizationNodeSchema = z.object({
  id, name: z.string().min(1),
  type: z.enum(["enterprise","businessUnit","site","area","workCenter"]),
  parentId: id.optional(),
  externalKeys: z.record(z.string()).optional(),
});

const workingCalendarSchema = z.object({
  id, name: z.string().min(1), timezone: z.string().min(1),
  weeklyMinutes: z.record(z.string(), z.number().nonnegative()),
  exceptions: z.array(z.object({ date: isoDate, availableMinutes: z.number().nonnegative(), reason: z.string().optional() })),
});

const resourceGroupSchema = z.object({
  id, name: z.string().min(1), organizationNodeId: id,
  kind: z.enum(["labor","equipment","skill","tooling","space","external","other"]),
  capacityUnit: capacityUnitSchema, calendarId: id, pooled: z.boolean(),
  tags: z.array(z.string()).optional(), externalKeys: z.record(z.string()).optional(),
});

const resourceSchema = z.object({
  id, resourceGroupId: id, name: z.string().min(1), quantity: z.number().positive(),
  ratePerAvailableHour: z.number().positive(), availability: ratio, performance: ratio, quality: ratio,
  effectiveFrom: isoDate.optional(), effectiveTo: isoDate.optional(), externalKeys: z.record(z.string()).optional(),
});

const productSchema = z.object({
  id, name: z.string().min(1), family: z.string().optional(), organizationNodeId: id,
  externalKeys: z.record(z.string()).optional(), tags: z.array(z.string()).optional(),
});

const leadTimePhaseSchema = z.object({
  id, name: z.string().min(1), startWeeksBeforeShip: z.number().nonnegative(), endWeeksBeforeShip: z.number().nonnegative(),
  allocation: z.enum(["spread","shiftToStart","shiftToEnd","shiftToMidpoint"]),
}).refine(v => v.startWeeksBeforeShip >= v.endWeeksBeforeShip, { message: "startWeeksBeforeShip must be >= endWeeksBeforeShip" });

const routingRequirementSchema = z.object({
  id, resourceGroupId: id, requirement: requirementValueSchema,
  setupQuantity: z.number().nonnegative().optional(), setupRequirement: requirementValueSchema.optional(), batchSize: z.number().positive().optional(),
});

const routingOperationSchema = z.object({
  id, sequence: z.number().int().nonnegative(), name: z.string().min(1), phaseId: id,
  requirements: z.array(routingRequirementSchema), alternateGroup: z.string().optional(),
  minimumBatchSize: z.number().positive().optional(), maximumBatchSize: z.number().positive().optional(),
});

const routingRevisionSchema = z.object({
  id, productId: id, revision: z.string().min(1), effectiveFrom: isoDate, effectiveTo: isoDate.optional(),
  phases: z.array(leadTimePhaseSchema).min(1), operations: z.array(routingOperationSchema).min(1),
  sourceSystem: z.string().optional(), sourceRevision: z.string().optional(),
});

const scenarioSchema = z.object({
  id, name: z.string().min(1), kind: z.enum(["baseline","recovery","sensitivity"]),
  parentScenarioId: id.optional(), createdAt: z.string().datetime(), createdBy: z.string().optional(),
  assumptions: z.record(z.union([z.string(),z.number(),z.boolean()])).optional(),
});

const demandRecordSchema = z.object({
  id, scenarioId: id, productId: id, shipDate: isoDate, quantity: z.number().nonnegative(),
  demandClass: z.enum(["firm","forecast","upside","downside"]).optional(),
  customerOrProgram: z.string().optional(), sourceSystem: z.string().optional(), sourceRecordId: z.string().optional(),
});

export const capacityModelSchema = z.object({
  schemaVersion: z.string().min(1), modelId: id, name: z.string().min(1), planningGranularity: z.enum(["week","month"]),
  horizonStart: isoDate, horizonEnd: isoDate,
  organization: z.array(organizationNodeSchema).min(1), calendars: z.array(workingCalendarSchema).min(1),
  resourceGroups: z.array(resourceGroupSchema).min(1), resources: z.array(resourceSchema),
  products: z.array(productSchema).min(1), routingRevisions: z.array(routingRevisionSchema),
  scenarios: z.array(scenarioSchema).min(1), demand: z.array(demandRecordSchema),
  metadata: z.record(z.union([z.string(),z.number(),z.boolean()])).optional(),
}).superRefine((model, ctx) => {
  const unique = (values: string[], path: (string | number)[]) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate ids", path });
  };
  unique(model.organization.map(x=>x.id), ["organization"]);
  unique(model.calendars.map(x=>x.id), ["calendars"]);
  unique(model.resourceGroups.map(x=>x.id), ["resourceGroups"]);
  unique(model.resources.map(x=>x.id), ["resources"]);
  unique(model.products.map(x=>x.id), ["products"]);
  unique(model.routingRevisions.map(x=>x.id), ["routingRevisions"]);
  unique(model.scenarios.map(x=>x.id), ["scenarios"]);
  unique(model.demand.map(x=>x.id), ["demand"]);
});

export type CapacityModelInput = z.input<typeof capacityModelSchema>;
