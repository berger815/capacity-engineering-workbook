import { useEffect, useMemo, useState } from "react";
import type {
  CalculationResult,
  CapacityModel,
  ResourceKind,
  ResourcePeriodResult,
  ScenarioComparisonResult,
} from "@capacity/domain";
import ConstraintExplorer from "./ConstraintExplorer.js";
import { formatPercent } from "./analysis.js";
import {
  aggregateResourceResults,
  buildFtePoints,
  highestUtilization,
  resourceQuantityAt,
  riskBand,
  type AggregatedResourcePoint,
  type ExploreResolution,
} from "./exploration.js";
import type { WorkbenchTarget } from "./workbench/entityDefinitions.js";
import "./analysis-explorer.css";

interface AnalysisExplorerProps {
  model: CapacityModel;
  baseline: CalculationResult;
  comparison: ScenarioComparisonResult | null;
  onBack: () => void;
  onContinue: () => void;
  onEditModel: (target: WorkbenchTarget) => void;
}

type ExploreView = "capacity" | "gaps" | "demand" | "headcount" | "leadtime";
type CompareMode = "baseline" | "overlay";

interface ChartSeries {
  label: string;
  values: Array<number | null>;
  className: string;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(1);
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function LineChart({ labels, series, valueFormatter = formatNumber, referenceLines = [], emptyMessage = "No data is available for this selection." }: {
  labels: string[];
  series: ChartSeries[];
  valueFormatter?: (value: number) => string;
  referenceLines?: Array<{ value: number; label: string; className: string }>;
  emptyMessage?: string;
}) {
  const width = 980;
  const height = 340;
  const margin = { top: 26, right: 28, bottom: 58, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const finite = [...series.flatMap(item => item.values), ...referenceLines.map(item => item.value)].filter((value): value is number => value !== null && Number.isFinite(value));
  if (labels.length === 0 || finite.length === 0) return <div className="chart-empty">{emptyMessage}</div>;
  const minimum = Math.min(0, ...finite);
  const maximum = Math.max(...finite, minimum + 1);
  const padding = Math.max((maximum - minimum) * .08, maximum === 0 ? 1 : Math.abs(maximum) * .04);
  const minY = minimum < 0 ? minimum - padding : 0;
  const maxY = maximum + padding;
  const x = (index: number) => margin.left + (labels.length === 1 ? plotWidth / 2 : index * plotWidth / (labels.length - 1));
  const y = (value: number) => margin.top + (maxY - value) * plotHeight / (maxY - minY);
  const tickIndexes = labels.map((_, index) => index).filter(index => labels.length <= 12 || index % Math.ceil(labels.length / 10) === 0 || index === labels.length - 1);
  return <div className="chart-frame"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Time-series chart">{[0,.25,.5,.75,1].map(fraction => { const value = minY + (maxY - minY) * fraction; const py = y(value); return <g key={fraction}><line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={py} y2={py} /><text className="chart-axis-label" x={margin.left - 10} y={py + 4} textAnchor="end">{valueFormatter(value)}</text></g>; })}{referenceLines.map(reference => <g key={reference.label}><line className={`chart-reference ${reference.className}`} x1={margin.left} x2={width - margin.right} y1={y(reference.value)} y2={y(reference.value)} /><text className="chart-reference-label" x={width - margin.right} y={y(reference.value) - 6} textAnchor="end">{reference.label}</text></g>)}{series.map(item => { const segments: string[] = []; let current = ""; item.values.forEach((value, index) => { if (value === null || !Number.isFinite(value)) { if (current) segments.push(current); current = ""; return; } current += `${current ? " " : ""}${x(index)},${y(value)}`; }); if (current) segments.push(current); return <g key={item.label}>{segments.map((points, index) => <polyline key={index} className={`chart-line ${item.className}`} points={points} />)}{item.values.map((value, index) => value === null || !Number.isFinite(value) ? null : <circle key={index} className={`chart-point ${item.className}`} cx={x(index)} cy={y(value)} r="4"><title>{`${labels[index]} · ${item.label}: ${valueFormatter(value)}`}</title></circle>)}</g>; })}{tickIndexes.map(index => <text key={index} className="chart-x-label" x={x(index)} y={height - 22} textAnchor="middle">{labels[index]}</text>)}</svg><div className="chart-legend">{series.map(item => <span key={item.label}><i className={item.className} />{item.label}</span>)}</div></div>;
}

function LoadCapacityComboChart({ labels, load, capacity }: { labels: string[]; load: number[]; capacity: number[] }) {
  const width = 980;
  const height = 340;
  const margin = { top: 24, right: 28, bottom: 58, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = Math.max(1, ...load, ...capacity) * 1.08;
  const y = (value: number) => margin.top + plotHeight - value / maximum * plotHeight;
  const groupWidth = plotWidth / Math.max(labels.length, 1);
  const barWidth = Math.max(5, Math.min(30, groupWidth * .58));
  const x = (index: number) => margin.left + groupWidth * index + groupWidth / 2;
  const capacityPath = capacity.map((value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");
  const tickIndexes = labels.map((_, index) => index).filter(index => labels.length <= 12 || index % Math.ceil(labels.length / 10) === 0 || index === labels.length - 1);
  return <div className="chart-frame"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Demand bars and capacity line by period">{[0,.25,.5,.75,1].map(fraction => { const value = maximum * fraction; return <g key={fraction}><line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{formatNumber(value)}</text></g>; })}{load.map((value, index) => <rect key={index} className="timeline-bar" x={x(index) - barWidth / 2} y={y(value)} width={barWidth} height={Math.max(1, margin.top + plotHeight - y(value))}><title>{`${labels[index]} · Demand/load: ${formatNumber(value)}`}</title></rect>)}<path d={capacityPath} className="chart-line baseline-capacity" />{capacity.map((value, index) => <circle key={index} className="chart-point baseline-capacity" cx={x(index)} cy={y(value)} r="4"><title>{`${labels[index]} · Available capacity: ${formatNumber(value)}`}</title></circle>)}{tickIndexes.map(index => <text key={index} className="chart-x-label" x={x(index)} y={height - 22} textAnchor="middle">{labels[index]}</text>)}</svg><div className="chart-legend"><span><i className="demand-line" />Demand / load</span><span><i className="baseline-capacity" />Available capacity</span></div></div>;
}

function DemandBarChart({ labels, values }: { labels: string[]; values: number[] }) {
  const width = 980;
  const height = 300;
  const margin = { top: 20, right: 24, bottom: 54, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = Math.max(1, ...values) * 1.08;
  const groupWidth = plotWidth / Math.max(labels.length, 1);
  const barWidth = Math.max(6, Math.min(42, groupWidth * .65));
  const y = (value: number) => margin.top + plotHeight - value / maximum * plotHeight;
  return <div className="chart-frame"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Shipment demand bar chart">{[0,.25,.5,.75,1].map(fraction => { const value = maximum * fraction; return <g key={fraction}><line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={margin.left - 8} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g>; })}{values.map((value, index) => <rect key={index} className="timeline-bar" x={margin.left + groupWidth * index + (groupWidth - barWidth) / 2} y={y(value)} width={barWidth} height={Math.max(1, margin.top + plotHeight - y(value))}><title>{`${labels[index]} · ${value}`}</title></rect>)}{labels.map((label, index) => <text key={`${label}-${index}`} className="chart-x-label" x={margin.left + groupWidth * index + groupWidth / 2} y={height - 20} textAnchor="middle">{label}</text>)}</svg></div>;
}

function GapBarChart({ labels, baseline, recovery }: { labels: string[]; baseline: number[]; recovery?: number[] }) {
  const width = 980;
  const height = 340;
  const margin = { top: 24, right: 28, bottom: 58, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const all = [...baseline, ...(recovery ?? [])];
  const maxAbs = Math.max(1, ...all.map(value => Math.abs(value)));
  const y = (value: number) => margin.top + plotHeight / 2 - value / maxAbs * plotHeight / 2;
  const groupWidth = plotWidth / Math.max(labels.length, 1);
  const barWidth = Math.max(5, Math.min(22, groupWidth * (recovery ? .28 : .55)));
  const tickIndexes = labels.map((_, index) => index).filter(index => labels.length <= 12 || index % Math.ceil(labels.length / 10) === 0 || index === labels.length - 1);
  function bar(value: number, index: number, offset: number, className: string) { const zero = y(0); const py = y(value); const x = margin.left + groupWidth * index + groupWidth / 2 + offset - barWidth / 2; return <rect key={`${className}-${index}`} className={`gap-bar ${value < 0 ? "negative-bar" : "positive-bar"} ${className}`} x={x} y={Math.min(zero, py)} width={barWidth} height={Math.max(1, Math.abs(zero - py))}><title>{`${labels[index]} · ${value.toFixed(1)}`}</title></rect>; }
  return <div className="chart-frame"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Capacity gap chart"><line className="chart-zero" x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} /><text className="chart-axis-label" x={margin.left - 10} y={y(maxAbs) + 4} textAnchor="end">{formatNumber(maxAbs)}</text><text className="chart-axis-label" x={margin.left - 10} y={y(0) + 4} textAnchor="end">0</text><text className="chart-axis-label" x={margin.left - 10} y={y(-maxAbs) + 4} textAnchor="end">-{formatNumber(maxAbs)}</text>{baseline.map((value, index) => bar(value, index, recovery ? -barWidth * .58 : 0, "baseline-gap"))}{recovery?.map((value, index) => bar(value, index, barWidth * .58, "recovery-gap"))}{tickIndexes.map(index => <text key={index} className="chart-x-label" x={margin.left + groupWidth * index + groupWidth / 2} y={height - 22} textAnchor="middle">{labels[index]}</text>)}</svg><div className="chart-legend"><span><i className="baseline-gap" />Baseline gap</span>{recovery ? <span><i className="recovery-gap" />Recovery gap</span> : null}</div></div>;
}

function alignPoints(baseline: AggregatedResourcePoint[], recovery: AggregatedResourcePoint[] | null) {
  const recoveryByKey = new Map(recovery?.map(point => [point.key, point]) ?? []);
  return baseline.map(point => ({ baseline: point, recovery: recoveryByKey.get(point.key) ?? null }));
}

function demandBucket(date: string, resolution: ExploreResolution): { key: string; label: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (resolution === "year") return { key: String(year), label: String(year) };
  if (resolution === "quarter") { const quarter = Math.floor((month - 1) / 3) + 1; return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` }; }
  return { key: date.slice(0, 7), label: formatDateLabel(`${date.slice(0, 7)}-01`) };
}

function DemandExplorer({ model, scenarioId, resolution, onEdit }: { model: CapacityModel; scenarioId: string; resolution: ExploreResolution; onEdit: (target: WorkbenchTarget) => void }) {
  const [productId, setProductId] = useState("all");
  const records = model.demand.filter(record => record.scenarioId === scenarioId).filter(record => productId === "all" || record.productId === productId).sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  const grouped = new Map<string, { label: string; quantity: number }>();
  for (const record of records) { const target = demandBucket(record.shipDate, resolution); const current = grouped.get(target.key) ?? { label: target.label, quantity: 0 }; current.quantity += record.quantity; grouped.set(target.key, current); }
  const points = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  const productTotals = model.products.map(product => ({ product, quantity: model.demand.filter(record => record.scenarioId === scenarioId && record.productId === product.id).reduce((sum, record) => sum + record.quantity, 0) })).filter(item => item.quantity > 0).sort((a, b) => b.quantity - a.quantity);
  const total = productTotals.reduce((sum, item) => sum + item.quantity, 0);
  return <><div className="explorer-subfilters"><label>Product<select value={productId} onChange={event => setProductId(event.target.value)}><option value="all">All products</option>{model.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><button className="secondary" type="button" onClick={() => onEdit({ entity: "demand", returnTo: { step: "capacity", label: "Capacity Analysis", view: "demand" } })}>Edit demand in Workbench</button></div><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Shipment demand profile</h3><p>Demand is shown as bars at ship date. Capacity load is shifted earlier by the lead-time model.</p></div></div><DemandBarChart labels={points.map(point => point.label)} values={points.map(point => point.quantity)} /></div><div className="table-card"><div className="card-title-row"><div><h3>Demand detail</h3><small>Read-only analytical view. Use the Workbench to change source records.</small></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Ship date</th><th className="number">Quantity</th><th>Class</th><th>Program</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td>{model.products.find(product => product.id === record.productId)?.name ?? record.productId}</td><td>{record.shipDate}</td><td className="number">{record.quantity.toLocaleString()}</td><td>{record.demandClass ?? "forecast"}</td><td>{record.customerOrProgram ?? "—"}</td></tr>)}</tbody></table></div></div><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Product mix</h3><p>Share of baseline demand across the selected horizon.</p></div><strong>{total.toLocaleString()} units</strong></div><div className="mix-list">{productTotals.map(item => <button type="button" key={item.product.id} onClick={() => setProductId(item.product.id)}><span><strong>{item.product.name}</strong><small>{item.quantity.toLocaleString()} units</small></span><span className="mix-track"><i style={{ width: `${total > 0 ? item.quantity / total * 100 : 0}%` }} /></span><b>{total > 0 ? `${Math.round(item.quantity / total * 100)}%` : "0%"}</b></button>)}</div></div></>;
}

function LeadTimeExplorer({ model, onEdit }: { model: CapacityModel; onEdit: (target: WorkbenchTarget) => void }) {
  const [productId, setProductId] = useState(model.products[0]?.id ?? "");
  useEffect(() => { if (!model.products.some(product => product.id === productId)) setProductId(model.products[0]?.id ?? ""); }, [model, productId]);
  const product = model.products.find(item => item.id === productId);
  const revision = model.routingRevisions.filter(item => item.productId === productId).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!product || !revision) return <div className="chart-empty">No effective routing revision is available.</div>;
  const phases = [...revision.phases].sort((a, b) => b.startWeeksBeforeShip - a.startWeeksBeforeShip);
  const maxWeeks = Math.max(1, ...phases.map(phase => Math.max(phase.startWeeksBeforeShip, phase.endWeeksBeforeShip)));
  const width = 980; const rowHeight = 72; const height = 76 + phases.length * rowHeight; const left = 170; const right = 40; const plotWidth = width - left - right; const x = (weeks: number) => left + (maxWeeks - weeks) / maxWeeks * plotWidth;
  const resourceNames = Object.fromEntries(model.resourceGroups.map(group => [group.id, group.name]));
  return <><div className="explorer-subfilters"><label>Product<select value={productId} onChange={event => setProductId(event.target.value)}>{model.products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="route-meta"><span>Revision</span><strong>{revision.revision}</strong><span>Effective</span><strong>{revision.effectiveFrom}</strong></div><button className="secondary" type="button" onClick={() => onEdit({ entity: "routing", recordId: revision.id, returnTo: { step: "capacity", label: `${product.name} lead-time analysis`, view: "leadtime" } })}>Edit routing and lead times</button></div><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Lead-time route timeline</h3><p>Work is positioned by weeks before ship. Ship date is the zero point on the right.</p></div><strong>{maxWeeks} weeks</strong></div><div className="timeline-scroll"><svg className="route-timeline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${product.name} lead-time route`}>{[0,...Array.from({ length: Math.ceil(maxWeeks / 4) }, (_, index) => Math.min(maxWeeks, (index + 1) * 4))].filter((value, index, array) => array.indexOf(value) === index).map(weeks => <g key={weeks}><line className="timeline-grid" x1={x(weeks)} x2={x(weeks)} y1="42" y2={height - 24} /><text className="timeline-axis" x={x(weeks)} y="26" textAnchor="middle">{weeks === 0 ? "Ship" : `${weeks}w`}</text></g>)}{phases.map((phase, index) => { const y = 58 + index * rowHeight; const operations = revision.operations.filter(operation => operation.phaseId === phase.id); const high = Math.max(phase.startWeeksBeforeShip, phase.endWeeksBeforeShip); const low = Math.min(phase.startWeeksBeforeShip, phase.endWeeksBeforeShip); return <g key={phase.id}><text className="timeline-phase" x="12" y={y + 18}>{phase.name}</text><text className="timeline-allocation" x="12" y={y + 36}>{phase.allocation}</text><rect className="timeline-bar" x={x(high)} y={y} width={Math.max(8, x(low) - x(high))} height="28" rx="6"><title>{`${phase.name}: ${high} to ${low} weeks before ship`}</title></rect><text className="timeline-bar-label" x={x(high) + 8} y={y + 19}>{operations.length} operation{operations.length === 1 ? "" : "s"}</text></g>; })}</svg></div></div><div className="table-card"><div className="card-title-row"><div><h3>Lead-time phase settings</h3><small>Read-only calculation basis.</small></div></div><div className="table-wrap"><table><thead><tr><th>Phase</th><th className="number">Start weeks before ship</th><th className="number">End weeks before ship</th><th>Allocation</th></tr></thead><tbody>{phases.map(phase => <tr key={phase.id}><td>{phase.name}</td><td className="number">{phase.startWeeksBeforeShip}</td><td className="number">{phase.endWeeksBeforeShip}</td><td>{phase.allocation}</td></tr>)}</tbody></table></div></div><div className="table-card route-table"><div className="card-title-row"><div><h3>Routing and resource detail</h3><small>Operations are sparse; only applicable resources appear.</small></div></div><div className="table-wrap"><table><thead><tr><th>Seq.</th><th>Operation</th><th>Lead-time phase</th><th>Resource requirement</th><th className="number">Standard</th><th>State</th></tr></thead><tbody>{[...revision.operations].sort((a, b) => a.sequence - b.sequence).flatMap(operation => operation.requirements.map(requirement => <tr key={`${operation.id}-${requirement.id}`}><td>{operation.sequence}</td><td><strong>{operation.name}</strong></td><td>{revision.phases.find(phase => phase.id === operation.phaseId)?.name ?? operation.phaseId}</td><td>{resourceNames[requirement.resourceGroupId] ?? requirement.resourceGroupId}</td><td className="number">{requirement.requirement.state === "value" ? requirement.requirement.value?.toFixed(3) : "—"}</td><td><span className={`state-pill ${requirement.requirement.state}`}>{requirement.requirement.state}</span></td></tr>))}</tbody></table></div></div></>;
}

function RiskHeatmap({ model, calculation, resolution, resourceKind, onSelectResource }: { model: CapacityModel; calculation: CalculationResult; resolution: ExploreResolution; resourceKind: ResourceKind | "all"; onSelectResource: (id: string) => void }) {
  const groups = model.resourceGroups.filter(group => resourceKind === "all" || group.kind === resourceKind);
  const ranked = groups.map(group => { const points = aggregateResourceResults(calculation.results, group.id, resolution); const maximum = Math.max(-1, ...points.map(point => point.utilization === null ? -1 : Number.isFinite(point.utilization) ? point.utilization : Number.MAX_SAFE_INTEGER)); return { group, points, maximum }; }).filter(item => item.points.some(point => point.load > 0)).sort((a, b) => b.maximum - a.maximum).slice(0, 10);
  const periodKeys = [...new Set(ranked.flatMap(item => item.points.map(point => point.key)))].sort();
  const labels = new Map(ranked.flatMap(item => item.points.map(point => [point.key, point.label])));
  return <div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Constraint heatmap</h3><p>Select a resource to move the charts and detail table to that constraint.</p></div></div><div className="heatmap-scroll"><div className="risk-heatmap" style={{ gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${periodKeys.length}, minmax(54px, 1fr))` }}><div className="heatmap-corner">Resource</div>{periodKeys.map(key => <div className="heatmap-period" key={key}>{labels.get(key)}</div>)}{ranked.flatMap(item => [<button type="button" className="heatmap-resource" key={`${item.group.id}-name`} onClick={() => onSelectResource(item.group.id)}>{item.group.name}<small>{item.group.kind}</small></button>, ...periodKeys.map(key => { const point = item.points.find(candidate => candidate.key === key); const band = riskBand(point?.utilization ?? null); return <button type="button" key={`${item.group.id}-${key}`} className={`heatmap-cell ${band}`} onClick={() => onSelectResource(item.group.id)} title={point ? `${item.group.name} · ${point.label} · ${formatPercent(point.utilization)}` : "No load"}>{point?.utilization === null || point?.utilization === undefined ? "—" : Number.isFinite(point.utilization) ? `${Math.round(point.utilization * 100)}%` : "∞"}</button>; })])}</div></div></div>;
}

export default function AnalysisExplorerReadOnly({ model, baseline, comparison, onBack, onContinue, onEditModel }: AnalysisExplorerProps) {
  const [view, setView] = useState<ExploreView>("capacity");
  const [resolution, setResolution] = useState<ExploreResolution>("native");
  const [resourceKind, setResourceKind] = useState<ResourceKind | "all">("all");
  const [resourceGroupId, setResourceGroupId] = useState(baseline.governingConstraint?.resourceGroupId ?? model.resourceGroups[0]?.id ?? "");
  const [compareMode, setCompareMode] = useState<CompareMode>(comparison ? "overlay" : "baseline");
  const availableKinds = useMemo(() => [...new Set(model.resourceGroups.map(group => group.kind))], [model]);
  const groups = useMemo(() => model.resourceGroups.filter(group => resourceKind === "all" || group.kind === resourceKind), [model, resourceKind]);
  useEffect(() => { if (!groups.some(group => group.id === resourceGroupId)) setResourceGroupId(groups[0]?.id ?? ""); }, [groups, resourceGroupId]);
  useEffect(() => { if (!comparison) setCompareMode("baseline"); }, [comparison]);
  const selectedGroup = model.resourceGroups.find(group => group.id === resourceGroupId);
  const baselinePoints = useMemo(() => aggregateResourceResults(baseline.results, resourceGroupId, resolution), [baseline, resourceGroupId, resolution]);
  const recoveryPoints = useMemo(() => comparison ? aggregateResourceResults(comparison.comparison.results, resourceGroupId, resolution) : null, [comparison, resourceGroupId, resolution]);
  const aligned = alignPoints(baselinePoints, recoveryPoints);
  const overlay = compareMode === "overlay" && comparison && recoveryPoints;
  const activeCalculation = overlay ? comparison.comparison : baseline;
  const worst = highestUtilization(activeCalculation.results, resourceGroupId);
  const nativeRows = activeCalculation.results.filter(row => row.resourceGroupId === resourceGroupId).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const riskRows = [...nativeRows].filter(row => row.load > 0).sort((a, b) => { const aScore = a.utilization === null ? -1 : Number.isFinite(a.utilization) ? a.utilization : Number.MAX_SAFE_INTEGER; const bScore = b.utilization === null ? -1 : Number.isFinite(b.utilization) ? b.utilization : Number.MAX_SAFE_INTEGER; return bScore - aScore; });
  const baselineFte = buildFtePoints(model, resourceGroupId, baselinePoints);
  const recoveryFte = recoveryPoints?.map(point => { const baselinePoint = baselinePoints.find(candidate => candidate.key === point.key); const baseAvailable = resourceQuantityAt(model, resourceGroupId, point.periodStart); const availableFte = baselinePoint && baselinePoint.capacity > 0 ? baseAvailable * point.capacity / baselinePoint.capacity : baseAvailable; const requiredFte = point.utilization === null || !Number.isFinite(point.utilization) ? null : availableFte * point.utilization; return { ...point, availableFte, requiredFte, fteGap: requiredFte === null ? null : availableFte - requiredFte }; }) ?? null;
  const gapCount = nativeRows.filter(row => row.gap < 0).length;
  const totalLoad = aligned.reduce((sum, point) => sum + (overlay && point.recovery ? point.recovery.load : point.baseline.load), 0);
  return <section className="panel explorer-panel"><div className="panel-heading"><div><span className="eyebrow blue">Step 5 · Explore</span><h2>Interrogate the capacity result</h2></div><p>Analysis is read-only. Contextual actions open the exact model record in the Workbench.</p></div><div className="explorer-toolbar"><label>Resolution<select value={resolution} onChange={event => setResolution(event.target.value as ExploreResolution)}><option value="native">{model.planningGranularity === "week" ? "Weekly" : "Monthly"}</option><option value="quarter">Quarterly</option><option value="year">Annual</option></select></label><label>Resource class<select value={resourceKind} onChange={event => setResourceKind(event.target.value as ResourceKind | "all")}><option value="all">All resource classes</option>{availableKinds.map(kind => <option value={kind} key={kind}>{kind}</option>)}</select></label><label>Resource group<select value={resourceGroupId} onChange={event => setResourceGroupId(event.target.value)}>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label>Scenario view<select value={compareMode} onChange={event => setCompareMode(event.target.value as CompareMode)}><option value="baseline">Baseline</option>{comparison ? <option value="overlay">Baseline vs recovery</option> : null}</select></label>{selectedGroup ? <button className="secondary" type="button" onClick={() => onEditModel({ entity: "resource-groups", recordId: selectedGroup.id, returnTo: { step: "capacity", label: `${selectedGroup.name} analysis`, view, resourceGroupId: selectedGroup.id } })}>Edit selected constraint</button> : null}</div><div className="explorer-tabs" role="tablist">{(["capacity","gaps","demand","headcount","leadtime"] as ExploreView[]).map(item => <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "capacity" ? "Load & utilization" : item === "gaps" ? "Gaps & constraints" : item === "demand" ? "Demand & product mix" : item === "headcount" ? "Headcount" : "Lead-time routes"}</button>)}</div>{view !== "demand" && view !== "leadtime" ? <div className="metric-grid four explorer-metrics"><div className="metric"><span>Selected resource</span><strong>{selectedGroup?.name ?? "—"}</strong><small>{selectedGroup ? `${selectedGroup.kind} · ${selectedGroup.capacityUnit}` : ""}</small></div><div className="metric"><span>Peak utilization</span><strong>{formatPercent(worst?.utilization ?? null)}</strong><small>{worst ? worst.periodStart : "No loaded period"}</small></div><div className="metric"><span>Gap periods</span><strong>{gapCount}</strong><small>At native calculation resolution</small></div><div className="metric"><span>Total displayed load</span><strong>{formatNumber(totalLoad)}</strong><small>{resolution === "native" ? model.planningGranularity : resolution}</small></div></div> : null}
    {view === "capacity" ? <><div className="analysis-grid"><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Demand/load versus available capacity</h3><p>{selectedGroup?.name} · bars show load; line shows capacity</p></div></div><LoadCapacityComboChart labels={aligned.map(point => point.baseline.label)} load={aligned.map(point => overlay && point.recovery ? point.recovery.load : point.baseline.load)} capacity={aligned.map(point => overlay && point.recovery ? point.recovery.capacity : point.baseline.capacity)} /></div><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Utilization by period</h3><p>85% is the watch threshold; 100% is the physical capacity line.</p></div></div><LineChart labels={aligned.map(point => point.baseline.label)} series={[{ label: "Baseline utilization", values: aligned.map(point => point.baseline.utilization === null ? null : point.baseline.utilization * 100), className: "baseline-utilization" }, ...(overlay ? [{ label: "Recovery utilization", values: aligned.map(point => point.recovery?.utilization === null || point.recovery?.utilization === undefined ? null : point.recovery.utilization * 100), className: "recovery-utilization" }] : [])]} valueFormatter={value => `${Math.round(value)}%`} referenceLines={[{ value: 85, label: "Watch 85%", className: "watch-line" }, { value: 100, label: "Capacity 100%", className: "capacity-line" }]} /></div></div><RiskHeatmap model={model} calculation={activeCalculation} resolution={resolution} resourceKind={resourceKind} onSelectResource={setResourceGroupId} /><ConstraintExplorer model={model} scenarioId={activeCalculation.scenarioId} rows={riskRows} title={`${selectedGroup?.name ?? "Resource"} period detail`} subtitle="Use Explain to reconcile a native period back to products, operations, lead-time phases, setup, and demand records." /></> : null}
    {view === "gaps" ? <><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Capacity balance by period</h3><p>Positive bars are remaining capacity. Negative bars are gaps that require action.</p></div></div><GapBarChart labels={aligned.map(point => point.baseline.label)} baseline={aligned.map(point => point.baseline.gap)} recovery={overlay ? aligned.map(point => point.recovery?.gap ?? 0) : undefined} /></div><RiskHeatmap model={model} calculation={activeCalculation} resolution={resolution} resourceKind={resourceKind} onSelectResource={setResourceGroupId} /><ConstraintExplorer model={model} scenarioId={activeCalculation.scenarioId} rows={riskRows} title="Constraint periods ranked by severity" subtitle="Select Explain for product, routing, standard-hour, setup, and demand lineage." /></> : null}
    {view === "demand" ? <DemandExplorer model={model} scenarioId={baseline.demandSourceScenarioId ?? baseline.scenarioId} resolution={resolution} onEdit={onEditModel} /> : null}
    {view === "headcount" ? selectedGroup?.kind !== "labor" ? <div className="callout amber"><span>Labor resource required</span><strong>Select a labor resource group to translate load and capacity into effective FTE equivalents.</strong></div> : <><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Required versus effective available FTE</h3><p>This converts the selected labor group’s utilization into FTE equivalents; it is not payroll headcount.</p></div></div><LineChart labels={baselineFte.map(point => point.label)} series={[{ label: "Baseline required FTE", values: baselineFte.map(point => point.requiredFte), className: "required-fte" }, { label: "Baseline available FTE", values: baselineFte.map(point => point.availableFte), className: "available-fte" }, ...(overlay && recoveryFte ? [{ label: "Recovery required FTE", values: recoveryFte.map(point => point.requiredFte), className: "recovery-required-fte" }, { label: "Recovery available FTE", values: recoveryFte.map(point => point.availableFte), className: "recovery-available-fte" }] : [])]} valueFormatter={value => value.toFixed(1)} /></div><div className="table-card"><div className="card-title-row"><div><h3>Headcount-equivalent detail</h3><small>Negative FTE gap means the modeled period requires more productive labor capacity.</small></div></div><div className="table-wrap"><table><thead><tr><th>Period</th><th className="number">Baseline required</th><th className="number">Baseline available</th><th className="number">Baseline gap</th>{overlay ? <><th className="number">Recovery required</th><th className="number">Recovery available</th><th className="number">Recovery gap</th></> : null}</tr></thead><tbody>{baselineFte.map((point, index) => <tr key={point.key}><td>{point.label}</td><td className="number">{point.requiredFte?.toFixed(1) ?? "—"}</td><td className="number">{point.availableFte.toFixed(1)}</td><td className={`number ${(point.fteGap ?? 0) < 0 ? "negative" : ""}`}>{point.fteGap?.toFixed(1) ?? "—"}</td>{overlay && recoveryFte ? <><td className="number">{recoveryFte[index]?.requiredFte?.toFixed(1) ?? "—"}</td><td className="number">{recoveryFte[index]?.availableFte.toFixed(1) ?? "—"}</td><td className={`number ${(recoveryFte[index]?.fteGap ?? 0) < 0 ? "negative" : ""}`}>{recoveryFte[index]?.fteGap?.toFixed(1) ?? "—"}</td></> : null}</tr>)}</tbody></table></div></div></> : null}
    {view === "leadtime" ? <LeadTimeExplorer model={model} onEdit={onEditModel} /> : null}
    <div className="panel-actions split"><button className="secondary" type="button" onClick={onBack}>Back to calculation</button><button className="primary" type="button" onClick={onContinue}>Continue to footprint</button></div>
  </section>;
}
