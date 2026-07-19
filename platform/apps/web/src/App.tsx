import { useEffect, useMemo, useState } from "react";
import type { CalculationResult, CapacityModel, ScenarioComparisonResult } from "@capacity/domain";
import {
  applyDemandImport,
  calculateModel,
  loadNorthstar,
  previewDemandImport,
  validateModel,
  type DemandImportPreview,
  type DemandMapping,
  type ModelValidationResult,
} from "./api.js";
import { formatPercent, rankConstraintPeriods, summarizeDecision } from "./analysis.js";
import AnalysisExplorer from "./AnalysisExplorer.js";
import ConstraintExplorer from "./ConstraintExplorer.js";
import DecisionExports from "./DecisionExports.js";
import RecoveryPanel from "./RecoveryPanel.js";
import { findBaselineScenarioId } from "./recovery.js";

const steps = [
  { id: "scope", label: "Scope", help: "Define the decision and boundaries" },
  { id: "data", label: "Data", help: "Load and reconcile the facts" },
  { id: "readiness", label: "Readiness", help: "Resolve decision-blocking gaps" },
  { id: "analysis", label: "Calculate", help: "Place load against capacity" },
  { id: "capacity", label: "Capacity Analysis", help: "Explore charts, gaps, and detail" },
  { id: "recovery", label: "Recovery", help: "Test governed countermeasures" },
  { id: "decision", label: "Decision", help: "Commit with evidence" },
] as const;

type StepId = typeof steps[number]["id"];
type BusyState = "loading" | "validating" | "previewing" | "applying" | "calculating" | null;

const defaultMapping: DemandMapping = {
  productColumn: "Product",
  shipDateColumn: "Ship Date",
  quantityColumn: "Quantity",
  productMatch: "name",
  dateFormat: "iso",
  defaultDemandClass: "forecast",
  sourceSystem: "Assessment Studio CSV",
};

function sampleCsv(model: CapacityModel): string {
  const rows = model.products.slice(0, 4).map((product, index) =>
    `"${product.name}",2027-${String(index + 1).padStart(2, "0")}-28,${25 + index * 10}`,
  );
  return ["Product,Ship Date,Quantity", ...rows].join("\n");
}

function resourceNameMap(model: CapacityModel | null): Record<string, string> {
  return Object.fromEntries(model?.resourceGroups.map(group => [group.id, group.name]) ?? []);
}

function StepNav({ active, onSelect }: { active: StepId; onSelect: (step: StepId) => void }) {
  return (
    <nav className="step-nav" aria-label="Assessment workflow">
      {steps.map((step, index) => (
        <button key={step.id} className={`step-button ${active === step.id ? "active" : ""}`} onClick={() => onSelect(step.id)} type="button">
          <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
          <span><strong>{step.label}</strong><small>{step.help}</small></span>
        </button>
      ))}
    </nav>
  );
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

function StatusBanner({ validation, calculation }: { validation: ModelValidationResult | null; calculation: CalculationResult | null }) {
  if (!validation) return <div className="status-banner neutral">Model readiness has not been checked.</div>;
  if (!validation.valid) return <div className="status-banner bad">The model has blocking validation issues.</div>;
  if (!calculation) return <div className="status-banner good">The model is structurally ready. Run the analysis to establish the decision.</div>;
  const blocking = calculation.issues.filter(issue => issue.severity === "error").length;
  return blocking > 0
    ? <div className="status-banner bad">Calculation completed with {blocking} blocking issue{blocking === 1 ? "" : "s"}.</div>
    : <div className="status-banner good">Baseline calculation completed. Capacity Analysis is ready for exploration.</div>;
}

export default function App() {
  const [activeStep, setActiveStep] = useState<StepId>("scope");
  const [model, setModel] = useState<CapacityModel | null>(null);
  const [validation, setValidation] = useState<ModelValidationResult | null>(null);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [comparison, setComparison] = useState<ScenarioComparisonResult | null>(null);
  const [busy, setBusy] = useState<BusyState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<DemandMapping>(defaultMapping);
  const [preview, setPreview] = useState<DemandImportPreview | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);

  const names = useMemo(() => resourceNameMap(model), [model]);
  const baselineScenarioId = model ? findBaselineScenarioId(model) : "baseline";
  const decisionCalculation = comparison?.comparison ?? calculation;
  const baselineDecision = comparison ? summarizeDecision(comparison.baseline, names) : calculation ? summarizeDecision(calculation, names) : null;
  const decision = decisionCalculation ? summarizeDecision(decisionCalculation, names) : null;
  const constraints = decisionCalculation ? rankConstraintPeriods(decisionCalculation, 10) : [];

  async function checkModel(candidate: CapacityModel): Promise<void> {
    setBusy("validating");
    const result = await validateModel(candidate);
    setValidation(result);
    setBusy(null);
  }

  async function loadDemo(): Promise<void> {
    try {
      setBusy("loading");
      setError(null);
      const fixture = await loadNorthstar();
      setModel(fixture);
      setCsv(sampleCsv(fixture));
      setCalculation(null);
      setComparison(null);
      setPreview(null);
      await checkModel(fixture);
    } catch (caught) {
      setBusy(null);
      setError(caught instanceof Error ? caught.message : "Unable to load the assessment model");
    }
  }

  useEffect(() => { void loadDemo(); }, []);

  async function runCalculation(): Promise<void> {
    if (!model) return;
    try {
      setBusy("calculating");
      setError(null);
      const result = await calculateModel(model, baselineScenarioId);
      setCalculation(result);
      setComparison(null);
      setActiveStep("capacity");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Calculation failed");
    } finally {
      setBusy(null);
    }
  }

  async function previewImport(): Promise<void> {
    if (!model) return;
    try {
      setBusy("previewing");
      setError(null);
      setPreview(await previewDemandImport(model, baselineScenarioId, csv, mapping));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "Import preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function applyImport(): Promise<void> {
    if (!model) return;
    try {
      setBusy("applying");
      setError(null);
      const applied = await applyDemandImport(model, baselineScenarioId, csv, mapping, acceptPartial);
      setModel(applied.model);
      setPreview(applied.import);
      setCalculation(null);
      setComparison(null);
      await checkModel(applied.model);
      setActiveStep("readiness");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import could not be applied");
      setBusy(null);
    }
  }

  function updateMapping<Key extends keyof DemandMapping>(key: Key, value: DemandMapping[Key]): void {
    setMapping(current => ({ ...current, [key]: value }));
    setPreview(null);
  }

  async function readFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setCsv(await file.text());
    setPreview(null);
  }

  function updateRecoveryModel(next: CapacityModel): void {
    setModel(next);
    setComparison(null);
  }

  const counts = validation?.counts;
  const issueCount = validation?.issues?.length ?? 0;
  const warningCount = decisionCalculation?.issues.filter(issue => issue.severity === "warning").length ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><span className="eyebrow">Manufacturing Capacity Assurance</span><h1>Assessment Studio</h1></div>
        <div className="topbar-actions">
          <span className={`connection ${error ? "offline" : ""}`}>{error ? "Needs attention" : "Local assessment"}</span>
          <button className="secondary light" type="button" onClick={() => void loadDemo()} disabled={busy !== null}>Reset Northstar demo</button>
        </div>
      </header>

      <div className="workspace">
        <aside>
          <div className="assessment-id"><span>Current assessment</span><strong>{model?.name ?? "Loading…"}</strong><small>{model ? `${model.horizonStart} → ${model.horizonEnd}` : ""}</small></div>
          <StepNav active={activeStep} onSelect={setActiveStep} />
          <div className="sidebar-note"><strong>Guided + analyst workflow</strong><p>Frame the decision, calculate once, interrogate the charts and detail, then build a governed recovery plan.</p></div>
        </aside>

        <main>
          {error ? <div className="error-panel"><strong>Action required</strong><span>{error}</span></div> : null}
          <StatusBanner validation={validation} calculation={calculation} />

          {activeStep === "scope" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow blue">Step 1</span><h2>Frame one decision, not the entire factory</h2></div><p>Northstar is a synthetic supplier assessment. It is loaded automatically so the workflow can be reviewed without customer data.</p></div>
              <div className="callout navy"><span>Decision</span><strong>Can Northstar support the 2027 demand ramp across its labor, equipment, tooling, and skill constraints?</strong></div>
              <div className="metric-grid four">
                <Metric label="Products" value={counts?.products ?? model?.products.length ?? "—"} note="Four distinct routes" />
                <Metric label="Resource groups" value={counts?.resourceGroups ?? model?.resourceGroups.length ?? "—"} note="Labor and equipment" />
                <Metric label="Demand records" value={counts?.demandRecords ?? model?.demand.length ?? "—"} note="Monthly 2027 ramp" />
                <Metric label="Recovery actions" value={counts?.scenarioActions ?? model?.scenarioActions?.length ?? 0} note="Dated and governed" />
              </div>
              <div className="two-column">
                <article className="card"><h3>Included</h3><ul><li>Northstar site and scoped product portfolio</li><li>Applicable product routes only</li><li>Working calendars and resource effectiveness</li><li>Baseline and governed recovery scenario</li></ul></article>
                <article className="card"><h3>Intentionally excluded</h3><ul><li>Daily production scheduling</li><li>Inventory accounting and procurement</li><li>Unrelated plant products and resources</li><li>Any employer, supplier, or customer data</li></ul></article>
              </div>
              <div className="panel-actions"><button className="primary" type="button" onClick={() => setActiveStep("data")}>Review the data</button></div>
            </section>
          )}

          {activeStep === "data" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow blue">Step 2</span><h2>Load demand without hiding bad rows</h2></div><p>Preview first. The system reconciles record counts and quantities before replacing the baseline scenario.</p></div>
              <div className="metric-grid four">
                <Metric label="Current demand rows" value={model?.demand.length ?? "—"} />
                <Metric label="Current quantity" value={model ? model.demand.reduce((sum, row) => sum + row.quantity, 0).toLocaleString() : "—"} />
                <Metric label="Earliest ship date" value={model?.demand.map(row => row.shipDate).sort()[0] ?? "—"} />
                <Metric label="Latest ship date" value={model?.demand.map(row => row.shipDate).sort().at(-1) ?? "—"} />
              </div>
              <div className="import-layout">
                <div className="card import-card"><div className="card-title-row"><h3>Demand CSV</h3><label className="file-button">Choose file<input type="file" accept=".csv,text/csv" onChange={event => void readFile(event.target.files?.[0])} /></label></div><textarea value={csv} onChange={event => { setCsv(event.target.value); setPreview(null); }} aria-label="Demand CSV content" spellCheck={false} /><small>Required columns are mapped beside the file. The example can be edited directly.</small></div>
                <div className="card mapping-card">
                  <h3>Column mapping</h3>
                  <label>Product column<input value={mapping.productColumn} onChange={event => updateMapping("productColumn", event.target.value)} /></label>
                  <label>Ship-date column<input value={mapping.shipDateColumn} onChange={event => updateMapping("shipDateColumn", event.target.value)} /></label>
                  <label>Quantity column<input value={mapping.quantityColumn} onChange={event => updateMapping("quantityColumn", event.target.value)} /></label>
                  <label>Match product by<select value={mapping.productMatch} onChange={event => updateMapping("productMatch", event.target.value as DemandMapping["productMatch"])}><option value="name">Product name</option><option value="id">Canonical ID</option><option value="externalKey">External key</option></select></label>
                  <label>Date format<select value={mapping.dateFormat ?? "iso"} onChange={event => updateMapping("dateFormat", event.target.value as "iso" | "us")}><option value="iso">YYYY-MM-DD</option><option value="us">MM/DD/YYYY</option></select></label>
                  <button className="primary full" type="button" disabled={!model || busy !== null || csv.trim().length === 0} onClick={() => void previewImport()}>{busy === "previewing" ? "Checking…" : "Preview and reconcile"}</button>
                </div>
              </div>
              {preview ? <div className={`preview ${preview.controlTotals.rejectedRows > 0 ? "has-errors" : "clean"}`}>
                <div className="preview-head"><div><span>Import reconciliation</span><strong>{preview.controlTotals.acceptedRows} of {preview.controlTotals.inputRows} rows accepted</strong></div><div><span>Accepted quantity</span><strong>{preview.controlTotals.totalQuantity.toLocaleString()}</strong></div></div>
                <div className="metric-grid four compact"><Metric label="Accepted" value={preview.controlTotals.acceptedRows} /><Metric label="Rejected" value={preview.controlTotals.rejectedRows} /><Metric label="First delivery" value={preview.controlTotals.earliestShipDate ?? "—"} /><Metric label="Last delivery" value={preview.controlTotals.latestShipDate ?? "—"} /></div>
                {preview.issues.length > 0 ? <div className="issue-list">{preview.issues.slice(0, 8).map(issue => <div key={`${issue.rowNumber}-${issue.code}`}><strong>Row {issue.rowNumber}</strong><span>{issue.message}</span></div>)}</div> : <p className="success-copy">All rows passed the mapping and data checks.</p>}
                <label className="checkbox"><input type="checkbox" checked={acceptPartial} onChange={event => setAcceptPartial(event.target.checked)} /> Allow accepted rows to replace the scenario even when other rows are rejected</label>
                <button className="primary" type="button" onClick={() => void applyImport()} disabled={busy !== null || (preview.controlTotals.rejectedRows > 0 && !acceptPartial)}>{busy === "applying" ? "Applying…" : "Apply imported demand"}</button>
              </div> : null}
              <div className="panel-actions split"><button className="secondary" type="button" onClick={() => setActiveStep("scope")}>Back</button><button className="primary" type="button" onClick={() => setActiveStep("readiness")}>Check readiness</button></div>
            </section>
          )}

          {activeStep === "readiness" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow blue">Step 3</span><h2>Decide whether the inputs are good enough</h2></div><p>Unknown values are allowed. Hidden uncertainty is not. Blocking issues cannot appear as healthy capacity.</p></div>
              <div className={`readiness-score ${validation?.valid ? "ready" : "blocked"}`}><div><span>Structural readiness</span><strong>{validation?.valid ? "Ready to calculate" : "Blocked"}</strong></div><div className="score-ring">{validation?.valid ? "✓" : issueCount}</div></div>
              <div className="metric-grid four"><Metric label="Products" value={counts?.products ?? "—"} note="Each has an effective route" /><Metric label="Routes" value={counts?.routingRevisions ?? "—"} note="Sparse and revision-aware" /><Metric label="Scenarios" value={counts?.scenarios ?? model?.scenarios.length ?? "—"} note="Baseline remains protected" /><Metric label="Blocking issues" value={validation?.valid ? 0 : issueCount} note="Must be resolved" /></div>
              {validation?.issues?.length ? <div className="issue-list large">{validation.issues.map((issue, index) => <div key={`${issue.path}-${index}`}><strong>{issue.path || "Model"}</strong><span>{issue.message}</span></div>)}</div> : <div className="card"><h3>What has been checked</h3><ul className="check-list"><li>Required model sections are present.</li><li>Identifiers and recovery targets are valid.</li><li>Scenario lineage contains no cycles.</li><li>Rejected actions cannot be calculated.</li><li>Missing, zero, and not-applicable requirements remain distinct.</li></ul></div>}
              <div className="panel-actions split"><button className="secondary" type="button" onClick={() => setActiveStep("data")}>Back</button><button className="primary" type="button" disabled={!validation?.valid || busy !== null} onClick={() => setActiveStep("analysis")}>Continue to calculation</button></div>
            </section>
          )}

          {activeStep === "analysis" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow blue">Step 4</span><h2>Place work when it must occur—not only when it ships</h2></div><p>The engine shifts each product’s labor and equipment requirements into its applicable lead-time phases, then compares period load against calendar capacity.</p></div>
              <div className="flow-strip"><div><span>1</span><strong>Demand</strong><small>Customer ship dates</small></div><i>→</i><div><span>2</span><strong>Routing</strong><small>Applicable work only</small></div><i>→</i><div><span>3</span><strong>Lead time</strong><small>Work shifted earlier</small></div><i>→</i><div><span>4</span><strong>Capacity</strong><small>Calendars and effectiveness</small></div><i>→</i><div><span>5</span><strong>Constraint</strong><small>What fails first</small></div></div>
              <div className="callout amber"><span>Why this matters</span><strong>A 2027 shipment can consume welding, machining, or tooling capacity in 2026. Annual averages can therefore look healthy while the launch still fails.</strong></div>
              <div className="analysis-ready"><div><span>Scenario</span><strong>{model?.scenarios.find(scenario => scenario.id === baselineScenarioId)?.name ?? baselineScenarioId}</strong></div><div><span>Horizon</span><strong>{model?.horizonStart} → {model?.horizonEnd}</strong></div><div><span>Native resolution</span><strong>{model?.planningGranularity}</strong></div><button className="primary large" type="button" disabled={!model || !validation?.valid || busy !== null} onClick={() => void runCalculation()}>{busy === "calculating" ? "Calculating…" : "Run baseline calculation"}</button></div>
              <div className="panel-actions split"><button className="secondary" type="button" onClick={() => setActiveStep("readiness")}>Back</button>{calculation ? <button className="primary" type="button" onClick={() => setActiveStep("capacity")}>Open Capacity Analysis</button> : null}</div>
            </section>
          )}

          {activeStep === "capacity" && model && calculation ? <AnalysisExplorer model={model} baseline={calculation} comparison={comparison} onBack={() => setActiveStep("analysis")} onContinue={() => setActiveStep("recovery")} /> : null}

          {activeStep === "capacity" && (!model || !calculation) ? <section className="panel"><div className="empty-state"><h3>Run the baseline calculation first</h3><p>Capacity Analysis needs calculated period results before charts and drill-through can be displayed.</p><button className="primary" type="button" onClick={() => setActiveStep("analysis")}>Go to calculation</button></div></section> : null}

          {activeStep === "recovery" && model ? <RecoveryPanel model={model} comparison={comparison} onModelChange={updateRecoveryModel} onComparison={setComparison} onBack={() => setActiveStep(calculation ? "capacity" : "analysis")} onContinue={() => setActiveStep("decision")} /> : null}

          {activeStep === "decision" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow blue">Step 7</span><h2>Make the capacity decision</h2></div><p>The decision states whether the current plan is supportable, what action basis was tested, and what exposure remains.</p></div>
              {!decisionCalculation || !decision ? <div className="empty-state"><h3>No defensible decision exists yet</h3><p>Run the baseline, explore Capacity Analysis, and compare a governed recovery scenario before publishing a commitment.</p><button className="primary" type="button" onClick={() => setActiveStep(calculation ? "capacity" : "analysis")}>{calculation ? "Open Capacity Analysis" : "Go to calculation"}</button></div> : <>
                {comparison && baselineDecision ? <div className="decision-comparison-strip"><div><span>Baseline</span><strong>{baselineDecision.headline}</strong><small>{baselineDecision.governing ? `${names[baselineDecision.governing.resourceGroupId] ?? baselineDecision.governing.resourceGroupId} · ${formatPercent(baselineDecision.governing.utilization)}` : "No governing constraint"}</small></div><div className="scenario-arrow">→</div><div><span>Recovery</span><strong>{decision.headline}</strong><small>{decision.governing ? `${names[decision.governing.resourceGroupId] ?? decision.governing.resourceGroupId} · ${formatPercent(decision.governing.utilization)}` : "No governing constraint"}</small></div></div> : null}
                <div className={`decision-hero ${decision.state}`}><span>{comparison ? "Recovery decision" : decision.state === "gap" ? "Capacity gap" : decision.state === "watch" ? "Constrained plan" : decision.state === "ready" ? "Supportable plan" : "Incomplete decision"}</span><h3>{decision.headline}</h3><p>{decision.explanation}</p></div>
                <div className="metric-grid four"><Metric label="Governing resource" value={decision.governing ? names[decision.governing.resourceGroupId] ?? decision.governing.resourceGroupId : "—"} /><Metric label="Peak utilization" value={formatPercent(decision.governing?.utilization ?? null)} /><Metric label="Gap periods remaining" value={comparison?.remainingGapPeriods ?? decisionCalculation.results.filter(row => row.gap < 0).length} note={comparison ? `${comparison.resolvedGapPeriods} resolved by recovery` : "Baseline exposure"} /><Metric label="Actions in lineage" value={comparison?.appliedActionIds.length ?? 0} note="Reproducible calculation basis" /></div>
                <div className="two-column decision-columns"><article className="card"><h3>Recommendation</h3><p>{decision.state === "gap" ? "Do not publish the commitment yet. The modeled recovery still leaves capacity gaps; revise the action timing, magnitude, or demand assumption and compare again." : decision.state === "watch" ? "Treat the commitment as conditional. The recovery improves the plan, but the governing margin remains narrow and requires explicit operating controls." : decision.state === "ready" ? "The modeled recovery supports the plan. Preserve the action register, source data, assumptions, and calculation lineage before publishing the commitment." : "Resolve blocking data issues before making a capacity decision."}</p></article><article className="card"><h3>Decision evidence</h3><ul><li>Protected baseline calculation</li><li>Capacity Analysis charts and drill-through</li><li>Named recovery actions and owners</li><li>Effective dates and approval states</li><li>Remaining constraint periods</li><li>Model warnings: {warningCount}</li></ul></article></div>
                {model ? <ConstraintExplorer model={model} scenarioId={decisionCalculation.scenarioId} rows={constraints} title="Highest-risk periods after recovery" subtitle="Select Explain to trace a period back to products, operations, standards, phases, and demand records." onReviseRecovery={() => setActiveStep("recovery")} /> : null}
              </>}
              <div className="panel-actions split">
                <button className="secondary" type="button" onClick={() => setActiveStep("capacity")}>Back to Capacity Analysis</button>
                {model && comparison ? <DecisionExports model={model} comparison={comparison} /> : <button className="primary" type="button" disabled>Decision package unavailable</button>}
              </div>
            </section>
          )}
        </main>
      </div>
      <footer><span>Capacity Assurance Platform · Synthetic data only</span><span>Engine and model version 1.0.0</span></footer>
    </div>
  );
}
