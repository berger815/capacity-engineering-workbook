import { useEffect, useMemo, useState } from "react";
import type { CalculationResult, CapacityModel, ScenarioComparisonResult } from "@capacity/domain";
import {
  calculateModel,
  loadNorthstar,
  validateModel,
  type ModelValidationResult,
} from "./api.js";
import { formatPercent, rankConstraintPeriods, summarizeDecision } from "./analysis.js";
import AnalysisExplorer from "./AnalysisExplorer.js";
import ConstraintExplorer from "./ConstraintExplorer.js";
import DataWorkspace from "./DataWorkspace.js";
import DecisionExports from "./DecisionExports.js";
import RecoveryPanel from "./RecoveryPanel.js";
import { findBaselineScenarioId } from "./recovery.js";

const steps = [
  { id: "scope", label: "Scope", help: "Define the decision and boundaries" },
  { id: "data", label: "Data", help: "Build and reconcile the model" },
  { id: "readiness", label: "Readiness", help: "Resolve decision-blocking gaps" },
  { id: "analysis", label: "Calculate", help: "Place load against capacity" },
  { id: "capacity", label: "Capacity Analysis", help: "Explore charts, gaps, and detail" },
  { id: "recovery", label: "Recovery", help: "Test governed countermeasures" },
  { id: "decision", label: "Decision", help: "Commit with evidence" },
] as const;

type StepId = typeof steps[number]["id"];
type BusyState = "loading" | "validating" | "calculating" | null;

function resourceNameMap(model: CapacityModel | null): Record<string, string> {
  return Object.fromEntries(model?.resourceGroups.map(group => [group.id, group.name]) ?? []);
}

function StepNav({ active, onSelect }: { active: StepId; onSelect: (step: StepId) => void }) {
  return <nav className="step-nav" aria-label="Assessment workflow">
    {steps.map((step, index) => <button key={step.id} className={`step-button ${active === step.id ? "active" : ""}`} onClick={() => onSelect(step.id)} type="button">
      <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
      <span><strong>{step.label}</strong><small>{step.help}</small></span>
    </button>)}
  </nav>;
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

  const names = useMemo(() => resourceNameMap(model), [model]);
  const baselineScenarioId = model ? findBaselineScenarioId(model) : "baseline";
  const decisionCalculation = comparison?.comparison ?? calculation;
  const baselineDecision = comparison
    ? summarizeDecision(comparison.baseline, names)
    : calculation
      ? summarizeDecision(calculation, names)
      : null;
  const decision = decisionCalculation ? summarizeDecision(decisionCalculation, names) : null;
  const constraints = decisionCalculation ? rankConstraintPeriods(decisionCalculation, 10) : [];

  async function checkModel(candidate: CapacityModel): Promise<ModelValidationResult> {
    setBusy("validating");
    try {
      const result = await validateModel(candidate);
      setValidation(result);
      return result;
    } finally {
      setBusy(null);
    }
  }

  async function loadDemo(): Promise<void> {
    try {
      setBusy("loading");
      setError(null);
      const fixture = await loadNorthstar();
      setModel(fixture);
      setCalculation(null);
      setComparison(null);
      const result = await validateModel(fixture);
      setValidation(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the assessment model");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => { void loadDemo(); }, []);

  async function handleInputModelChange(next: CapacityModel): Promise<void> {
    setModel(next);
    setCalculation(null);
    setComparison(null);
    setError(null);
    await checkModel(next);
  }

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

  function updateRecoveryModel(next: CapacityModel): void {
    setModel(next);
    setComparison(null);
  }

  const counts = validation?.counts;
  const issueCount = validation?.issues?.length ?? 0;
  const warningCount = decisionCalculation?.issues.filter(issue => issue.severity === "warning").length ?? 0;

  return <div className="app-shell">
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
        <div className="sidebar-note"><strong>Guided + analyst workflow</strong><p>Build the model, reconcile every source, calculate once, interrogate the detail, and govern the recovery plan.</p></div>
      </aside>

      <main>
        {error ? <div className="error-panel"><strong>Action required</strong><span>{error}</span></div> : null}
        <StatusBanner validation={validation} calculation={calculation} />

        {activeStep === "scope" ? <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow blue">Step 1</span><h2>Frame one decision, not the entire factory</h2></div><p>Northstar is a synthetic supplier assessment loaded automatically so the complete workflow can be reviewed without customer data.</p></div>
          <div className="callout navy"><span>Decision</span><strong>Can Northstar support the 2027 demand ramp across labor, equipment, tooling, and skill constraints?</strong></div>
          <div className="metric-grid four">
            <Metric label="Products" value={counts?.products ?? model?.products.length ?? "—"} note="Canonical product master" />
            <Metric label="Resource groups" value={counts?.resourceGroups ?? model?.resourceGroups.length ?? "—"} note="Labor and equipment" />
            <Metric label="Demand records" value={counts?.demandRecords ?? model?.demand.length ?? "—"} note="Time-phased demand" />
            <Metric label="Recovery actions" value={counts?.scenarioActions ?? model?.scenarioActions?.length ?? 0} note="Dated and governed" />
          </div>
          <div className="two-column">
            <article className="card"><h3>Included</h3><ul><li>Working calendars and exceptions</li><li>Resource groups and effective resources</li><li>Products and effective routing revisions</li><li>Demand, baseline, and recovery scenarios</li></ul></article>
            <article className="card"><h3>Input standard</h3><ul><li>CSV is the canonical import contract</li><li>Excel converts to CSV in the browser</li><li>Every source is previewed and reconciled</li><li>Apply is atomic and dependency-aware</li></ul></article>
          </div>
          <div className="panel-actions"><button className="primary" type="button" onClick={() => setActiveStep("data")}>Build the model</button></div>
        </section> : null}

        {activeStep === "data" && model ? <DataWorkspace
          model={model}
          baselineScenarioId={baselineScenarioId}
          onModelChange={handleInputModelChange}
          onBack={() => setActiveStep("scope")}
          onContinue={() => setActiveStep("readiness")}
        /> : null}

        {activeStep === "readiness" ? <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow blue">Step 3</span><h2>Decide whether the inputs are good enough</h2></div><p>Unknown values are allowed. Hidden uncertainty is not. Blocking issues cannot appear as healthy capacity.</p></div>
          <div className={`readiness-score ${validation?.valid ? "ready" : "blocked"}`}><div><span>Structural readiness</span><strong>{validation?.valid ? "Ready to calculate" : "Blocked"}</strong></div><div className="score-ring">{validation?.valid ? "✓" : issueCount}</div></div>
          <div className="metric-grid four">
            <Metric label="Calendars" value={model?.calendars.length ?? "—"} note="Weekly availability" />
            <Metric label="Resources" value={model?.resources.length ?? "—"} note="Effective capacity records" />
            <Metric label="Products / routes" value={`${model?.products.length ?? 0} / ${counts?.routingRevisions ?? 0}`} note="Revision-aware" />
            <Metric label="Blocking issues" value={validation?.valid ? 0 : issueCount} note="Must be resolved" />
          </div>
          {validation?.issues?.length ? <div className="issue-list large">{validation.issues.map((issue, index) => <div key={`${issue.path}-${index}`}><strong>{issue.path || "Model"}</strong><span>{issue.message}</span></div>)}</div> : <div className="card"><h3>What has been checked</h3><ul className="check-list"><li>Canonical IDs and required sections are present.</li><li>Scenario and resource references are valid.</li><li>Routing requirements preserve missing, zero, and not-applicable states.</li><li>Rejected actions cannot enter calculation lineage.</li></ul></div>}
          <div className="panel-actions split"><button className="secondary" type="button" onClick={() => setActiveStep("data")}>Back</button><button className="primary" type="button" disabled={!validation?.valid || busy !== null} onClick={() => setActiveStep("analysis")}>Continue to calculation</button></div>
        </section> : null}

        {activeStep === "analysis" ? <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow blue">Step 4</span><h2>Place work when it must occur—not only when it ships</h2></div><p>The engine shifts each product’s labor and equipment requirements into applicable lead-time phases, then compares period load against calendar capacity.</p></div>
          <div className="flow-strip"><div><span>1</span><strong>Demand</strong><small>Customer ship dates</small></div><i>→</i><div><span>2</span><strong>Routing</strong><small>Applicable work only</small></div><i>→</i><div><span>3</span><strong>Lead time</strong><small>Work shifted earlier</small></div><i>→</i><div><span>4</span><strong>Capacity</strong><small>Calendars and effectiveness</small></div><i>→</i><div><span>5</span><strong>Constraint</strong><small>What fails first</small></div></div>
          <div className="callout amber"><span>Why this matters</span><strong>A 2027 shipment can consume welding, machining, or tooling capacity in 2026. Annual averages can look healthy while the launch still fails.</strong></div>
          <div className="analysis-ready"><div><span>Scenario</span><strong>{model?.scenarios.find(scenario => scenario.id === baselineScenarioId)?.name ?? baselineScenarioId}</strong></div><div><span>Horizon</span><strong>{model?.horizonStart} → {model?.horizonEnd}</strong></div><div><span>Native resolution</span><strong>{model?.planningGranularity}</strong></div><button className="primary large" type="button" disabled={!model || !validation?.valid || busy !== null} onClick={() => void runCalculation()}>{busy === "calculating" ? "Calculating…" : "Run baseline calculation"}</button></div>
          <div className="panel-actions split"><button className="secondary" type="button" onClick={() => setActiveStep("readiness")}>Back</button>{calculation ? <button className="primary" type="button" onClick={() => setActiveStep("capacity")}>Open Capacity Analysis</button> : null}</div>
        </section> : null}

        {activeStep === "capacity" && model && calculation ? <AnalysisExplorer model={model} baseline={calculation} comparison={comparison} onBack={() => setActiveStep("analysis")} onContinue={() => setActiveStep("recovery")} /> : null}
        {activeStep === "capacity" && (!model || !calculation) ? <section className="panel"><div className="empty-state"><h3>Run the baseline calculation first</h3><p>Capacity Analysis needs calculated period results before charts and drill-through can be displayed.</p><button className="primary" type="button" onClick={() => setActiveStep("analysis")}>Go to calculation</button></div></section> : null}

        {activeStep === "recovery" && model ? <RecoveryPanel model={model} comparison={comparison} onModelChange={updateRecoveryModel} onComparison={setComparison} onBack={() => setActiveStep(calculation ? "capacity" : "analysis")} onContinue={() => setActiveStep("decision")} /> : null}

        {activeStep === "decision" ? <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow blue">Step 7</span><h2>Make the capacity decision</h2></div><p>The decision states whether the current plan is supportable, what action basis was tested, and what exposure remains.</p></div>
          {!decisionCalculation || !decision ? <div className="empty-state"><h3>No defensible decision exists yet</h3><p>Run the baseline, explore Capacity Analysis, and compare a governed recovery scenario before publishing a commitment.</p><button className="primary" type="button" onClick={() => setActiveStep(calculation ? "capacity" : "analysis")}>{calculation ? "Open Capacity Analysis" : "Go to calculation"}</button></div> : <>
            {comparison && baselineDecision ? <div className="decision-comparison-strip"><div><span>Baseline</span><strong>{baselineDecision.headline}</strong><small>{baselineDecision.governing ? `${names[baselineDecision.governing.resourceGroupId] ?? baselineDecision.governing.resourceGroupId} · ${formatPercent(baselineDecision.governing.utilization)}` : "No governing constraint"}</small></div><div className="scenario-arrow">→</div><div><span>Recovery</span><strong>{decision.headline}</strong><small>{decision.governing ? `${names[decision.governing.resourceGroupId] ?? decision.governing.resourceGroupId} · ${formatPercent(decision.governing.utilization)}` : "No governing constraint"}</small></div></div> : null}
            <div className={`decision-hero ${decision.state}`}><span>{comparison ? "Recovery decision" : decision.state === "gap" ? "Capacity gap" : decision.state === "watch" ? "Constrained plan" : decision.state === "ready" ? "Supportable plan" : "Incomplete decision"}</span><h3>{decision.headline}</h3><p>{decision.explanation}</p></div>
            <div className="metric-grid four"><Metric label="Governing resource" value={decision.governing ? names[decision.governing.resourceGroupId] ?? decision.governing.resourceGroupId : "—"} /><Metric label="Peak utilization" value={formatPercent(decision.governing?.utilization ?? null)} /><Metric label="Gap periods remaining" value={comparison?.remainingGapPeriods ?? decisionCalculation.results.filter(row => row.gap < 0).length} note={comparison ? `${comparison.resolvedGapPeriods} resolved by recovery` : "Baseline exposure"} /><Metric label="Actions in lineage" value={comparison?.appliedActionIds.length ?? 0} note="Reproducible calculation basis" /></div>
            <div className="two-column decision-columns"><article className="card"><h3>Recommendation</h3><p>{decision.state === "gap" ? "Do not publish the commitment yet. The modeled recovery still leaves capacity gaps; revise action timing, magnitude, or demand assumptions." : decision.state === "watch" ? "Treat the commitment as conditional. The recovery improves the plan, but the governing margin remains narrow." : decision.state === "ready" ? "The modeled recovery supports the plan. Preserve the action register, source data, assumptions, and calculation lineage." : "Resolve blocking data issues before making a capacity decision."}</p></article><article className="card"><h3>Decision evidence</h3><ul><li>Reconciled input records</li><li>Protected baseline calculation</li><li>Capacity Analysis charts and drill-through</li><li>Named recovery actions and owners</li><li>Model warnings: {warningCount}</li></ul></article></div>
            {model ? <ConstraintExplorer model={model} scenarioId={decisionCalculation.scenarioId} rows={constraints} title="Highest-risk periods after recovery" subtitle="Select Explain to trace a period back to products, operations, lead-time phases, standards, and demand records." onReviseRecovery={() => setActiveStep("recovery")} /> : null}
          </>}
          <div className="panel-actions split"><button className="secondary" type="button" onClick={() => setActiveStep("capacity")}>Back to Capacity Analysis</button>{model && comparison ? <DecisionExports model={model} comparison={comparison} /> : <button className="primary" type="button" disabled>Decision package unavailable</button>}</div>
        </section> : null}
      </main>
    </div>
    <footer><span>Capacity Assurance Platform · Synthetic data only</span><span>Engine and model version 1.0.0</span></footer>
  </div>;
}
