import { useEffect, useMemo, useState } from "react";
import type { CapacityModel, FootprintPlan, PlanningWipBasis, WorkingCalendar } from "@capacity/domain";
import type { WorkbenchEditorProps } from "./editorTypes.js";
import { createWorkbenchId as newId, optionalText } from "./editorTypes.js";

interface FootprintWipEditorProps extends WorkbenchEditorProps {
  scenarioId: string;
}

export interface FootprintPoint {
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

export function pointsForFootprintPlan(model: CapacityModel, plan: FootprintPlan, scenarioId: string): FootprintPoint[] {
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
  const height = 330;
  const margin = { top: 24, right: 28, bottom: 58, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = Math.max(1, ...points.flatMap(point => [point.required, point.available])) * 1.08;
  const groupWidth = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(5, Math.min(28, groupWidth * .58));
  const x = (index: number) => margin.left + groupWidth * index + groupWidth / 2;
  const y = (value: number) => margin.top + plotHeight - value / maximum * plotHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.available)}`).join(" ");
  const ticks = points.map((_, index) => index).filter(index => points.length <= 12 || index % Math.ceil(points.length / 10) === 0 || index === points.length - 1);
  return <div className="chart-frame footprint-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Required footprint bars and available space line">
    {[0,.25,.5,.75,1].map(fraction => { const value = maximum * fraction; return <g key={fraction}><line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{Math.round(value).toLocaleString()}</text></g>; })}
    {points.map((point, index) => <rect key={point.key} className={`footprint-bar ${(point.utilization ?? 0) > 1 ? "over" : ""}`} x={x(index) - barWidth / 2} y={y(point.required)} width={barWidth} height={Math.max(1, margin.top + plotHeight - y(point.required))}><title>{`${point.label} · required ${point.required.toFixed(1)} · ${point.source} WIP`}</title></rect>)}
    <path d={path} className="chart-line footprint-capacity" />
    {points.map((point, index) => <circle key={`${point.key}-capacity`} className="chart-point footprint-capacity" cx={x(index)} cy={y(point.available)} r="4" />)}
    {ticks.map(index => <text key={points[index]?.key} className="chart-x-label" x={x(index)} y={height - 22} textAnchor="middle">{points[index]?.label}</text>)}
  </svg><div className="chart-legend"><span><i className="footprint-required" />Required footprint</span><span><i className="footprint-capacity" />Available capacity</span></div></div>;
}

export default function FootprintWipEditor({ draft, mutate, targetRecordId, onSelectRecord, scenarioId }: FootprintWipEditorProps) {
  const plans = draft.footprintPlans ?? [];
  const targetPlan = plans.find(plan => plan.id === targetRecordId);
  const [selectedPlanId, setSelectedPlanId] = useState(targetPlan?.id ?? plans[0]?.id ?? "");
  const selectedPlan = plans.find(plan => plan.id === selectedPlanId) ?? plans[0];
  const points = useMemo(() => selectedPlan ? pointsForFootprintPlan(draft, selectedPlan, scenarioId) : [], [draft, selectedPlan, scenarioId]);
  const peak = [...points].sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))[0];

  useEffect(() => {
    if (targetPlan) setSelectedPlanId(targetPlan.id);
  }, [targetPlan]);

  function selectPlan(id: string): void {
    setSelectedPlanId(id);
    onSelectRecord?.(id);
  }

  function addPlan(): void {
    const id = newId("footprint");
    mutate("footprint", next => {
      next.footprintPlans ??= [];
      next.footprintPlans.push({ id, departmentOrArea: "New area", ...(next.calendars[0]?.id ? { calendarId: next.calendars[0].id } : {}), dwellWorkingDays: 5, spacePerUnit: 10, basis: "squareFeet", availableCapacity: 1000, peakFactor: 1.2, confidence: "unknown" });
    });
    selectPlan(id);
  }

  function addWip(): void {
    const productId = draft.products[0]?.id;
    if (!productId) return;
    const id = newId("wip");
    mutate("footprint", next => { next.planningWip ??= []; next.planningWip.push({ id, scenarioId, productId, periodStart: `${next.horizonStart.slice(0, 7)}-01`, quantity: 0, basis: "reported", confidence: "unknown" }); });
    onSelectRecord?.(id);
  }

  return <div className="workbench-editor">
    <div className="editor-toolbar"><label>Area / plan<select value={selectedPlan?.id ?? ""} onChange={event => selectPlan(event.target.value)}><option value="">Select a plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.departmentOrArea}</option>)}</select></label><button className="secondary" type="button" onClick={addPlan}>Add footprint plan</button><button className="secondary" type="button" onClick={addWip} disabled={!draft.products.length}>Add reported WIP</button></div>
    {selectedPlan ? <>
      <div className="metric-grid four"><div className="metric"><span>Peak required</span><strong>{peak?.required.toFixed(0) ?? "—"}</strong><small>{selectedPlan.basis}</small></div><div className="metric"><span>Available</span><strong>{selectedPlan.availableCapacity.toFixed(0)}</strong><small>{selectedPlan.departmentOrArea}</small></div><div className="metric"><span>Peak utilization</span><strong>{peak?.utilization === null || peak?.utilization === undefined ? "—" : `${Math.round(peak.utilization * 100)}%`}</strong><small>{peak?.label ?? "No demand"}</small></div><div className="metric"><span>WIP basis at peak</span><strong>{peak?.source ?? "—"}</strong><small>Reported overrides derived</small></div></div>
      <div className="analysis-card wide"><div className="analysis-card-heading"><div><h3>Required footprint versus available space</h3><p>Bars use reported WIP when present; otherwise concurrent WIP is derived from demand and dwell.</p></div></div><FootprintChart points={points} /></div>
      <div className="table-card"><div className="card-title-row"><div><h3>Monthly footprint detail</h3><small>Planning context only; no inventory netting or production-load adjustment.</small></div></div><div className="table-wrap"><table><thead><tr><th>Period</th><th className="number">Demand</th><th className="number">Concurrent WIP</th><th>WIP basis</th><th className="number">Required</th><th className="number">Available</th><th className="number">Utilization</th></tr></thead><tbody>{points.map(point => <tr key={point.key}><td>{point.label}</td><td className="number">{point.demand.toFixed(0)}</td><td className="number">{point.concurrentWip.toFixed(1)}</td><td>{point.source}</td><td className="number">{point.required.toFixed(1)}</td><td className="number">{point.available.toFixed(1)}</td><td className={`number ${(point.utilization ?? 0) > 1 ? "negative" : ""}`}>{point.utilization === null ? "—" : `${Math.round(point.utilization * 100)}%`}</td></tr>)}</tbody></table></div></div>
    </> : <div className="empty-state"><h3>No footprint plan yet</h3><p>Add an area with dwell, space per unit, available capacity, and peak factor.</p><button className="primary" type="button" onClick={addPlan}>Add footprint plan</button></div>}

    <div className="table-card"><div className="card-title-row"><div><h3>Footprint assumptions</h3><small>Dwell models concurrent occupancy. It does not shift labor or equipment load.</small></div></div><div className="table-wrap"><table><thead><tr><th>Area</th><th>Product</th><th>Calendar</th><th className="number">Dwell days</th><th className="number">Space / unit</th><th>Basis</th><th className="number">Available</th><th className="number">Peak factor</th><th>Confidence</th><th>Source</th><th /></tr></thead><tbody>{plans.map(plan => <tr key={plan.id} className={selectedPlan?.id === plan.id ? "selected-row" : ""} onClick={() => selectPlan(plan.id)}><td><input value={plan.departmentOrArea} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target.departmentOrArea = event.target.value; })} /></td><td><select value={plan.productId ?? ""} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (!target) return; delete target.productFamily; if (event.target.value) target.productId = event.target.value; else delete target.productId; })}><option value="">All products</option>{draft.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td><select value={plan.calendarId ?? ""} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (!target) return; if (event.target.value) target.calendarId = event.target.value; else delete target.calendarId; })}><option value="">Default calendar</option>{draft.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></td>{(["dwellWorkingDays","spacePerUnit"] as const).map(field => <td key={field}><input className="number-input" type="number" min="0" step="0.1" value={plan[field]} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target[field] = Number(event.target.value); })} /></td>)}<td><select value={plan.basis} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target.basis = event.target.value as FootprintPlan["basis"]; })}>{["squareFeet","palletPositions","custom"].map(value => <option key={value} value={value}>{value}</option>)}</select></td>{(["availableCapacity","peakFactor"] as const).map(field => <td key={field}><input className="number-input" type="number" min="0" step="0.1" value={plan[field]} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target[field] = Number(event.target.value); })} /></td>)}<td><select value={plan.confidence ?? "unknown"} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) target.confidence = event.target.value as NonNullable<FootprintPlan["confidence"]>; })}>{["high","medium","low","unknown"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input value={plan.source ?? ""} onChange={event => mutate("footprint", next => { const target = next.footprintPlans?.find(item => item.id === plan.id); if (target) optionalText(target as unknown as Record<string, unknown>, "source", event.target.value); })} /></td><td><button className="text-danger" type="button" onClick={event => { event.stopPropagation(); mutate("footprint", next => { next.footprintPlans = next.footprintPlans?.filter(item => item.id !== plan.id); }); }}>Remove</button></td></tr>)}</tbody></table></div></div>

    <div className="table-card"><div className="card-title-row"><div><h3>Reported or estimated WIP</h3><small>A product-period record overrides derived WIP for matching footprint plans.</small></div></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Product</th><th>Period</th><th className="number">Quantity</th><th>Basis</th><th>Confidence</th><th>Notes</th><th /></tr></thead><tbody>{(draft.planningWip ?? []).filter(record => record.scenarioId === scenarioId).map(record => <tr key={record.id} className={targetRecordId === record.id ? "selected-row" : ""} onClick={() => onSelectRecord?.(record.id)}><td><code>{record.id}</code></td><td><select value={record.productId} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.productId = event.target.value; })}>{draft.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td><input type="month" value={record.periodStart.slice(0, 7)} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.periodStart = `${event.target.value}-01`; })} /></td><td><input className="number-input" type="number" min="0" step="0.1" value={record.quantity} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.quantity = Number(event.target.value); })} /></td><td><select value={record.basis} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.basis = event.target.value as PlanningWipBasis; })}>{["reported","estimated","derived"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><select value={record.confidence ?? "unknown"} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) target.confidence = event.target.value as "high" | "medium" | "low" | "unknown"; })}>{["high","medium","low","unknown"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input value={record.notes ?? ""} onChange={event => mutate("footprint", next => { const target = next.planningWip?.find(item => item.id === record.id); if (target) optionalText(target as unknown as Record<string, unknown>, "notes", event.target.value); })} /></td><td><button className="text-danger" type="button" onClick={event => { event.stopPropagation(); mutate("footprint", next => { next.planningWip = next.planningWip?.filter(item => item.id !== record.id); }); }}>Remove</button></td></tr>)}</tbody></table></div></div>
  </div>;
}
