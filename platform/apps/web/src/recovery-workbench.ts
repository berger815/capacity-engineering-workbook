import type { CapacityModel, ResourceGroup, ScenarioAction, ScenarioComparisonResult } from "@capacity/domain";

export type RecoverySection = "labor" | "equipment" | "other";

export function recoverySection(group: ResourceGroup): RecoverySection {
  if (group.kind === "labor" || group.kind === "skill") return "labor";
  if (group.kind === "equipment" || group.kind === "tooling") return "equipment";
  return "other";
}

export function actionResourceGroupId(model: CapacityModel, action: ScenarioAction): string | null {
  if (action.kind === "resourceCapacityMultiplier") return action.resourceGroupId;
  if (action.kind === "resourceQuantityDelta") {
    return model.resources.find(resource => resource.id === action.resourceId)?.resourceGroupId ?? null;
  }
  return null;
}

export function actionsForResourceGroup(model: CapacityModel, actions: ScenarioAction[], resourceGroupId: string): ScenarioAction[] {
  return actions
    .filter(action => actionResourceGroupId(model, action) === resourceGroupId)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
}

export function includedActions(actions: ScenarioAction[]): ScenarioAction[] {
  return actions.filter(action => action.included && action.status !== "rejected");
}

export function plannedQuantityDelta(actions: ScenarioAction[]): number {
  return includedActions(actions).reduce(
    (sum, action) => sum + (action.kind === "resourceQuantityDelta" ? action.quantityDelta : 0),
    0,
  );
}

export function plannedCapacityPercent(actions: ScenarioAction[]): number {
  return includedActions(actions).reduce(
    (factor, action) => factor * (action.kind === "resourceCapacityMultiplier" ? action.multiplier : 1),
    1,
  ) * 100 - 100;
}

export function peakComparisonRow(comparison: ScenarioComparisonResult | null, resourceGroupId: string) {
  if (!comparison) return null;
  return comparison.rows
    .filter(row => row.resourceGroupId === resourceGroupId)
    .sort((left, right) => left.comparison.gap - right.comparison.gap)[0] ?? null;
}

export function checklistScore(values: Record<string, number>, keys: string[]): { achieved: number; total: number; percent: number } {
  const achieved = keys.reduce((sum, key) => sum + Math.max(0, Math.min(1, values[key] ?? 0)), 0);
  const total = keys.length;
  return { achieved, total, percent: total === 0 ? 1 : achieved / total };
}
