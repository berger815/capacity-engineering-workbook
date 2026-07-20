import { useEffect, useMemo, useState } from "react";
import type { CalculationResult, CapacityModel, ScenarioComparisonResult } from "@capacity/domain";
import { calculateModel, loadNorthstar, validateModel, type ModelValidationResult } from "./api.js";
import AnalysisExplorer from "./AnalysisExplorer.js";
import ModelWorkbench from "./ModelWorkbench.js";
import RecoveryPanel from "./RecoveryPanel.js";
import { findBaselineScenarioId } from "./recovery.js";
import { CalculateStep, DecisionStep, ReadinessStep, ScopeStep, StatusBanner } from "./NarrativeSteps.js";
import { entityDefinitions, type WorkbenchEntity, type WorkbenchTarget } from "./workbench/entityDefinitions.js";
import "./ui-extensions.css";
import "./workbench/workbench.css";

const steps = [
  { id: "scope", label: "Scope", help: "Define the decision and boundaries" },
  { id: "data", label: "Data", help: "Build and reconcile the model" },
  { id: "readiness", label: "Readiness", help: "Resolve decision-blocking gaps" },
  { id: "analysis", label: "Calculate", help: "Place load against capacity" },
  { id: "capacity", label: "Capacity Analysis", help: "Explore charts, gaps, and detail" },
  { id: "footprint", label: "Footprint", help: "Test WIP, space, and storage" },
  { id: "recovery", label: "Recovery", help: "Test governed countermeasures" },
  { id: "actions", label: "Action Log", help: "Track gaps, risks, and decisions" },
  { id: "decision", label: "Decision", help: "Commit with evidence" },
] as const;
type StepId = typeof steps[number]["id"];
type BusyState = "loading" | "validating" | "calculating" | null;
type ExperienceMode = "guided" | "expert";
const stepIds = new Set<string>(steps.map(step => step.id));
const entityIds = new Set<string>(entityDefinitions.map(entity => entity.id));
const structuralEntities = new Set<WorkbenchEntity>(["products", "calendars", "resource-groups", "resources", "routing", "demand"]);

function readLocation(): { step: StepId; target: WorkbenchTarget | null } {
  if (typeof window === "undefined") return { step: "scope", target: null };
  const params = new URLSearchParams(window.location.search);
  const stepValue = params.get("step") ?? "scope";
  const step = stepIds.has(stepValue) ? stepValue as StepId : "scope";
  const entityValue = params.get("entity");
  if (!entityValue || !entityIds.has(entityValue)) return { step, target: null };
  const returnStepValue = params.get("returnStep");
  const returnTo = returnStepValue && stepIds.has(returnStepValue) ? {
    step: returnStepValue as StepId,
    label: params.get("returnLabel") ?? steps.find(item => item.id === returnStepValue)?.label ?? "Previous view",
    ...(params.get("returnView") ? { view: params.get("returnView")! } : {}),
    ...(params.get("resourceGroupId") ? { resourceGroupId: params.get("resourceGroupId")! } : {}),
    ...(params.get("periodStart") ? { periodStart: params.get("periodStart")! } : {}),
  } : undefined;
  return { step, target: { entity: entityValue as WorkbenchEntity, ...(params.get("record") ? { recordId: params.get("record")! } : {}), ...(params.get("parent") ? { parentRecordId: params.get("parent")! } : {}), ...(returnTo ? { returnTo } : {}) } };
}

function writeLocation(step: StepId, target: WorkbenchTarget | null, mode: "push" | "replace" = "replace"): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(); params.set("step", step);
  if (target) { params.set("entity", target.entity); if (target.recordId) params.set("record", target.recordId); if (target.parentRecordId) params.set("parent", target.parentRecordId); if (target.returnTo) { params.set("returnStep", target.returnTo.step); params.set("returnLabel", target.returnTo.label); if (target.returnTo.view) params.set("returnView", target.returnTo.view); if (target.returnTo.resourceGroupId) params.set("resourceGroupId", target.returnTo.resourceGroupId); if (target.returnTo.periodStart) params.set("periodStart", target.returnTo.periodStart); } }
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
}
function StepNav({ active, onSelect }: { active: StepId; onSelect: (step: StepId) => void }) { return <nav className="step-nav" aria-label="Assessment workflow">{steps.map((step, index) => <button key={step.id} className={`step-button ${active === step.id ? "active" : ""}`} onClick={() => onSelect(step.id)} type="button"><span className="step-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{step.label}</strong><small>{step.help}</small></span></button>)}</nav>; }

export default function App() {
  const initial = readLocation();
  const [activeStep, setActiveStep] = useState<StepId>(initial.step);
  const [target, setTarget] = useState<WorkbenchTarget | null>(initial.target);
  const [workbenchDirty, setWorkbenchDirty] = useState(false);
  const [model, setModel] = useState<CapacityModel | null>(null);
  const [validation, setValidation] = useState<ModelValidationResult | null>(null);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [comparison, setComparison] = useState<ScenarioComparisonResult | null>(null);
  const [busy, setBusy] = useState<BusyState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [experience, setExperience] = useState<ExperienceMode>(() => typeof window === "undefined" ? "guided" : window.localStorage.getItem("capacity-experience-mode") === "expert" ? "expert" : "guided");
  const names = useMemo(() => Object.fromEntries(model?.resourceGroups.map(group => [group.id, group.name]) ?? []), [model]);
  const baselineScenarioId = model ? findBaselineScenarioId(model) : "baseline";
  const counts = validation?.counts;
  const openLogCount = model?.actionLog?.filter(entry => !entry.resolvedAt).length ?? 0;
  const warningCount = (comparison?.comparison ?? calculation)?.issues.filter(issue => issue.severity === "warning").length ?? 0;

  useEffect(() => { window.localStorage.setItem("capacity-experience-mode", experience); }, [experience]);
  useEffect(() => { const pop = () => { const next = readLocation(); setActiveStep(next.step); setTarget(next.target); }; window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => { void loadDemo(false); }, []);

  function navigate(step: StepId, nextTarget: WorkbenchTarget | null = null, mode: "push" | "replace" = "push"): void {
    if (workbenchDirty && !window.confirm("Discard unsaved Workbench changes?")) return;
    setActiveStep(step); setTarget(nextTarget); setWorkbenchDirty(false); writeLocation(step, nextTarget, mode);
  }

  async function loadDemo(resetNavigation: boolean): Promise<void> {
    try { setBusy("loading"); setError(null); const fixture = await loadNorthstar(); const result = await validateModel(fixture); setModel(fixture); setValidation(result); setCalculation(null); setComparison(null); setWorkbenchDirty(false); if (resetNavigation) navigate("scope", null, "replace"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load the assessment model"); }
    finally { setBusy(null); }
  }

  async function saveWorkbench(next: CapacityModel, changed: WorkbenchEntity[]): Promise<void> {
    setBusy("validating");
    try { const result = await validateModel(next); if (!result.valid) throw new Error(result.issues[0]?.message ?? "The edited model is invalid"); setModel(next); setValidation(result); setError(null); if (changed.some(entity => structuralEntities.has(entity))) { setCalculation(null); setComparison(null); } }
    finally { setBusy(null); }
  }

  async function runCalculation(): Promise<void> {
    if (!model) return;
    try { setBusy("calculating"); setError(null); const result = await calculateModel(model, baselineScenarioId); setCalculation(result); setComparison(null); navigate("capacity"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Calculation failed"); }
    finally { setBusy(null); }
  }

  function openWorkbench(next: WorkbenchTarget): void { const step: StepId = next.entity === "footprint" ? "footprint" : next.entity === "actions" ? "actions" : "data"; navigate(step, next); }
  function changeTarget(next: WorkbenchTarget): void { setTarget(next); writeLocation(activeStep, next, "replace"); }
  function returnFromWorkbench(): void { const step = target?.returnTo?.step as StepId | undefined; if (step) navigate(step); }
  function updateRecoveryModel(next: CapacityModel): void { setModel(next); setComparison(null); }

  return <div className={`app-shell ${experience === "expert" ? "expert-mode" : "guided-mode"}`}><header className="topbar"><div><span className="eyebrow">Manufacturing Capacity Assurance</span><h1>Assessment Studio</h1></div><div className="topbar-actions"><div className="experience-toggle"><button className={experience === "guided" ? "active" : ""} onClick={() => setExperience("guided")}>Guided</button><button className={experience === "expert" ? "active" : ""} onClick={() => setExperience("expert")}>Expert</button></div><span className={`connection ${error ? "offline" : ""}`}>{error ? "Needs attention" : "Local assessment"}</span><button className="secondary light" type="button" onClick={() => void loadDemo(true)} disabled={busy !== null}>Reset Northstar demo</button></div></header><div className="workspace"><aside><div className="assessment-id"><span>Current assessment</span><strong>{model?.name ?? "Loading…"}</strong><small>{model ? `${model.horizonStart} → ${model.horizonEnd}` : ""}</small></div><StepNav active={activeStep} onSelect={step => navigate(step)} /></aside><main>{error ? <div className="error-panel"><strong>Action required</strong><span>{error}</span></div> : null}<StatusBanner validation={validation} calculation={calculation} />
    {activeStep === "scope" ? <ScopeStep model={model} counts={counts} openLogCount={openLogCount} onContinue={() => navigate("data")} /> : null}
    {activeStep === "data" && model ? <ModelWorkbench model={model} baselineScenarioId={baselineScenarioId} scope={experience === "expert" ? "all" : "core-data"} target={target} onTargetChange={changeTarget} onSave={saveWorkbench} onDirtyChange={setWorkbenchDirty} onBack={() => navigate("scope")} onContinue={() => navigate("readiness")} {...(target?.returnTo ? { onReturn: returnFromWorkbench } : {})} continueLabel="Check readiness" /> : null}
    {activeStep === "readiness" ? <ReadinessStep model={model} validation={validation} counts={counts} busy={busy !== null} onBack={() => navigate("data")} onContinue={() => navigate("analysis")} /> : null}
    {activeStep === "analysis" ? <CalculateStep model={model} scenarioId={baselineScenarioId} validationReady={Boolean(validation?.valid)} calculating={busy === "calculating"} calculation={calculation} onBack={() => navigate("readiness")} onRun={() => void runCalculation()} onOpen={() => navigate("capacity")} /> : null}
    {activeStep === "capacity" && model && calculation ? <div className="analysis-readonly"><div className="analysis-edit-strip"><strong>Analysis is read-only.</strong><button className="secondary" onClick={() => openWorkbench({ entity: "demand", returnTo: { step: "capacity", label: "Capacity Analysis" } })}>Edit demand</button><button className="secondary" onClick={() => openWorkbench({ entity: "routing", returnTo: { step: "capacity", label: "Capacity Analysis" } })}>Edit routing and lead time</button><button className="secondary" onClick={() => openWorkbench({ entity: "resources", returnTo: { step: "capacity", label: "Capacity Analysis" } })}>Edit capacity</button></div><AnalysisExplorer model={model} baseline={calculation} comparison={comparison} onBack={() => navigate("analysis")} onContinue={() => navigate("footprint")} /></div> : null}
    {activeStep === "capacity" && (!model || !calculation) ? <section className="panel"><div className="empty-state"><h3>Run the baseline calculation first</h3><button className="primary" onClick={() => navigate("analysis")}>Go to calculation</button></div></section> : null}
    {activeStep === "footprint" && model ? <ModelWorkbench model={model} baselineScenarioId={calculation?.demandSourceScenarioId ?? baselineScenarioId} scope="footprint" target={target} onTargetChange={changeTarget} onSave={saveWorkbench} onDirtyChange={setWorkbenchDirty} onBack={() => navigate("capacity")} onContinue={() => navigate("recovery")} {...(target?.returnTo ? { onReturn: returnFromWorkbench } : {})} continueLabel="Continue to recovery" /> : null}
    {activeStep === "recovery" && model ? <RecoveryPanel model={model} comparison={comparison} onModelChange={updateRecoveryModel} onComparison={setComparison} onBack={() => navigate("footprint")} onContinue={() => navigate("actions")} /> : null}
    {activeStep === "actions" && model ? <ModelWorkbench model={model} baselineScenarioId={baselineScenarioId} scope="actions" target={target} onTargetChange={changeTarget} onSave={saveWorkbench} onDirtyChange={setWorkbenchDirty} onBack={() => navigate("recovery")} onContinue={() => navigate("decision")} {...(target?.returnTo ? { onReturn: returnFromWorkbench } : {})} continueLabel="Continue to decision" /> : null}
    {activeStep === "decision" ? <DecisionStep model={model} calculation={calculation} comparison={comparison} names={names} openLogCount={openLogCount} warningCount={warningCount} onBack={() => navigate("actions")} onGoToAnalysis={() => navigate(calculation ? "capacity" : "analysis")} onReviseRecovery={() => navigate("recovery")} onEditResource={id => openWorkbench({ entity: "resource-groups", recordId: id, returnTo: { step: "decision", label: "Decision" } })} /> : null}
  </main></div><footer><span>Capacity Assurance Platform · Synthetic data only</span><span>Engine and model version 1.0.0</span></footer></div>;
}
