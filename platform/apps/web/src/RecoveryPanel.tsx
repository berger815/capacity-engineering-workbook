import { useEffect, useMemo, useState } from "react";
import type {
  CapacityModel,
  ResourceGroup,
  ScenarioAction,
  ScenarioActionConfidence,
  ScenarioActionStatus,
  ScenarioComparisonResult,
  ScenarioComparisonRow,
} from "@capacity/domain";
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
import {
  actionsForResourceGroup,
  checklistScore,
  peakComparisonRow,
  plannedCapacityPercent,
  plannedQuantityDelta,
  recoverySection,
} from "./recovery-workbench.js";

interface RecoveryPanelProps {
  model: CapacityModel;
  comparison: ScenarioComparisonResult | null;
  onModelChange: (model: CapacityModel) => void;
  onComparison: (comparison: ScenarioComparisonResult | null) => void;
  onBack: () => void;
  onContinue: () => void;
}

interface MilestoneDraft {
  effect: "quantity" | "capacity";
  date: string;
  description: string;
  value: number;
  owner: string;
  status: ScenarioActionStatus;
  confidence: ScenarioActionConfidence;
}

const checklistItems = [
  { id: "route", label: "Demand, routing, and lead-time assumptions validated" },
  { id: "baseline", label: "Current labor and equipment capacity sources confirmed" },
  { id: "owner", label: "Recovery owners accept the dated milestones" },
  { id: "dependencies", label: "Hiring, training, procurement, and installation dependencies confirmed" },
  { id: "finance", label: "Investment and recurring-cost authority confirmed" },
  { id: "closure", label: "Combined labor and equipment plan closes the governing gap" },
  { id: "readiness", label: "Operational readiness date supports the customer commitment" },
] as const;

function shortPeriod(value: string): string {
  const [year, month] = value.split("-");
  const label = new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString("en-US", { month: "short" });
  return `${label} ${String(year).slice(-2)}`;
}

function groupRows(comparison: ScenarioComparisonResult | null, resourceGroupId: string): ScenarioComparisonRow[] {
  return comparison?.rows
    .filter(row => row.resourceGroupId === resourceGroupId)
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart)) ?? [];
}

function RecoveryTrend({ rows, actions }: { rows: ScenarioComparisonRow[]; actions: ScenarioAction[] }) {
  if (rows.length === 0) return <div className="recovery-chart-empty">Run the comparison to populate the recovery chart.</div>;
  const width = Math.max(760, rows.length * 34 + 90);
  const height = 250;
  const left = 56;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...rows.flatMap(row => [row.baseline.load, row.baseline.capacity, row.comparison.capacity])) * 1.12;
  const step = plotWidth / rows.length;
  const barWidth = Math.max(4, step * 0.52);
  const y = (value: number) => top + plotHeight - Math.min(value / maxValue, 1) * plotHeight;
  const baselinePath = rows.map((row, index) => `${index === 0 ? "M" : "L"}${left + index * step + step / 2},${y(row.baseline.capacity)}`).join(" ");
  const recoveryPath = rows.map((row, index) => `${index === 0 ? "M" : "L"}${left + index * step + step / 2},${y(row.comparison.capacity)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div className="recovery-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Demand, baseline capacity, and recovery capacity by period">
        {[0, .25, .5, .75, 1].map(tick => {
          const value = maxValue * tick;
          return <g key={tick}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="recovery-grid-line" /><text x={left - 7} y={y(value) + 4} textAnchor="end" className="recovery-axis-label">{Math.round(value)}</text></g>;
        })}
        {rows.map((row, index) => {
          const x = left + index * step + (step - barWidth) / 2;
          const utilization = row.comparison.utilization ?? 0;
          const status = utilization > 1 ? "over" : utilization >= .85 ? "watch" : "ok";
          return <g key={`${row.resourceGroupId}-${row.periodStart}`}>
            <rect x={x} y={y(row.baseline.load)} width={barWidth} height={top + plotHeight - y(row.baseline.load)} rx="2" className={`recovery-load-bar ${status}`} />
            {index % labelEvery === 0 ? <text x={x + barWidth / 2} y={height - 17} textAnchor="middle" className="recovery-axis-label">{shortPeriod(row.periodStart)}</text> : null}
          </g>;
        })}
        <path d={baselinePath} className="recovery-baseline-line" />
        <path d={recoveryPath} className="recovery-plan-line" />
        {actions.filter(action => action.included && action.status !== "rejected").map(action => {
          const index = rows.findIndex(row => row.periodStart >= action.effectiveFrom.slice(0, 10));
          if (index < 0) return null;
          const row = rows[index];
          const cx = left + index * step + step / 2;
          return <circle key={action.id} cx={cx} cy={y(row.comparison.capacity)} r="5" className="recovery-milestone-dot"><title>{action.name} · {action.effectiveFrom}</title></circle>;
        })}
      </svg>
    </div>
  );
}

function RagStrip({ rows }: { rows: ScenarioComparisonRow[] }) {
  return <div className="recovery-rag-strip">{rows.map(row => {
    const utilization = row.comparison.utilization;
    const status = row.comparison.load === 0 ? "empty" : utilization !== null && utilization > 1 ? "over" : utilization !== null && utilization >= .85 ? "watch" : "ok";
    return <div key={row.periodStart} className={`recovery-rag-cell ${status}`} title={`${row.periodStart}: ${formatPercent(utilization)}`}><span>{shortPeriod(row.periodStart)}</span><strong>{status === "over" ? "!" : status === "watch" ? "~" : status === "empty" ? "—" : "OK"}</strong></div>;
  })}</div>;
}

function RecoveryWaterfall({ group, row, actions }: { group: ResourceGroup | undefined; row: ScenarioComparisonRow | null; actions: ScenarioAction[] }) {
  if (!group || !row) return <div className="recovery-chart-empty">Select a resource and run the comparison.</div>;
  const capacityAdded = row.comparison.capacity - row.baseline.capacity;
  return <div className="waterfall-flow">
    <div className="waterfall-step demand"><span>Peak demand</span><strong>{row.baseline.load.toFixed(1)}</strong><small>{row.periodStart}</small></div>
    <div className="waterfall-arrow">→</div>
    <div className="waterfall-step baseline"><span>Current capacity</span><strong>{row.baseline.capacity.toFixed(1)}</strong><small>{row.baseline.gap < 0 ? `${Math.abs(row.baseline.gap).toFixed(1)} short` : `${row.baseline.gap.toFixed(1)} spare`}</small></div>
    <div className="waterfall-arrow">+</div>
    <div className="waterfall-step action"><span>Recovery added</span><strong>{capacityAdded >= 0 ? "+" : ""}{capacityAdded.toFixed(1)}</strong><small>{actions.filter(action => action.included && action.status !== "rejected").length} milestone{actions.length === 1 ? "" : "s"}</small></div>
    <div className="waterfall-arrow">=</div>
    <div className={`waterfall-step result ${row.comparison.gap < 0 ? "open" : "closed"}`}><span>Residual balance</span><strong>{row.comparison.gap >= 0 ? "+" : ""}{row.comparison.gap.toFixed(1)}</strong><small>{row.comparison.gap < 0 ? "Gap remains" : "Gap closed"}</small></div>
  </div>;
}

function ResourceRecoveryBlock({
  model,
  group,
  actions,
  comparison,
  expanded,
  busy,
  onToggle,
  onAdd,
  onInclude,
  onReject,
}: {
  model: CapacityModel;
  group: ResourceGroup;
  actions: ScenarioAction[];
  comparison: ScenarioComparisonResult | null;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onAdd: (group: ResourceGroup, draft: MilestoneDraft) => Promise<void>;
  onInclude: (id: string, included: boolean) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const rows = groupRows(comparison, group.id);
  const peak = peakComparisonRow(comparison, group.id);
  const resources = model.resources.filter(resource => resource.resourceGroupId === group.id);
  const currentQuantity = resources.reduce((sum, resource) => sum + resource.quantity, 0);
  const quantityAdded = plannedQuantityDelta(actions);
  const capacityPercent = plannedCapacityPercent(actions);
  const section = recoverySection(group);
  const [draft, setDraft] = useState<MilestoneDraft>({
    effect: "quantity",
    date: "2027-07",
    description: "",
    value: 1,
    owner: "",
    status: "proposed",
    confidence: "medium",
  });
  const effectUnit = section === "labor" ? "FTE" : section === "equipment" ? "machines" : "resource equivalents";
  const residual = peak?.comparison.gap ?? 0;
  const badge = !comparison ? "Not compared" : residual < 0 ? `${Math.abs(residual).toFixed(1)} gap remains` : `${residual.toFixed(1)} spare`;

  function update<Key extends keyof MilestoneDraft>(key: Key, value: MilestoneDraft[Key]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  async function add(): Promise<void> {
    await onAdd(group, draft);
    setDraft(current => ({ ...current, description: "", value: current.effect === "quantity" ? 1 : 10 }));
  }

  return <div className={`recovery-resource-block ${section}`}>
    <button type="button" className="recovery-resource-header" onClick={onToggle}>
      <span className="recovery-resource-title"><b>{section === "equipment" ? "⚙" : section === "labor" ? "👥" : "◆"}</b><span><strong>{group.name}</strong><small>{group.kind} · {group.capacityUnit}</small></span></span>
      <span className="recovery-resource-badges"><i>{actions.filter(action => action.included && action.status !== "rejected").length} milestones</i><i className={residual < 0 ? "bad" : "good"}>{badge}</i><b>{expanded ? "⌃" : "⌄"}</b></span>
    </button>
    {expanded ? <div className="recovery-resource-body">
      <div className="recovery-context-grid">
        <div><span>Current baseline</span><strong>{currentQuantity.toFixed(1)} {effectUnit}</strong></div>
        <div><span>Plan quantity added</span><strong>{quantityAdded >= 0 ? "+" : ""}{quantityAdded.toFixed(1)} {effectUnit}</strong></div>
        <div><span>Effective-capacity change</span><strong>{capacityPercent >= 0 ? "+" : ""}{capacityPercent.toFixed(0)}%</strong></div>
        <div><span>Peak recovery utilization</span><strong>{formatPercent(peak?.comparison.utilization ?? null)}</strong></div>
      </div>

      <h4>Recovery plan milestones</h4>
      <div className="table-wrap"><table className="milestone-table"><thead><tr><th>#</th><th>In service</th><th>Event</th><th>Effect</th><th>Owner</th><th>Status</th><th>Use</th><th /></tr></thead><tbody>
        {actions.length === 0 ? <tr><td colSpan={8} className="muted-cell">No dated milestones yet.</td></tr> : actions.map((action, index) => <tr key={action.id} className={action.status === "rejected" ? "rejected-row" : ""}><td>{index + 1}</td><td>{action.effectiveFrom.slice(0, 7)}</td><td><strong>{action.name}</strong><small>{action.confidence ?? "unknown"} confidence</small></td><td>{actionEffectLabel(action)}</td><td>{action.owner ?? "—"}</td><td>{action.status}</td><td><input type="checkbox" checked={action.included} disabled={action.status === "rejected" || busy} onChange={event => void onInclude(action.id, event.target.checked)} /></td><td><button className="text-danger" type="button" disabled={action.status === "rejected" || busy} onClick={() => void onReject(action.id)}>Reject</button></td></tr>)}
      </tbody></table></div>

      <div className="milestone-entry">
        <label>In service<input type="month" value={draft.date} onChange={event => update("date", event.target.value)} /></label>
        <label>Event<input value={draft.description} onChange={event => update("description", event.target.value)} placeholder={section === "labor" ? "Hire or cross-train…" : "Install or commission…"} /></label>
        <label>Effect<select value={draft.effect} onChange={event => { const effect = event.target.value as MilestoneDraft["effect"]; setDraft(current => ({ ...current, effect, value: effect === "quantity" ? 1 : 10 })); }}><option value="quantity">Add {effectUnit}</option><option value="capacity">Increase effective capacity %</option></select></label>
        <label>{draft.effect === "quantity" ? effectUnit : "Capacity %"}<input type="number" min="0" step={draft.effect === "quantity" ? ".25" : "1"} value={draft.value} onChange={event => update("value", Number(event.target.value))} /></label>
        <label>Owner<input value={draft.owner} onChange={event => update("owner", event.target.value)} placeholder="Owner" /></label>
        <label>Status<select value={draft.status} onChange={event => update("status", event.target.value as ScenarioActionStatus)}><option value="proposed">Proposed</option><option value="approved">Approved</option><option value="implemented">Implemented</option></select></label>
        <button className="add-row-btn" type="button" disabled={busy || !draft.date || draft.value <= 0} onClick={() => void add()}>+ Add milestone</button>
      </div>
      <div className="quick-milestones"><span>Quick add:</span><button type="button" onClick={() => setDraft(current => ({ ...current, effect: "quantity", value: 1, description: section === "labor" ? "Add 1 qualified FTE" : "Add 1 machine" }))}>+1 {effectUnit}</button><button type="button" onClick={() => setDraft(current => ({ ...current, effect: "quantity", value: 2, description: section === "labor" ? "Add 2 qualified FTE" : "Add 2 machines" }))}>+2 {effectUnit}</button><button type="button" onClick={() => setDraft(current => ({ ...current, effect: "capacity", value: 10, description: "Improve effective capacity 10%" }))}>+10% capacity</button></div>

      <div className="recovery-legend"><span><i className="demand" />Demand</span><span><i className="baseline" />Baseline capacity</span><span><i className="plan" />Recovery capacity</span><span><i className="milestone" />Milestone</span></div>
      <RecoveryTrend rows={rows} actions={actions} />
      <RagStrip rows={rows} />
      {section === "labor" ? <div className="recovery-hc-summary"><div><span>Current FTE equivalents</span><strong>{currentQuantity.toFixed(1)}</strong></div><div><span>Plan FTE added</span><strong>{quantityAdded.toFixed(1)}</strong></div><div><span>Peak required FTE equivalent</span><strong>{peak && peak.baseline.capacity > 0 ? (currentQuantity * peak.baseline.load / peak.baseline.capacity).toFixed(1) : "—"}</strong></div><div className={residual < 0 ? "bad" : "good"}><span>Plan status</span><strong>{residual < 0 ? "Does not close gap" : "Closes modeled gap"}</strong></div></div> : null}
    </div> : null}
  </div>;
}

export default function RecoveryPanel({ model, comparison, onModelChange, onComparison, onBack, onContinue }: RecoveryPanelProps) {
  const baselineScenarioId = findBaselineScenarioId(model);
  const preparedModel = useMemo(() => ensureRecoveryScenario(model, baselineScenarioId), [model, baselineScenarioId]);
  const recoveryScenarioId = findRecoveryScenarioId(preparedModel) ?? "recovery-1";
  const actions = recoveryActions(preparedModel, recoveryScenarioId);
  const laborGroups = preparedModel.resourceGroups.filter(group => recoverySection(group) === "labor");
  const equipmentGroups = preparedModel.resourceGroups.filter(group => recoverySection(group) === "equipment");
  const otherGroups = preparedModel.resourceGroups.filter(group => recoverySection(group) === "other");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([laborGroups[0]?.id, equipmentGroups[0]?.id].filter(Boolean) as string[]));
  const [waterfallGroupId, setWaterfallGroupId] = useState(laborGroups[0]?.id ?? equipmentGroups[0]?.id ?? otherGroups[0]?.id ?? "");
  const [waterfallView, setWaterfallView] = useState<"summary" | "detail">("summary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demandProductId, setDemandProductId] = useState("all");
  const [demandPercent, setDemandPercent] = useState(-5);
  const [demandDate, setDemandDate] = useState("2027-07");
  const [demandOwner, setDemandOwner] = useState("");

  const names = useMemo(() => Object.fromEntries(preparedModel.resourceGroups.map(group => [group.id, group.name])), [preparedModel]);
  const baselineDecision = comparison ? summarizeDecision(comparison.baseline, names) : null;
  const recoveryDecision = comparison ? summarizeDecision(comparison.comparison, names) : null;
  const selectedGroup = preparedModel.resourceGroups.find(group => group.id === waterfallGroupId);
  const selectedActions = selectedGroup ? actionsForResourceGroup(preparedModel, actions, selectedGroup.id) : [];
  const selectedPeak = selectedGroup ? peakComparisonRow(comparison, selectedGroup.id) : null;
  const checklistValues = Object.fromEntries(checklistItems.map(item => [item.id, Number(preparedModel.metadata?.[`recovery.checklist.${item.id}.status`] ?? 0)]));
  const score = checklistScore(checklistValues, checklistItems.map(item => item.id));

  async function calculate(nextModel = preparedModel): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onComparison(await compareModels(nextModel, baselineScenarioId, recoveryScenarioId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recovery comparison failed");
      onComparison(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!comparison) void calculate(preparedModel);
    // The first comparison is intentionally automatic so the workbench opens populated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addMilestone(group: ResourceGroup, draft: MilestoneDraft): Promise<void> {
    const resource = preparedModel.resources.find(item => item.resourceGroupId === group.id);
    if (draft.effect === "quantity" && !resource) {
      setError(`${group.name} has no underlying resource to receive a quantity milestone.`);
      return;
    }
    const effectLabel = draft.effect === "quantity" ? `+${draft.value} ${recoverySection(group) === "labor" ? "FTE" : recoverySection(group) === "equipment" ? "machine" : "resource equivalent"}` : `+${draft.value}% effective capacity`;
    const base = {
      id: `action-${crypto.randomUUID()}`,
      scenarioId: recoveryScenarioId,
      name: draft.description.trim() || `${group.name} · ${effectLabel}`,
      included: true,
      status: draft.status,
      effectiveFrom: `${draft.date}-01`,
      ...(draft.owner.trim() ? { owner: draft.owner.trim() } : {}),
      confidence: draft.confidence,
      source: "Recovery milestone workbench",
    } as const;
    const action: ScenarioAction = draft.effect === "quantity"
      ? { ...base, kind: "resourceQuantityDelta", resourceId: resource!.id, quantityDelta: draft.value }
      : { ...base, kind: "resourceCapacityMultiplier", resourceGroupId: group.id, multiplier: 1 + draft.value / 100 };
    const next = addRecoveryAction(preparedModel, action);
    onModelChange(next);
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

  async function addDemandMilestone(): Promise<void> {
    if (!demandDate || demandPercent <= -100) return;
    const product = preparedModel.products.find(item => item.id === demandProductId);
    const action: ScenarioAction = {
      id: `action-${crypto.randomUUID()}`,
      scenarioId: recoveryScenarioId,
      name: `${demandPercent}% demand adjustment · ${product?.name ?? "All demand"}`,
      kind: "demandMultiplier",
      included: true,
      status: "proposed",
      effectiveFrom: `${demandDate}-01`,
      ...(demandProductId !== "all" ? { productId: demandProductId } : {}),
      multiplier: 1 + demandPercent / 100,
      ...(demandOwner.trim() ? { owner: demandOwner.trim() } : {}),
      confidence: "medium",
      source: "Recovery milestone workbench",
    };
    const next = addRecoveryAction(preparedModel, action);
    onModelChange(next);
    await calculate(next);
  }

  function updateChecklist(itemId: string, field: "status" | "owner" | "plan" | "date", value: string | number): void {
    const next = { ...preparedModel, metadata: { ...(preparedModel.metadata ?? {}), [`recovery.checklist.${itemId}.${field}`]: value } };
    onModelChange(next);
    onComparison(comparison);
  }

  function toggleGroup(groupId: string): void {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  function renderGroupSection(title: string, subtitle: string, groups: ResourceGroup[]) {
    return <section className="recovery-section-card"><div className="recovery-section-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><span>{groups.length} resource group{groups.length === 1 ? "" : "s"}</span></div>{groups.length === 0 ? <div className="recovery-chart-empty">No applicable resource groups are configured.</div> : groups.map(group => <ResourceRecoveryBlock key={group.id} model={preparedModel} group={group} actions={actionsForResourceGroup(preparedModel, actions, group.id)} comparison={comparison} expanded={expanded.has(group.id)} busy={busy} onToggle={() => toggleGroup(group.id)} onAdd={addMilestone} onInclude={toggleAction} onReject={rejectAction} />)}</section>;
  }

  const detailRows = selectedGroup ? groupRows(comparison, selectedGroup.id).sort((left, right) => left.comparison.gap - right.comparison.gap).slice(0, 8) : [];

  return <section className="panel recovery-workbench">
    <div className="panel-heading"><div><span className="eyebrow blue">Step 6</span><h2>Build the dated recovery plan</h2></div><p>Plan labor and equipment by resource, add the milestone when capacity becomes usable, and verify that the combined plan closes the governing gap.</p></div>
    {error ? <div className="error-panel"><strong>Recovery needs attention</strong><span>{error}</span></div> : null}

    <div className="recovery-topline"><div><span>Protected baseline</span><strong>{preparedModel.scenarios.find(item => item.id === baselineScenarioId)?.name ?? baselineScenarioId}</strong></div><div className="scenario-arrow">→</div><div><span>Recovery plan</span><strong>{actions.filter(action => action.included && action.status !== "rejected").length} active milestones</strong></div><button className="primary" type="button" onClick={() => void calculate()} disabled={busy}>{busy ? "Calculating…" : "Recalculate recovery"}</button></div>

    <section className="recovery-waterfall-card">
      <div className="recovery-card-heading"><div><h3>Labor Recovery Waterfall</h3><p>Peak demand versus current capacity, dated recovery capacity, and the residual balance.</p></div><div className="recovery-card-controls"><select value={waterfallGroupId} onChange={event => setWaterfallGroupId(event.target.value)}>{[...laborGroups, ...equipmentGroups, ...otherGroups].map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><div className="recovery-view-toggle"><button className={waterfallView === "summary" ? "on" : ""} type="button" onClick={() => setWaterfallView("summary")}>Summary</button><button className={waterfallView === "detail" ? "on" : ""} type="button" onClick={() => setWaterfallView("detail")}>Detail</button></div></div></div>
      <RecoveryWaterfall group={selectedGroup} row={selectedPeak} actions={selectedActions} />
      {waterfallView === "detail" ? <div className="table-wrap"><table><thead><tr><th>Period</th><th className="number">Demand</th><th className="number">Baseline</th><th className="number">Recovery</th><th className="number">Residual</th><th className="number">Utilization</th></tr></thead><tbody>{detailRows.map(row => <tr key={row.periodStart}><td>{row.periodStart}</td><td className="number">{row.baseline.load.toFixed(1)}</td><td className="number">{row.baseline.capacity.toFixed(1)}</td><td className="number">{row.comparison.capacity.toFixed(1)}</td><td className={`number ${row.comparison.gap < 0 ? "negative" : "positive"}`}>{row.comparison.gap.toFixed(1)}</td><td className="number">{formatPercent(row.comparison.utilization)}</td></tr>)}</tbody></table></div> : null}
    </section>

    {renderGroupSection("Recovery Plan — Labor & Skills", "Add dated hiring, cross-training, shift, productivity, or other labor-capacity milestones by department.", laborGroups)}
    {renderGroupSection("Equipment Recovery Plan", "Add machines or dated changes to effective equipment capacity. Labor remains visible separately so equipment-only recovery cannot hide a people constraint.", equipmentGroups)}
    {otherGroups.length > 0 ? renderGroupSection("Other Capacity Recovery", "Tooling, space, external, and other constrained resources use the same dated milestone model.", otherGroups) : null}

    <details className="advanced-recovery-card"><summary>Demand shaping and advanced scenario levers</summary><div className="advanced-recovery-body"><p>Use this only when the customer schedule, product mix, or demand assumption is itself part of the recovery plan.</p><div className="advanced-recovery-grid"><label>Product<select value={demandProductId} onChange={event => setDemandProductId(event.target.value)}><option value="all">All demand</option>{preparedModel.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Demand change %<input type="number" value={demandPercent} onChange={event => setDemandPercent(Number(event.target.value))} /></label><label>Effective month<input type="month" value={demandDate} onChange={event => setDemandDate(event.target.value)} /></label><label>Owner<input value={demandOwner} onChange={event => setDemandOwner(event.target.value)} /></label><button className="secondary" type="button" onClick={() => void addDemandMilestone()} disabled={busy}>Add demand milestone</button></div></div></details>

    <section className="recovery-readiness-card"><div className="recovery-card-heading"><div><h3>Readiness Checklist</h3><p>Confirm the organizational, engineering, supply-chain, and investment conditions required to execute the plan.</p></div><div className={`readiness-pill ${score.percent >= .999 ? "good" : score.percent >= .6 ? "watch" : "bad"}`}>Readiness: {score.achieved.toFixed(1)} / {score.total}</div></div><div className="table-wrap"><table className="readiness-table"><thead><tr><th>Item</th><th>Status</th><th>Owner</th><th>Plan / evidence</th><th>Date</th></tr></thead><tbody>{checklistItems.map(item => <tr key={item.id}><td>{item.label}</td><td><select value={String(preparedModel.metadata?.[`recovery.checklist.${item.id}.status`] ?? 0)} onChange={event => updateChecklist(item.id, "status", Number(event.target.value))}><option value="0">Not started</option><option value="0.5">In progress</option><option value="1">Confirmed</option></select></td><td><input value={String(preparedModel.metadata?.[`recovery.checklist.${item.id}.owner`] ?? "")} onChange={event => updateChecklist(item.id, "owner", event.target.value)} placeholder="Owner" /></td><td><input value={String(preparedModel.metadata?.[`recovery.checklist.${item.id}.plan`] ?? "")} onChange={event => updateChecklist(item.id, "plan", event.target.value)} placeholder="Plan or evidence…" /></td><td><input type="date" value={String(preparedModel.metadata?.[`recovery.checklist.${item.id}.date`] ?? "")} onChange={event => updateChecklist(item.id, "date", event.target.value)} /></td></tr>)}</tbody></table></div></section>

    <section className="recovery-actions-summary"><div className="recovery-card-heading"><div><h3>Recovery Plan Actions Summary</h3><p>Combined labor, equipment, capacity, and demand milestones in effective-date order.</p></div></div><div className="table-wrap"><table><thead><tr><th>In service</th><th>Action</th><th>Target</th><th>Effect</th><th>Owner</th><th>Status</th><th>Confidence</th><th>Included</th></tr></thead><tbody>{actions.length === 0 ? <tr><td colSpan={8} className="muted-cell">No recovery milestones defined.</td></tr> : [...actions].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom)).map(action => <tr key={action.id} className={action.status === "rejected" ? "rejected-row" : ""}><td>{action.effectiveFrom}</td><td><strong>{action.name}</strong></td><td>{actionTargetLabel(preparedModel, action)}</td><td>{actionEffectLabel(action)}</td><td>{action.owner ?? "—"}</td><td>{action.status}</td><td>{action.confidence ?? "unknown"}</td><td>{action.included ? "Yes" : "No"}</td></tr>)}</tbody></table></div></section>

    {comparison ? <div className="recovery-decision-strip"><article className={`scenario-result ${baselineDecision?.state ?? "incomplete"}`}><span>Baseline</span><strong>{baselineDecision?.headline}</strong><small>{baselineDecision?.governing ? `${names[baselineDecision.governing.resourceGroupId] ?? baselineDecision.governing.resourceGroupId} · ${formatPercent(baselineDecision.governing.utilization)}` : "No governing result"}</small></article><div className="recovery-outcome-metrics"><div><span>Resolved</span><strong>{comparison.resolvedGapPeriods}</strong></div><div><span>Remaining</span><strong>{comparison.remainingGapPeriods}</strong></div><div><span>Worsened</span><strong>{comparison.worsenedGapPeriods}</strong></div></div><article className={`scenario-result ${recoveryDecision?.state ?? "incomplete"}`}><span>Recovery</span><strong>{recoveryDecision?.headline}</strong><small>{recoveryDecision?.governing ? `${names[recoveryDecision.governing.resourceGroupId] ?? recoveryDecision.governing.resourceGroupId} · ${formatPercent(recoveryDecision.governing.utilization)}` : "No governing result"}</small></article></div> : null}

    <div className="panel-actions split"><button className="secondary" type="button" onClick={onBack}>Back to Capacity Analysis</button><button className="primary" type="button" onClick={onContinue} disabled={!comparison}>Continue to decision</button></div>
  </section>;
}
