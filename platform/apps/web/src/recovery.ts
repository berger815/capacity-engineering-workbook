import type { CapacityModel, Scenario, ScenarioAction } from "@capacity/domain";

export function findBaselineScenarioId(model: CapacityModel): string {
  return model.scenarios.find(scenario => scenario.kind === "baseline")?.id ?? model.scenarios[0]?.id ?? "baseline";
}

export function findRecoveryScenarioId(model: CapacityModel): string | null {
  return model.scenarios.find(scenario => scenario.kind === "recovery")?.id ?? null;
}

export function ensureRecoveryScenario(model: CapacityModel, baselineScenarioId: string): CapacityModel {
  if (findRecoveryScenarioId(model)) return model;
  const scenario: Scenario = {
    id: "recovery-1",
    name: "Recovery scenario",
    kind: "recovery",
    parentScenarioId: baselineScenarioId,
    createdAt: new Date().toISOString(),
    createdBy: "Assessment Studio",
    assumptions: { "demand-source": "inherits baseline demand" },
  };
  return { ...model, scenarios: [...model.scenarios, scenario] };
}

export function addRecoveryAction(model: CapacityModel, action: ScenarioAction): CapacityModel {
  return { ...model, scenarioActions: [...(model.scenarioActions ?? []), action] };
}

export function setRecoveryActionIncluded(model: CapacityModel, actionId: string, included: boolean): CapacityModel {
  return {
    ...model,
    scenarioActions: (model.scenarioActions ?? []).map(action =>
      action.id === actionId
        ? { ...action, included, ...(action.status === "rejected" && included ? { status: "proposed" as const } : {}) }
        : action,
    ),
  };
}

export function rejectRecoveryAction(model: CapacityModel, actionId: string): CapacityModel {
  return {
    ...model,
    scenarioActions: (model.scenarioActions ?? []).map(action =>
      action.id === actionId ? { ...action, included: false, status: "rejected" as const } : action,
    ),
  };
}

export function recoveryActions(model: CapacityModel, scenarioId: string): ScenarioAction[] {
  return (model.scenarioActions ?? []).filter(action => action.scenarioId === scenarioId);
}

export function actionTargetLabel(model: CapacityModel, action: ScenarioAction): string {
  if (action.kind === "resourceQuantityDelta") {
    return model.resources.find(resource => resource.id === action.resourceId)?.name ?? action.resourceId;
  }
  if (action.kind === "resourceCapacityMultiplier") {
    return model.resourceGroups.find(group => group.id === action.resourceGroupId)?.name ?? action.resourceGroupId;
  }
  if (!action.productId) return "All demand";
  return model.products.find(product => product.id === action.productId)?.name ?? action.productId;
}

export function actionEffectLabel(action: ScenarioAction): string {
  if (action.kind === "resourceQuantityDelta") return `+${action.quantityDelta} resource equivalent`;
  if (action.kind === "resourceCapacityMultiplier") return `${Math.round((action.multiplier - 1) * 100)}% effective capacity`;
  return `${Math.round((action.multiplier - 1) * 100)}% demand`;
}
