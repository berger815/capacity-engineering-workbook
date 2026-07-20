import { useState } from "react";
import type { CapacityModel, ConstraintExplanation, ResourcePeriodResult } from "@capacity/domain";
import { explainResourcePeriod } from "./api.js";
import { formatPercent } from "./analysis.js";

interface ConstraintExplorerProps {
  model: CapacityModel;
  scenarioId: string;
  rows: ResourcePeriodResult[];
  title?: string;
  subtitle?: string;
  onReviseRecovery?: () => void;
  onEditResourceGroup?: (resourceGroupId: string) => void;
}

export default function ConstraintExplorer({ model, scenarioId, rows, title = "Highest-risk periods", subtitle = "Select a row to trace its load back to products, operations, and demand records.", onReviseRecovery, onEditResourceGroup }: ConstraintExplorerProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ConstraintExplanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resourceNames = Object.fromEntries(model.resourceGroups.map(group => [group.id, group.name]));
  const productNames = Object.fromEntries(model.products.map(product => [product.id, product.name]));

  async function explain(row: ResourcePeriodResult): Promise<void> {
    const key = `${row.resourceGroupId}-${row.periodStart}`;
    setSelectedKey(key);
    setBusy(true);
    setError(null);
    try {
      setExplanation(await explainResourcePeriod(model, scenarioId, row.resourceGroupId, row.periodStart));
    } catch (caught) {
      setExplanation(null);
      setError(caught instanceof Error ? caught.message : "Constraint explanation failed");
    } finally {
      setBusy(false);
    }
  }

  return <div className="constraint-explorer">
    <div className="table-card"><div className="card-title-row"><div><h3>{title}</h3><small>{subtitle}</small></div><div className="card-actions">{explanation && onEditResourceGroup ? <button className="secondary" type="button" onClick={() => onEditResourceGroup(explanation.resourceGroupId)}>Edit resource group</button> : null}{onReviseRecovery ? <button className="secondary" type="button" onClick={onReviseRecovery}>Revise recovery</button> : null}</div></div><div className="table-wrap"><table><thead><tr><th>Resource</th><th>Period</th><th className="number">Load</th><th className="number">Capacity</th><th className="number">Gap</th><th className="number">Utilization</th><th /></tr></thead><tbody>{rows.map(row => { const key = `${row.resourceGroupId}-${row.periodStart}`; return <tr key={key} className={selectedKey === key ? "selected-row" : ""}><td>{resourceNames[row.resourceGroupId] ?? row.resourceGroupId}</td><td>{row.periodStart}</td><td className="number">{row.load.toFixed(1)}</td><td className="number">{row.capacity.toFixed(1)}</td><td className={`number ${row.gap < 0 ? "negative" : ""}`}>{row.gap.toFixed(1)}</td><td className="number"><span className={`utilization ${row.utilization !== null && row.utilization > 1 ? "over" : ""}`}>{formatPercent(row.utilization)}</span></td><td><div className="row-actions"><button className="explain-button" type="button" disabled={busy && selectedKey === key} onClick={() => void explain(row)}>{busy && selectedKey === key ? "Tracing…" : "Explain"}</button>{onEditResourceGroup ? <button className="text-button" type="button" onClick={() => onEditResourceGroup(row.resourceGroupId)}>Edit</button> : null}</div></td></tr>; })}</tbody></table></div></div>
    {error ? <div className="error-panel"><strong>Explanation unavailable</strong><span>{error}</span></div> : null}
    {explanation ? <section className="explanation-panel"><div className="explanation-heading"><div><span className="eyebrow blue">Load trace</span><h3>{resourceNames[explanation.resourceGroupId] ?? explanation.resourceGroupId} · {explanation.periodStart}</h3></div><div className={`reconciliation ${Math.abs(explanation.unexplainedLoad) < .000001 ? "reconciled" : "unreconciled"}`}><span>Reconciliation</span><strong>{Math.abs(explanation.unexplainedLoad) < .000001 ? "100% explained" : `${explanation.unexplainedLoad.toFixed(3)} unexplained`}</strong></div></div><div className="metric-grid four compact"><div className="metric"><span>Calculated load</span><strong>{explanation.result.load.toFixed(1)}</strong></div><div className="metric"><span>Explained load</span><strong>{explanation.totalExplainedLoad.toFixed(1)}</strong></div><div className="metric"><span>Products contributing</span><strong>{explanation.products.length}</strong></div><div className="metric"><span>Demand records</span><strong>{new Set(explanation.contributions.map(item => item.demandId)).size}</strong></div></div><div className="explanation-grid"><article className="card"><h3>Product contribution</h3><div className="share-list">{explanation.products.map(product => <div key={product.productId}><div><strong>{productNames[product.productId] ?? product.productId}</strong><small>{product.demandRecordCount} demand record{product.demandRecordCount === 1 ? "" : "s"} · ships {product.earliestShipDate} to {product.latestShipDate}</small></div><span>{product.load.toFixed(1)} · {formatPercent(product.shareOfPeriodLoad)}</span></div>)}</div></article><article className="card"><h3>Operation contribution</h3><div className="share-list">{explanation.operations.map(operation => <div key={operation.operationId}><div><strong>{operation.operationName}</strong><small>{operation.operationId}</small></div><span>{operation.load.toFixed(1)} · {formatPercent(operation.shareOfPeriodLoad)}</span></div>)}</div></article></div><div className="table-card contribution-table"><div className="card-title-row"><div><h3>Demand and routing detail</h3><small>Every row is a direct contributor to the selected resource period.</small></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Ship date</th><th>Operation</th><th>Lead-time phase</th><th className="number">Demand</th><th className="number">Allocation</th><th className="number">Run</th><th className="number">Setup</th><th className="number">Load</th></tr></thead><tbody>{explanation.contributions.slice(0,100).map(contribution => <tr key={`${contribution.demandId}-${contribution.requirementId}-${contribution.phaseId}`}><td>{productNames[contribution.productId] ?? contribution.productId}</td><td>{contribution.shipDate}</td><td>{contribution.operationName}</td><td>{contribution.phaseName}</td><td className="number">{contribution.adjustedDemandQuantity.toFixed(1)}</td><td className="number">{formatPercent(contribution.phaseAllocation)}</td><td className="number">{contribution.runLoad.toFixed(2)}</td><td className="number">{contribution.setupLoad.toFixed(2)}</td><td className="number"><strong>{contribution.totalLoad.toFixed(2)}</strong></td></tr>)}</tbody></table></div>{explanation.contributions.length > 100 ? <small className="table-note">Showing the 100 largest contributions of {explanation.contributions.length}.</small> : null}</div></section> : null}
  </div>;
}
