import { useMemo, useState } from "react";
import type { CapacityModel, ScenarioAction, ScenarioActionConfidence, ScenarioActionStatus, ScenarioComparisonResult } from "@capacity/domain";
import { compareModels } from "./api.js";
import { formatPercent, summarizeDecision } from "./analysis.js";
import {
  actionEffectLabel,
  actionTargetLabel,
  addRecoveryAction,
  ensureRecoveryScenario,
  findBaselineScenarioId,
  findRecoveryScenarioId,
  recoveryActions,
  rejectRecoveryAction,
  setRecoveryActionIncluded,
} from "./recovery.js";

interface RecoveryPanelProps {
  model: CapacityModel;
  comparison: ScenarioComparisonResult | null;
  onModelChange: (model: CapacityModel) => void;
  onComparison: (comparison: ScenarioComparisonResult | null) => void;
  onBack: () => void;
  onContinue: () => void;
}

type ActionKind = ScenarioAction["kind"];

function targetOptions(model: CapacityModel, kind: ActionKind) {
  if (kind === "resourceQuantityDelta") {
    return model.resources.map(resource => ({
      id: resource.id,
      label: `${model.resourceGroups.find(group => group.id === resource.resourceGroupId)?.name ?? resource.resourceGroupId} · ${resource.name}`,
    }));
  }
  if (kind === "resourceCapacityMultiplier") {
    return model.resourceGroups.map(group => ({ id: group.id, label: group.name }));
  }
  return [{ id: "all", label: "All demand" }, ...model.products.map(product => ({ id: product.id, label: product.name }))];
}

function effectPrompt(kind: ActionKind): string {
  if (kind === "resourceQuantityDelta") return "Resource equivalents added";
  if (kind === "resourceCapacityMultiplier") return "Effective capacity change %";
  return "Demand change %";
}

export default function RecoveryPanel({
  model,
  comparison,
  onModelChange,
  onComparison,
  onBack,
  onContinue,
}: RecoveryPanelProps) {
  const baselineScenarioId = findBaselineScenarioId(model);
  const preparedModel = useMemo(() => ensureRecoveryScenario(model, baselineScenarioId), [model, baselineScenarioId]);
  const recoveryScenarioId = findRecoveryScenarioId(preparedModel) ?? "recovery-1";
  const actions = recoveryActions(preparedModel, recoveryScenarioId);
  const [kind, setKind] = useState<ActionKind>("resourceQuantityDelta");
  const [targetId, setTargetId] = useState(targetOptions(preparedModel, "resourceQuantityDelta")[0]?.id ?? "");
  const [value, setValue] = useState(1);
  const [effectiveFrom, setEffectiveFrom] = useState("2027-07-01");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<ScenarioActionStatus>("proposed");
  const [confidence, setConfidence] = useState<ScenarioActionConfidence>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(
    () => Object.fromEntries(preparedModel.resourceGroups.map(group => [group.id, group.name])),
    [preparedModel],
  );
  const baselineDecision = comparison ? summarizeDecision(comparison.baseline, names) : null;
  const recoveryDecision = comparison ? summarizeDecision(comparison.comparison, names) : null;
  const changedRows = comparison
    ? comparison.rows
      .filter(row => Math.abs(row.capacityDelta) > 0.000001 || Math.abs(row.loadDelta) > 0.000001)
      .sort((a, b) => b.gapDelta - a.gapDelta)
      .slice(0, 10)
    : [];

  async function calculate(nextModel = preparedModel): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await compareModels(nextModel, baselineScenarioId, recoveryScenarioId);
      onComparison(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recovery comparison failed");
      onComparison(null);
    } finally {
      setBusy(false);
    }
  }

  function selectKind(nextKind: ActionKind): void {
    setKind(nextKind);
    setTargetId(targetOptions(preparedModel, nextKind)[0]?.id ?? "");
    setValue(nextKind === "resourceQuantityDelta" ? 1 : nextKind === "resourceCapacityMultiplier" ? 10 : -5);
  }

  function buildAction(): ScenarioAction {
    const target = targetOptions(preparedModel, kind).find(option => option.id === targetId)?.label ?? targetId;
    const actionName = name.trim() || `${kind === "resourceQuantityDelta" ? "Add capacity" : kind === "resourceCapacityMultiplier" ? "Increase effective capacity" : "Adjust demand"} · ${target}`;
    const base = {
      id: `action-${crypto.randomUUID()}`,
      scenarioId: recoveryScenarioId,
      name: actionName,
      kind,
      included: true,
      status,
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      ...(owner.trim() ? { owner: owner.trim() } : {}),
      confidence,
      source: "Assessment Studio",
    } as const;

    if (kind === "resourceQuantityDelta") {
      return { ...base, kind, resourceId: targetId, quantityDelta: value };
    }
    if (kind === "resourceCapacityMultiplier") {
      return { ...base, kind, resourceGroupId: targetId, multiplier: 1 + value / 100 };
    }
    return { ...base, kind, ...(targetId !== "all" ? { productId: targetId } : {}), multiplier: 1 + value / 100 };
  }

  async function addAction(): Promise<void> {
    if (!targetId || !effectiveFrom || value <= (kind === "demandMultiplier" ? -100 : 0)) {
      setError("Complete the target, effective date, and a valid action value.");
      return;
    }
    const next = addRecoveryAction(preparedModel, buildAction());
    onModelChange(next);
    setName("");
    await calculate(next);
  }

  async function toggleAction(actionId: string, included: boolean): Promise<void> {
    const next = setRecoveryActionIncluded(preparedModel, actionId, included);
    onModelChange(next);
    await calculate(next);
  }

  async function rejectAction(actionId: string): Promise<void> {
    const next = rejectRecoveryAction(preparedModel, actionId);
    onModelChange(next);
    await calculate(next);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow blue">Step 5</span><h2>Test a recovery plan without changing the baseline</h2></div>
        <p>Every countermeasure has a named target, effective date, owner, approval state, and confidence. The baseline remains unchanged beside it.</p>
      </div>

      {error ? <div className="error-panel"><strong>Recovery action rejected</strong><span>{error}</span></div> : null}

      <div className="scenario-pair">
        <div><span>Protected baseline</span><strong>{preparedModel.scenarios.find(item => item.id === baselineScenarioId)?.name ?? baselineScenarioId}</strong><small>{preparedModel.demand.filter(item => item.scenarioId === baselineScenarioId).length} demand records</small></div>
        <div className="scenario-arrow">→</div>
        <div><span>Recovery scenario</span><strong>{preparedModel.scenarios.find(item => item.id === recoveryScenarioId)?.name ?? recoveryScenarioId}</strong><small>{actions.filter(action => action.included).length} included actions</small></div>
      </div>

      <div className="recovery-layout">
        <article className="card action-builder">
          <div className="card-title-row"><div><h3>Add a governed action</h3><small>Actions are calculated only in the recovery scenario.</small></div></div>
          <div className="form-grid two">
            <label>Recovery lever<select value={kind} onChange={event => selectKind(event.target.value as ActionKind)}><option value="resourceQuantityDelta">Add people or equipment</option><option value="resourceCapacityMultiplier">Increase effective capacity</option><option value="demandMultiplier">Challenge demand</option></select></label>
            <label>Target<select value={targetId} onChange={event => setTargetId(event.target.value)}>{targetOptions(preparedModel, kind).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            <label>{effectPrompt(kind)}<input type="number" step={kind === "resourceQuantityDelta" ? "0.25" : "1"} value={value} onChange={event => setValue(Number(event.target.value))} /></label>
            <label>In service<input type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} /></label>
            <label>Ends, when temporary<input type="date" value={effectiveTo} onChange={event => setEffectiveTo(event.target.value)} /></label>
            <label>Owner<input value={owner} onChange={event => setOwner(event.target.value)} placeholder="Responsible leader" /></label>
            <label>Approval state<select value={status} onChange={event => setStatus(event.target.value as ScenarioActionStatus)}><option value="proposed">Proposed</option><option value="approved">Approved</option><option value="implemented">Implemented</option></select></label>
            <label>Confidence<select value={confidence} onChange={event => setConfidence(event.target.value as ScenarioActionConfidence)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unknown">Unknown</option></select></label>
          </div>
          <label className="full-field">Action name<input value={name} onChange={event => setName(event.target.value)} placeholder="Optional—generated from the target when blank" /></label>
          <button className="primary full" type="button" onClick={() => void addAction()} disabled={busy}>{busy ? "Calculating…" : "Add action and recalculate"}</button>
        </article>

        <article className="card action-register">
          <div className="card-title-row"><div><h3>Recovery action register</h3><small>Rejected actions remain visible for audit history.</small></div><button className="secondary" type="button" onClick={() => void calculate()} disabled={busy}>{busy ? "Calculating…" : "Compare"}</button></div>
          {actions.length === 0 ? <p>No recovery actions have been defined.</p> : <div className="action-list">{actions.map(action => (
            <div className={`action-row ${action.status === "rejected" ? "rejected" : ""}`} key={action.id}>
              <label className="action-check"><input type="checkbox" checked={action.included} disabled={action.status === "rejected" || busy} onChange={event => void toggleAction(action.id, event.target.checked)} /><span /></label>
              <div className="action-copy"><strong>{action.name}</strong><span>{actionTargetLabel(preparedModel, action)} · {actionEffectLabel(action)}</span><small>{action.effectiveFrom}{action.effectiveTo ? ` → ${action.effectiveTo}` : " onward"} · {action.status} · {action.confidence ?? "unknown"} confidence{action.owner ? ` · ${action.owner}` : ""}</small></div>
              <button className="text-danger" type="button" disabled={action.status === "rejected" || busy} onClick={() => void rejectAction(action.id)}>Reject</button>
            </div>
          ))}</div>}
        </article>
      </div>

      {comparison ? (
        <>
          <div className="comparison-head">
            <article className={`scenario-result ${baselineDecision?.state ?? "incomplete"}`}><span>Baseline</span><strong>{baselineDecision?.headline}</strong><small>{baselineDecision?.governing ? `${names[baselineDecision.governing.resourceGroupId] ?? baselineDecision.governing.resourceGroupId} · ${formatPercent(baselineDecision.governing.utilization)}` : "No governing result"}</small></article>
            <article className={`scenario-result ${recoveryDecision?.state ?? "incomplete"}`}><span>Recovery</span><strong>{recoveryDecision?.headline}</strong><small>{recoveryDecision?.governing ? `${names[recoveryDecision.governing.resourceGroupId] ?? recoveryDecision.governing.resourceGroupId} · ${formatPercent(recoveryDecision.governing.utilization)}` : "No governing result"}</small></article>
          </div>
          <div className="metric-grid four">
            <div className="metric"><span>Gap periods resolved</span><strong>{comparison.resolvedGapPeriods}</strong><small>Baseline shortages closed</small></div>
            <div className="metric"><span>Gap periods remaining</span><strong>{comparison.remainingGapPeriods}</strong><small>Still below required capacity</small></div>
            <div className="metric"><span>Periods worsened</span><strong>{comparison.worsenedGapPeriods}</strong><small>Recovery should not create new exposure</small></div>
            <div className="metric"><span>Actions applied</span><strong>{comparison.appliedActionIds.length}</strong><small>Included in calculation lineage</small></div>
          </div>
          <div className="table-card">
            <div className="card-title-row"><div><h3>Where the recovery plan changes the result</h3><small>Only periods with a calculated load or capacity delta are shown.</small></div></div>
            <div className="table-wrap"><table><thead><tr><th>Resource</th><th>Period</th><th className="number">Baseline gap</th><th className="number">Recovery gap</th><th className="number">Capacity added</th><th className="number">Gap improvement</th></tr></thead><tbody>{changedRows.map(row => <tr key={`${row.resourceGroupId}-${row.periodStart}`}><td>{names[row.resourceGroupId] ?? row.resourceGroupId}</td><td>{row.periodStart}</td><td className={`number ${row.baseline.gap < 0 ? "negative" : ""}`}>{row.baseline.gap.toFixed(1)}</td><td className={`number ${row.comparison.gap < 0 ? "negative" : ""}`}>{row.comparison.gap.toFixed(1)}</td><td className="number positive">+{row.capacityDelta.toFixed(1)}</td><td className={`number ${row.gapDelta >= 0 ? "positive" : "negative"}`}>{row.gapDelta >= 0 ? "+" : ""}{row.gapDelta.toFixed(1)}</td></tr>)}</tbody></table></div>
          </div>
        </>
      ) : <div className="empty-state compact"><h3>Recovery has not been compared</h3><p>Run the comparison to see whether the actions close the actual governing gaps.</p><button className="primary" type="button" onClick={() => void calculate()} disabled={busy}>{busy ? "Calculating…" : "Compare baseline and recovery"}</button></div>}

      <div className="panel-actions split"><button className="secondary" type="button" onClick={onBack}>Back</button><button className="primary" type="button" disabled={!comparison} onClick={onContinue}>Continue to decision</button></div>
    </section>
  );
}
