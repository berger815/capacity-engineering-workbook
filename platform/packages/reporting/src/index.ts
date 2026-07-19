import type {
  CalculationResult,
  CapacityModel,
  ResourcePeriodResult,
  ScenarioAction,
  ScenarioComparisonResult,
} from "@capacity/domain";

export type DecisionClassification = "supportable" | "conditional" | "notSupportable" | "incomplete";

export interface DecisionPackageRisk {
  resourceGroupId: string;
  resourceName: string;
  periodStart: string;
  periodEnd: string;
  load: number;
  capacity: number;
  gap: number;
  utilization: number | null;
}

export interface DecisionPackageAction {
  id: string;
  name: string;
  kind: ScenarioAction["kind"];
  target: string;
  effect: string;
  included: boolean;
  status: ScenarioAction["status"];
  effectiveFrom: string;
  effectiveTo?: string;
  owner?: string;
  confidence?: string;
  rationale?: string;
}

export interface DecisionPackage {
  packageSchemaVersion: "1.0.0";
  packageId: string;
  generatedAt: string;
  title: string;
  model: {
    id: string;
    name: string;
    schemaVersion: string;
    planningGranularity: string;
    horizonStart: string;
    horizonEnd: string;
  };
  decision: {
    classification: DecisionClassification;
    statement: string;
    baselineScenarioId: string;
    comparisonScenarioId: string;
    baselineGoverningConstraint: DecisionPackageRisk | null;
    recoveryGoverningConstraint: DecisionPackageRisk | null;
    resolvedGapPeriods: number;
    remainingGapPeriods: number;
    worsenedGapPeriods: number;
  };
  assumptions: Array<{ scenarioId: string; key: string; value: string | number | boolean }>;
  actions: DecisionPackageAction[];
  topRemainingRisks: DecisionPackageRisk[];
  issues: CalculationResult["issues"];
  lineage: {
    demandSourceScenarioId?: string;
    appliedActionIds: string[];
    modelMetadata?: CapacityModel["metadata"];
  };
  assessmentSnapshot: {
    model: CapacityModel;
    comparison: ScenarioComparisonResult;
  };
}

function utilizationScore(value: number | null): number {
  if (value === null) return -1;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function classify(result: CalculationResult): DecisionClassification {
  if (result.issues.some(issue => issue.severity === "error") || !result.governingConstraint) return "incomplete";
  const utilization = result.governingConstraint.utilization;
  if (utilization === null) return "incomplete";
  if (!Number.isFinite(utilization) || utilization > 1) return "notSupportable";
  if (utilization >= 0.85) return "conditional";
  return "supportable";
}

function risk(model: CapacityModel, row: ResourcePeriodResult | null): DecisionPackageRisk | null {
  if (!row) return null;
  return {
    resourceGroupId: row.resourceGroupId,
    resourceName: model.resourceGroups.find(group => group.id === row.resourceGroupId)?.name ?? row.resourceGroupId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    load: row.load,
    capacity: row.capacity,
    gap: row.gap,
    utilization: row.utilization,
  };
}

function actionTarget(model: CapacityModel, action: ScenarioAction): string {
  if (action.kind === "resourceQuantityDelta") {
    return model.resources.find(resource => resource.id === action.resourceId)?.name ?? action.resourceId;
  }
  if (action.kind === "resourceCapacityMultiplier") {
    return model.resourceGroups.find(group => group.id === action.resourceGroupId)?.name ?? action.resourceGroupId;
  }
  if (!action.productId) return "All demand";
  return model.products.find(product => product.id === action.productId)?.name ?? action.productId;
}

function actionEffect(action: ScenarioAction): string {
  if (action.kind === "resourceQuantityDelta") return `Add ${action.quantityDelta} resource equivalent`;
  if (action.kind === "resourceCapacityMultiplier") return `${Math.round((action.multiplier - 1) * 100)}% effective capacity change`;
  return `${Math.round((action.multiplier - 1) * 100)}% demand change`;
}

function decisionStatement(classification: DecisionClassification, governing: DecisionPackageRisk | null): string {
  if (classification === "incomplete") return "The capacity commitment is not yet defensible because the model or governing result is incomplete.";
  if (!governing) return "No governing constraint was established.";
  if (classification === "notSupportable") {
    return `${governing.resourceName} remains below required capacity in ${governing.periodStart}; the modeled recovery does not yet support the commitment.`;
  }
  if (classification === "conditional") {
    return `${governing.resourceName} governs the recovered plan in ${governing.periodStart}; the commitment is conditional because modeled margin remains narrow.`;
  }
  return `${governing.resourceName} governs the recovered plan in ${governing.periodStart}; the modeled recovery supports the commitment with remaining capacity margin.`;
}

export function buildDecisionPackage(
  model: CapacityModel,
  comparison: ScenarioComparisonResult,
  generatedAt = new Date().toISOString(),
): DecisionPackage {
  const classification = classify(comparison.comparison);
  const baselineGoverningConstraint = risk(model, comparison.baseline.governingConstraint);
  const recoveryGoverningConstraint = risk(model, comparison.comparison.governingConstraint);
  const applied = new Set(comparison.appliedActionIds);
  const actions = (model.scenarioActions ?? [])
    .filter(action => action.scenarioId === comparison.comparisonScenarioId)
    .map(action => ({
      id: action.id,
      name: action.name,
      kind: action.kind,
      target: actionTarget(model, action),
      effect: actionEffect(action),
      included: applied.has(action.id),
      status: action.status,
      effectiveFrom: action.effectiveFrom,
      ...(action.effectiveTo ? { effectiveTo: action.effectiveTo } : {}),
      ...(action.owner ? { owner: action.owner } : {}),
      ...(action.confidence ? { confidence: action.confidence } : {}),
      ...(action.rationale ? { rationale: action.rationale } : {}),
    }));

  const assumptions = model.scenarios
    .filter(scenario => scenario.id === comparison.baselineScenarioId || scenario.id === comparison.comparisonScenarioId)
    .flatMap(scenario => Object.entries(scenario.assumptions ?? {}).map(([key, value]) => ({ scenarioId: scenario.id, key, value })));

  const topRemainingRisks = [...comparison.comparison.results]
    .filter(row => row.load > 0)
    .sort((a, b) => utilizationScore(b.utilization) - utilizationScore(a.utilization))
    .slice(0, 10)
    .map(row => risk(model, row)!)
    .filter(Boolean);

  return {
    packageSchemaVersion: "1.0.0",
    packageId: `${model.modelId}-${comparison.comparisonScenarioId}-${generatedAt.replaceAll(/[:.]/g, "-")}`,
    generatedAt,
    title: `${model.name} Capacity Assurance Decision`,
    model: {
      id: model.modelId,
      name: model.name,
      schemaVersion: model.schemaVersion,
      planningGranularity: model.planningGranularity,
      horizonStart: model.horizonStart,
      horizonEnd: model.horizonEnd,
    },
    decision: {
      classification,
      statement: decisionStatement(classification, recoveryGoverningConstraint),
      baselineScenarioId: comparison.baselineScenarioId,
      comparisonScenarioId: comparison.comparisonScenarioId,
      baselineGoverningConstraint,
      recoveryGoverningConstraint,
      resolvedGapPeriods: comparison.resolvedGapPeriods,
      remainingGapPeriods: comparison.remainingGapPeriods,
      worsenedGapPeriods: comparison.worsenedGapPeriods,
    },
    assumptions,
    actions,
    topRemainingRisks,
    issues: comparison.comparison.issues,
    lineage: {
      ...(comparison.comparison.demandSourceScenarioId ? { demandSourceScenarioId: comparison.comparison.demandSourceScenarioId } : {}),
      appliedActionIds: comparison.appliedActionIds,
      ...(model.metadata ? { modelMetadata: model.metadata } : {}),
    },
    assessmentSnapshot: { model, comparison },
  };
}

export function serializeDecisionPackage(decisionPackage: DecisionPackage): string {
  return JSON.stringify(decisionPackage, null, 2);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percent(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "No capacity";
  return `${Math.round(value * 100)}%`;
}

export function renderDecisionPackageHtml(decisionPackage: DecisionPackage): string {
  const decision = decisionPackage.decision;
  const actionRows = decisionPackage.actions.map(action => `<tr><td>${escapeHtml(action.name)}</td><td>${escapeHtml(action.target)}</td><td>${escapeHtml(action.effect)}</td><td>${escapeHtml(action.effectiveFrom)}${action.effectiveTo ? ` → ${escapeHtml(action.effectiveTo)}` : " onward"}</td><td>${escapeHtml(action.status)}</td><td>${action.included ? "Included" : "Not included"}</td></tr>`).join("");
  const riskRows = decisionPackage.topRemainingRisks.map(item => `<tr><td>${escapeHtml(item.resourceName)}</td><td>${escapeHtml(item.periodStart)}</td><td class="num">${item.load.toFixed(1)}</td><td class="num">${item.capacity.toFixed(1)}</td><td class="num ${item.gap < 0 ? "bad" : ""}">${item.gap.toFixed(1)}</td><td class="num">${escapeHtml(percent(item.utilization))}</td></tr>`).join("");
  const assumptionRows = decisionPackage.assumptions.map(item => `<tr><td>${escapeHtml(item.scenarioId)}</td><td>${escapeHtml(item.key)}</td><td>${escapeHtml(item.value)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(decisionPackage.title)}</title><style>
:root{font-family:Inter,Arial,sans-serif;color:#17243a}*{box-sizing:border-box}body{margin:0;background:#eef2f7}.page{max-width:1100px;margin:24px auto;background:#fff;padding:38px 44px;box-shadow:0 8px 30px rgba(13,29,52,.12)}header{border-bottom:4px solid #15365b;padding-bottom:20px;margin-bottom:24px}.eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#1769aa;font-weight:800}h1{font-size:30px;margin:6px 0;color:#0d1d34}h2{font-size:18px;margin:28px 0 10px;color:#0d1d34}.meta{color:#66758b;font-size:11px}.decision{border-radius:12px;padding:22px 24px;color:white;background:${decision.classification === "supportable" ? "#176b4a" : decision.classification === "conditional" ? "#a66300" : decision.classification === "notSupportable" ? "#9f3030" : "#536275"}}.decision strong{display:block;font-size:22px;margin:6px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.metric{border:1px solid #d8e0ea;border-radius:9px;padding:14px}.metric span{display:block;font-size:9px;text-transform:uppercase;color:#66758b;font-weight:800}.metric strong{display:block;font-size:19px;margin-top:7px}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#f2f6fa;text-transform:uppercase;color:#66758b;font-size:8px;letter-spacing:.06em}th,td{padding:9px 10px;border-bottom:1px solid #e1e7ee;text-align:left}.num{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#a83232;font-weight:800}.lineage{padding:14px;background:#f6f8fb;border-radius:9px;font-size:10px;color:#4e5f74;overflow-wrap:anywhere}footer{margin-top:28px;border-top:1px solid #d8e0ea;padding-top:14px;color:#7b889a;font-size:9px}@media print{body{background:white}.page{margin:0;max-width:none;box-shadow:none;padding:20px}.no-print{display:none}}@media(max-width:700px){.page{margin:0;padding:24px}.grid{grid-template-columns:repeat(2,1fr)}table{font-size:9px}}
</style></head><body><main class="page"><header><span class="eyebrow">Capacity Assurance Decision Package</span><h1>${escapeHtml(decisionPackage.title)}</h1><div class="meta">Generated ${escapeHtml(decisionPackage.generatedAt)} · Horizon ${escapeHtml(decisionPackage.model.horizonStart)} to ${escapeHtml(decisionPackage.model.horizonEnd)} · ${escapeHtml(decisionPackage.model.planningGranularity)}</div></header><section class="decision"><span class="eyebrow" style="color:rgba(255,255,255,.75)">${escapeHtml(decision.classification)}</span><strong>${escapeHtml(decision.statement)}</strong></section><div class="grid"><div class="metric"><span>Resolved gaps</span><strong>${decision.resolvedGapPeriods}</strong></div><div class="metric"><span>Remaining gaps</span><strong>${decision.remainingGapPeriods}</strong></div><div class="metric"><span>Worsened periods</span><strong>${decision.worsenedGapPeriods}</strong></div><div class="metric"><span>Actions applied</span><strong>${decisionPackage.lineage.appliedActionIds.length}</strong></div></div><h2>Recovery action register</h2><table><thead><tr><th>Action</th><th>Target</th><th>Effect</th><th>Effective</th><th>Status</th><th>Calculation</th></tr></thead><tbody>${actionRows || '<tr><td colspan="6">No actions recorded.</td></tr>'}</tbody></table><h2>Highest remaining risks</h2><table><thead><tr><th>Resource</th><th>Period</th><th class="num">Load</th><th class="num">Capacity</th><th class="num">Gap</th><th class="num">Utilization</th></tr></thead><tbody>${riskRows}</tbody></table><h2>Assumptions</h2><table><thead><tr><th>Scenario</th><th>Assumption</th><th>Value</th></tr></thead><tbody>${assumptionRows || '<tr><td colspan="3">No scenario assumptions recorded.</td></tr>'}</tbody></table><h2>Calculation lineage</h2><div class="lineage">Package ID: ${escapeHtml(decisionPackage.packageId)}<br>Demand source scenario: ${escapeHtml(decisionPackage.lineage.demandSourceScenarioId ?? "Not recorded")}<br>Applied action IDs: ${escapeHtml(decisionPackage.lineage.appliedActionIds.join(", ") || "None")}<br>Model schema: ${escapeHtml(decisionPackage.model.schemaVersion)}</div><footer>This package contains synthetic data unless the assessment owner explicitly replaces the source model. The embedded JSON assessment snapshot is available in the companion portable package.</footer></main></body></html>`;
}
