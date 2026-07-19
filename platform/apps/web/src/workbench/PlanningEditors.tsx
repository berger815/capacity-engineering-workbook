import { useMemo, useState } from "react";
import type {
  ActionLogCategory,
  CapacityModel,
  FootprintPlan,
  PlanningWipBasis,
  WorkingCalendar,
} from "@capacity/domain";
import type { ModelMutator } from "./CoreDataEditors.js";

interface EditorProps {
  model: CapacityModel;
  mutate: ModelMutator;
  scenarioId: string;
  targetId?: string;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function optionalText(target: Record<string, unknown>, key: string, value: string): void {
  if (value.trim()) target[key] = value.trim();
  else delete target[key];
}

export function DemandEditor({ model, mutate, scenarioId, targetId }: EditorProps) {
  const [productId, setProductId] = useState("all");
  const records = model.demand
    .filter(record => record.scenarioId === scenarioId)
    .filter(record => productId === "all" || record.productId === productId)
    .sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  const total = records.reduce((sum, record) => sum + record.quantity, 0);

  function addDemand(): void {
    const targetProduct = productId === "all" ? model.products[0]?.id : productId;
    if (!targetProduct) return;
    mutate("demand", next => next.demand.push({ id: newId("demand"), scenarioId, productId: targetProduct, shipDate: next.horizonStart, quantity: 0, demandClass: "forecast", sourceSystem: "Assessment Studio edit" }));
  }

  return <><div className="workbench-editor-toolbar"><label>Product<select value={productId} onChange={event => setProductId(event.target.value)}><option value="all">All products</option>{model.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><div className="toolbar-metric"><span>Displayed quantity</span><strong>{total.toLocaleString()}</strong></div><button className="secondary" type="button" onClick={addDemand} disabled={!model.products.length}>Add demand row</button></div>
    <div className="table-card"><div className="card-title-row"><div><h3>Demand records</h3><small>Ship-date demand. Lead-time phases determine when the capacity load occurs.</small></div></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Product</th><th>Ship date</th><th className="number">Quantity</th><th>Class</th><th>Program / customer</th><th /></tr></thead><tbody>{records.map(record => <tr key={record.id} className={targetId === record.id ? "selected-row" : ""}><td><code>{record.id}</code></td><td><select value={record.productId} onChange={event => mutate("demand", next => { const found = next.demand.find(item => item.id === record.id); if (found) found.productId = event.target.value; })}>{model.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td><input type="date" value={record.shipDate} onChange={event => mutate("demand", next => { const found = next.demand.find(item => item.id === record.id); if (found) found.shipDate = event.target.value; })} /></td><td><input className="number-input" type="number" min="0" step="1" value={record.quantity} onChange={event => mutate("demand", next => { const found = next.demand.find(item => item.id === record.id); if (found) found.quantity = Number(event.target.value); })} /></td><td><select value={record.demandClass ?? "forecast"} onChange={event => mutate("demand", next => { const found = next.demand.find(item => item.id === record.id); if (found) found.demandClass = event.target.value as "firm" | "forecast" | "upside" | "downside"; })}>{["firm","forecast","upside","downside"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input value={record.customerOrProgram ?? ""} onChange={event => mutate("demand", next => { const found = next.demand.find(item => item.id === record.id); if (found) optionalText(found as unknown as Record<string, unknown>, "customerOrProgram", event.target.value); })} /></td><td><button className="text-danger" type="button" onClick={() => mutate("demand", next => { next.demand = next.demand.filter(item => item.id !== record.id); })}>Remove</button></td></tr>)}</tbody></table></div></div></>;
}

interface FootprintPoint {
  key: string;
  label: string;
  demand: number;
  concurrentWip: number;
  required: number;
  available: number;
  utilization: number | null;
  source: "reported" | "derived";
}

function monthStarts(start: string, end: string): string[] {
  const values: string[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const finish = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= finish) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return values;
}

function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function workingDaysInMonth(periodStart: string, calendar: WorkingCalendar | undefined): number {
  const cursor = new Date(`${periodStart}T00:00:00Z`);
  const month = cursor.getUTCMonth();
  let days = 0;
  while (cursor.getUTCMonth() === month) {
    const date = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const exception = calendar?.exceptions.find(item => item.date === date);
    const minutes = exception?.availableMinutes ?? calendar?.weeklyMinutes[weekday] ?? (weekday > 0 && weekday < 6 ? 480 : 0);
    if (minutes > 0) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(days, 1);
}

function planProducts(model: CapacityModel, plan: FootprintPlan): string[] {
  if (plan.productId) return [plan.productId];
  if (plan.productFamily) return model.products.filter(product => product.family === plan.productFamily).map(product => product.id);
  return model.products.map(product => product.id);
}

function pointsForPlan(model: CapacityModel, plan: FootprintPlan, scenarioId: string): FootprintPoint[] {
  const productIds = new Set(planProducts(model, plan));
  const calendar = model.calendars.find(item => item.id === plan.calendarId) ?? model.calendars[0];
  return monthStarts(model.horizonStart, model.horizonEnd).map(periodStart => {
    const key = periodStart.slice(0, 7);
    const demand = model.demand.filter(record => record.scenarioId === scenarioId && productIds.has(record.productId) && record.shipDate.startsWith(key)).reduce((sum, record) => sum + record.quantity, 0);
    const reported = (model.planningWip ?? []).filter(record => record.scenarioId === scenarioId && productIds.has(record.productId) && record.periodStart.startsWith(key));
    const derived = demand * plan.dwellWorkingDays / workingDaysInMonth(periodStart, calendar);
    const concurrentWip = reported.length > 0 ? reported.reduce((sum, record) => sum + record.quantity, 0) : derived;
    const required = concurrentWip * plan.spacePerUnit * plan.peakFactor;
    return { key, label: monthLabel(periodStart), demand, concurrentWip, required, available: plan.availableCapacity, utilization: plan.availableCapacity > 0 ? required / plan.availableCapacity : null, source: reported.length > 0 ? "reported" : "derived" };
  });
}

function FootprintChart({ points }: { points: FootprintPoint[] }) {
  const width = 980;
  const height = 300;
  const margin = { top: 20, right: 24, bottom: 54, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = Math.max(1, ...points.flatMap(point => [point.required, point.available])) * 1.08;
  const groupWidth = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(5, Math.min(28, groupWidth * .58));
  const x = (index: number) => margin.left + groupWidth * index + groupWidth / 2;
  const y = (value: number) => margin.top + plotHeight - value / maximum * plotHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.available)}`).join(" ");
  const ticks = points.map((_, index) => index).filter(index => points.length <= 12 || index % Math.ceil(points.length / 10) === 0 || index === points.length - 1);
  return <div className="chart-frame footprint-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Required footprint bars and available space line">{[0,.25,.5,.75,1].map(fraction => { const value = maximum * fraction; return <g key={fraction}><line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{Math.round(value).toLocaleString()}</text></g>; })}{points.map((point, index) => <rect key={point.key} className={`footprint-bar ${(point.utilization ?? 0) > 1 ? "over" : ""}`} x={x(index) - barWidth / 2} y={y(point.required)} width={barWidth} height={Math.max(1, margin.top + plotHeight - y(point.required))}><title>{`${point.label} · required ${point.required.toFixed(1)} · ${point.source} WIP`}</title></rect>)}<path d={path} className="chart-line footprint-capacity" />{points.map((point, index) => <circle key={`${point.key}-capacity`} className="chart-point footprint-capacity" cx={x(index)} cy={y(point.available)} r="4" />)}{ticks.map(index => <text key={points[index]?.key} className="chart-x-label" x={x(index)} y={height - 20} textAnchor="middle">{points[index]?.label}</text>)}</svg><div className="chart-legend"><span><i className="footprint-required" />Required footprint</span><span><i className="footprint-capacity" />Available capacity</span></div></div>;
}

export function FootprintWipEditor({ model, mutate, scenarioId, targetId }: EditorProps) {
  const [selectedPlanId, setSelectedPlanId] = useState(targetId ?? model.footprintPlans?.[0]?.id ?? "");
  const plans = model.footprintPlans ?? [];
  const selectedPlan = plans.find(plan => plan.id === selectedPlanId) ?? plans[0];
  const points = useMemo(() => selectedPlan ? pointsForPlan(model, selectedPlan, scenarioId) : [], [model, selectedPlan, scenarioId]);
  const peak = [...points].sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))[0];

  function addPlan(): void {
    const id = newId("footprint");
    mutate("footprint", next => { next.footprintPlans ??= []; next.footprintPlans.push({ id, departmentOrArea: "New area", calendarId: next.calendars[0]?.id, dwellWorkingDays: 5, spacePerUnit: 10, basis: "squareFeet", availableCapacity: 1000, peakFactor: 1.2, confidence: "unknown" }); });
    setSelectedPlanId(id);
  }

  function addWip(): void {
    const productId = model.products[0]?.id;
    if (!productId) return;
    mutate("footprint", next => { next.planningWip ??= []; next.planningWip.push({ id: newId("wip"), scenarioId, productId, periodStart: `${next.horizonStart.slice(0, 7)}-01`, quantity: 0, basis: "reported", confidence: "unknown" }); });
  }

  return <><div className="workbench-editor-toolbar"><label>Area / plan<select value={selectedPlan?.id ?? ""} onChange={event => setSelectedPlanId(event.target.value)}><option value="">Select a plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.departmentOrArea}</option>)}</select></label><button className="secondary" type="button" onClick={addPlan}>Add footprint plan</button><button className="secondary" type="button" onClick={addWip} disabled={!model.products.length}>Add reported WIP</button></div>
    {selectedPlan ? <><div className="metric-grid four compact"><div className="metric"><span>Peak required</span><strong>{peak?.required.toFixed(0) ?? "—"}</strong><small>{selectedPlan.basis}</small></div><div className="metric"><span>Available</span><strong>{selectedPlan.availableCapacity.toFixed(0)}</strong><small>{selectedPlan.departmentOrArea}</small></div><div className="metric"><span>Peak utilization</span><strong>{peak?.utilization === null || peak?.utilization === undefined ? "—" : `${Math.round(peak.utilization * 100)}%`}</strong><small>{peak?.label ?? "No demand"}</small></div><div className="metric"><span>WIP basis</span><strong>{peak?.source ?? "—"}</strong><small>Reported overrides derived</small></div></div><div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Required footprint versus available space</h3><p>Dwell drives occupancy only; it does not shift labor or equipment load.</p></div></div><FootprintChart points={points} /></div></> : null}
    <div className="table-card"><div className="card-title-row"><div><h3>Footprint assumptions</h3><small>Product may be blank to apply the area to the full portfolio.</small></div></div><div className="table-wrap"><table><thead><tr><th>Area</th><th>Product</th><th>Calendar</th><th className="number">Dwell days</th><th className="number">Space / unit</th><th>Basis</th><th className="number">Available</th><th className="number">Peak factor</th><th>Confidence</th><th>Source</th><th /></tr></thead><tbody>{plans.map(plan => <tr key={plan.id} className={selectedPlan?.id === plan.id ? "selected-row" : ""} onClick={() => setSelectedPlanId(plan.id)}><td><input value={plan.departmentOrArea} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target.departmentOrArea = event.target.value; })} /></td><td><select value={plan.productId ?? ""} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (!target) return; delete target.productFamily; if (event.target.value) target.productId = event.target.value; else delete target.productId; })}><option value="">All products</option>{model.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td><select value={plan.calendarId ?? ""} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (!target) return; if (event.target.value) target.calendarId = event.target.value; else delete target.calendarId; })}><option value="">Default calendar</option>{model.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></td>{(["dwellWorkingDays","spacePerUnit"] as const).map(field => <td key={field}><input className="number-input" type="number" min="0" step="0.1" value={plan[field]} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target[field] = Number(event.target.value); })} /></td>)}<td><select value={plan.basis} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target.basis = event.target.value as FootprintPlan["basis"]; })}>{["squareFeet","palletPositions","custom"].map(value => <option key={value} value={value}>{value}</option>)}</select></td>{(["availableCapacity","peakFactor"] as const).map(field => <td key={field}><input className="number-input" type="number" min="0" step="0.1" value={plan[field]} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target[field] = Number(event.target.value); })} /></td>)}<td><select value={plan.confidence ?? "unknown"} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target.confidence = event.target.value as "high" | "medium" | "low" | "unknown"; })}>{["high","medium","low","unknown"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input value={plan.source ?? ""} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) optionalText(target as unknown as Record<string, unknown>, "source", event.target.value); })} /></td><td><button className="text-danger" type="button" onClick={() => mutate("footprint", next => { next.footprintPlans = next.footprintPlans?.filter(item => item.id !== plan.id); })}>Remove</button></td></tr>)}</tbody></table></div></div>
    <div className="table-card"><div className="card-title-row"><div><h3>Planning WIP</h3><small>Display and footprint context only. It never nets demand.</small></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Period</th><th className="number">Quantity</th><th>Basis</th><th>Confidence</th><th>Source</th><th>Notes</th><th /></tr></thead><tbody>{(model.planningWip ?? []).filter(item => item.scenarioId === scenarioId).map(record => <tr key={record.id}><td><select value={record.productId} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.productId = event.target.value; })}>{model.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td><input type="date" value={record.periodStart} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.periodStart = event.target.value; })} /></td><td><input className="number-input" type="number" min="0" value={record.quantity} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.quantity = Number(event.target.value); })} /></td><td><select value={record.basis} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.basis = event.target.value as PlanningWipBasis; })}>{["estimated","reported","derived"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><select value={record.confidence ?? "unknown"} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.confidence = event.target.value as "high" | "medium" | "low" | "unknown"; })}>{["high","medium","low","unknown"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input value={record.sourceSystem ?? ""} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) optionalText(target as unknown as Record<string, unknown>, "sourceSystem", event.target.value); })} /></td><td><input value={record.notes ?? ""} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) optionalText(target as unknown as Record<string, unknown>, "notes", event.target.value); })} /></td><td><button className="text-danger" type="button" onClick={() => mutate("footprint", next => { next.planningWip = next.planningWip?.filter(item => item.id !== record.id); })}>Remove</button></td></tr>)}</tbody></table></div></div></>;
}

const categories: ActionLogCategory[] = ["data", "assumption", "risk", "decision", "followUp", "general"];

export function ActionLogEditor({ model, mutate, targetId }: EditorProps) {
  const [category, setCategory] = useState<ActionLogCategory | "all">("all");
  const [showResolved, setShowResolved] = useState(true);
  const entries = useMemo(() => [...(model.actionLog ?? [])].filter(entry => category === "all" || entry.category === category).filter(entry => showResolved || !entry.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [model.actionLog, category, showResolved]);

  function addEntry(): void {
    mutate("actions", next => { next.actionLog ??= []; next.actionLog.unshift({ id: newId("log"), createdAt: new Date().toISOString(), category: "general", note: "New assessment note" }); });
  }

  return <><div className="workbench-editor-toolbar"><label>Category<select value={category} onChange={event => setCategory(event.target.value as ActionLogCategory | "all")}><option value="all">All categories</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="checkbox"><input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} /> Show resolved</label><button className="primary" type="button" onClick={addEntry}>Add log entry</button></div><div className="metric-grid four compact"><div className="metric"><span>Total entries</span><strong>{model.actionLog?.length ?? 0}</strong></div><div className="metric"><span>Open</span><strong>{model.actionLog?.filter(entry => !entry.resolvedAt).length ?? 0}</strong></div><div className="metric"><span>Due</span><strong>{model.actionLog?.filter(entry => !entry.resolvedAt && entry.dueDate && entry.dueDate <= new Date().toISOString().slice(0, 10)).length ?? 0}</strong></div><div className="metric"><span>Decisions</span><strong>{model.actionLog?.filter(entry => entry.category === "decision").length ?? 0}</strong></div></div>
    <div className="table-card"><div className="table-wrap"><table><thead><tr><th>Status</th><th>Category</th><th>Note</th><th>Owner</th><th>Due</th><th>Related entity</th><th>Created</th><th /></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className={`${entry.resolvedAt ? "resolved-row" : ""} ${targetId === entry.id ? "selected-row" : ""}`}><td><button type="button" className={`status-toggle ${entry.resolvedAt ? "resolved" : "open"}`} onClick={() => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (target.resolvedAt) delete target.resolvedAt; else target.resolvedAt = new Date().toISOString(); })}>{entry.resolvedAt ? "Resolved" : "Open"}</button></td><td><select value={entry.category} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) target.category = event.target.value as ActionLogCategory; })}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></td><td><textarea value={entry.note} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) target.note = event.target.value; })} /></td><td><input value={entry.owner ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "owner", event.target.value); })} /></td><td><input type="date" value={entry.dueDate ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "dueDate", event.target.value); })} /></td><td><div className="related-fields"><input placeholder="Type" value={entry.relatedEntityType ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "relatedEntityType", event.target.value); })} /><input placeholder="ID" value={entry.relatedEntityId ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "relatedEntityId", event.target.value); })} /></div></td><td><time>{entry.createdAt.slice(0, 10)}</time></td><td><button className="text-danger" type="button" onClick={() => mutate("actions", next => { next.actionLog = next.actionLog?.filter(item => item.id !== entry.id); })}>Remove</button></td></tr>)}</tbody></table></div>{entries.length === 0 ? <div className="empty-state compact"><h3>No matching log entries</h3><p>Add a data gap, assumption, risk, decision, or follow-up note.</p></div> : null}</div></>;
}
