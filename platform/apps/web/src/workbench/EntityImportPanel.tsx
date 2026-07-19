import { useEffect, useMemo, useState } from "react";
import type { CapacityModel } from "@capacity/domain";
import { genericCalendarExceptionProfile } from "@capacity/importer";
import { applyInputImport, previewInputImport, type InputPreview } from "../inputApi.js";
import { readTabularFile, type WorkbookData } from "../workbookReader.js";
import {
  calendarExceptionsCsv,
  dependencyCount,
  entityDefinition,
  type WorkbenchEntity,
} from "./entityDefinitions.js";

interface StoredProfile {
  id: string;
  version: number;
  entity: string;
  label: string;
  sourceSystem: string;
  mapping: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface EntityImportPanelProps {
  entity: WorkbenchEntity;
  model: CapacityModel;
  baselineScenarioId: string;
  blocked: boolean;
  onApplied: (model: CapacityModel) => Promise<void> | void;
  onClose: () => void;
}

const selectOptions: Record<string, string[]> = {
  productMatch: ["id", "name", "externalKey"],
  dateFormat: ["iso", "us"],
  factorFormat: ["decimal", "percent"],
  defaultDemandClass: ["firm", "forecast", "upside", "downside"],
};

function cloneMapping(mapping: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(mapping)) as Record<string, unknown>;
}

function storedProfiles(): StoredProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem("capacity-input-profiles-v1") ?? "[]") as unknown;
    return Array.isArray(value) ? value as StoredProfile[] : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: StoredProfile[]): void {
  window.localStorage.setItem("capacity-input-profiles-v1", JSON.stringify(profiles));
}

function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function EntityImportPanel({ entity, model, baselineScenarioId, blocked, onApplied, onClose }: EntityImportPanelProps) {
  const definition = entityDefinition(entity);
  const inputEntity = definition.inputEntity;
  const profile = definition.profile;
  const exporter = definition.exportCsv;
  const [mapping, setMapping] = useState<Record<string, unknown>>(() => cloneMapping(profile?.mapping ?? {}));
  const [csv, setCsv] = useState(() => exporter?.(model, baselineScenarioId) ?? "");
  const [exceptionsCsv, setExceptionsCsv] = useState(() => entity === "calendars" ? calendarExceptionsCsv(model) : "");
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [preview, setPreview] = useState<InputPreview | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [mode, setMode] = useState<"append" | "replaceById">("replaceById");
  const [busy, setBusy] = useState<"reading" | "previewing" | "applying" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<StoredProfile[]>(storedProfiles);
  const [profileId, setProfileId] = useState(profile?.id ?? "custom");
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    setMapping(cloneMapping(profile?.mapping ?? {}));
    setCsv(exporter?.(model, baselineScenarioId) ?? "");
    setExceptionsCsv(entity === "calendars" ? calendarExceptionsCsv(model) : "");
    setWorkbook(null);
    setSelectedSheet("");
    setPreview(null);
    setAcceptPartial(false);
    setMode("replaceById");
    setError(null);
    setProfileId(profile?.id ?? "custom");
  }, [entity, model, baselineScenarioId, profile?.id]);

  const dependencies = definition.dependencies ?? [];
  const missingDependencies = dependencies
    .filter(required => dependencyCount(model, required) === 0)
    .map(required => entityDefinition(required === "resource-groups" ? "resource-groups" : required).label);
  const dependenciesReady = missingDependencies.length === 0;
  const entityProfiles = useMemo(() => saved.filter(item => item.entity === inputEntity), [saved, inputEntity]);
  const totals = preview
    ? Object.entries(preview.controlTotals).filter(([, value]) => typeof value === "number" || typeof value === "string")
    : [];

  if (!inputEntity || !profile || !exporter) {
    return <aside className="workbench-drawer" aria-label={`${definition.label} import`}>
      <div className="workbench-drawer-head"><div><span>Import</span><h3>{definition.label}</h3></div><button type="button" className="secondary" onClick={onClose}>Close</button></div>
      <div className="dependency-note"><strong>No import contract exists for this planning record yet.</strong> Maintain it directly in the Workbench. A guessed browser-only importer would bypass reconciliation and is intentionally not provided.</div>
    </aside>;
  }

  async function readFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      setBusy("reading");
      setError(null);
      const data = await readTabularFile(file);
      const first = data.sheetNames[0] ?? "";
      setWorkbook(data);
      setSelectedSheet(first);
      setCsv(data.csvBySheet[first] ?? "");
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read the selected file");
    } finally {
      setBusy(null);
    }
  }

  async function readExceptionsFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const data = await readTabularFile(file);
      const first = data.sheetNames[0] ?? "";
      setExceptionsCsv(data.csvBySheet[first] ?? "");
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read the exception file");
    }
  }

  function updateMapping(key: string, value: unknown): void {
    setMapping(current => ({ ...current, [key]: value }));
    setProfileId("custom");
    setPreview(null);
  }

  function chooseProfile(id: string): void {
    setProfileId(id);
    if (id === profile.id) setMapping(cloneMapping(profile.mapping));
    else {
      const selected = entityProfiles.find(item => item.id === id);
      if (selected) setMapping(cloneMapping(selected.mapping));
    }
    setPreview(null);
  }

  function saveProfile(): void {
    const label = profileName.trim();
    if (!label) return;
    const now = new Date().toISOString();
    const nextProfile: StoredProfile = {
      id: `custom-${inputEntity}-${crypto.randomUUID()}`,
      version: 1,
      entity: inputEntity,
      label,
      sourceSystem: String(mapping.sourceSystem ?? "Custom"),
      mapping: cloneMapping(mapping),
      createdAt: now,
      updatedAt: now,
    };
    const next = [...saved, nextProfile];
    saveProfiles(next);
    setSaved(next);
    setProfileId(nextProfile.id);
    setProfileName("");
  }

  function options() {
    return {
      mode,
      acceptPartial,
      scenarioId: baselineScenarioId,
      ...(entity === "calendars" && exceptionsCsv.trim() ? {
        exceptionsCsv,
        exceptionMapping: genericCalendarExceptionProfile.mapping,
      } : {}),
    };
  }

  async function previewImport(): Promise<void> {
    try {
      setBusy("previewing");
      setError(null);
      setPreview(await previewInputImport(inputEntity, model, csv, mapping, options()));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "Import preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function applyImport(): Promise<void> {
    try {
      setBusy("applying");
      setError(null);
      const applied = await applyInputImport(inputEntity, model, csv, mapping, options());
      await onApplied(applied.model);
      setPreview(applied.import);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import could not be applied");
    } finally {
      setBusy(null);
    }
  }

  return <aside className="workbench-drawer" aria-label={`${definition.label} import`}>
    <div className="workbench-drawer-head"><div><span>Import and reconcile</span><h3>{definition.label}</h3></div><button type="button" className="secondary" onClick={onClose}>Close</button></div>
    {blocked ? <div className="dependency-note"><strong>Save or discard inline edits first.</strong> Import is transactional against the last validated model and cannot be merged into an unsaved draft.</div> : null}
    {!dependenciesReady ? <div className="dependency-note"><strong>Apply is waiting for:</strong> {missingDependencies.join(", ")}. Mapping and preview remain available.</div> : null}
    {error ? <div className="error-panel"><strong>Input issue</strong><span>{error}</span></div> : null}

    <div className="drawer-section">
      <div className="card-title-row"><h4>Source file</h4><label className="file-button compact">Choose CSV or Excel<input type="file" accept=".csv,.xlsx,.xls,.xlsm,.xlsb,text/csv" onChange={event => void readFile(event.target.files?.[0])} /></label></div>
      {workbook && workbook.sheetNames.length > 1 ? <label>Worksheet<select value={selectedSheet} onChange={event => { const sheet = event.target.value; setSelectedSheet(sheet); setCsv(workbook.csvBySheet[sheet] ?? ""); setPreview(null); }}>{workbook.sheetNames.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label> : null}
      <textarea value={csv} onChange={event => { setCsv(event.target.value); setPreview(null); }} aria-label={`${definition.label} CSV content`} spellCheck={false} />
      <small>{busy === "reading" ? "Reading workbook…" : "Excel is converted to CSV in the browser before reconciliation."}</small>
      {entity === "calendars" ? <div className="exception-input"><div className="card-title-row"><h4>Optional exceptions</h4><label className="file-button compact">Choose file<input type="file" accept=".csv,.xlsx,.xls,.xlsm,.xlsb,text/csv" onChange={event => void readExceptionsFile(event.target.files?.[0])} /></label></div><textarea value={exceptionsCsv} onChange={event => { setExceptionsCsv(event.target.value); setPreview(null); }} aria-label="Calendar exceptions CSV" spellCheck={false} /></div> : null}
    </div>

    <div className="drawer-section">
      <div className="drawer-row"><label>Profile<select value={profileId} onChange={event => chooseProfile(event.target.value)}><option value={profile.id}>{profile.label}</option>{entityProfiles.map(item => <option key={item.id} value={item.id}>{item.label} · v{item.version}</option>)}<option value="custom">Custom mapping</option></select></label>{entity !== "routing" && entity !== "demand" ? <label>Merge<select value={mode} onChange={event => setMode(event.target.value as "append" | "replaceById")}><option value="replaceById">Replace by ID</option><option value="append">Append new only</option></select></label> : null}</div>
      <div className="mapping-fields">{Object.entries(mapping).map(([key, value]) => {
        const choices = selectOptions[key];
        if (typeof value === "boolean") return <label key={key}>{key}<select value={String(value)} onChange={event => updateMapping(key, event.target.value === "true")}><option value="true">true</option><option value="false">false</option></select></label>;
        if (choices) return <label key={key}>{key}<select value={String(value ?? "")} onChange={event => updateMapping(key, event.target.value)}>{choices.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
        return <label key={key}>{key}<input value={String(value ?? "")} onChange={event => updateMapping(key, event.target.value)} /></label>;
      })}</div>
      <div className="save-profile"><input placeholder="Saved profile name" value={profileName} onChange={event => setProfileName(event.target.value)} /><button className="secondary" type="button" onClick={saveProfile} disabled={!profileName.trim()}>Save mapping</button></div>
      <div className="drawer-actions"><button className="secondary" type="button" onClick={() => downloadCsv(`${entity}-template.csv`, exporter(model, baselineScenarioId))}>Download template</button><button className="primary" type="button" disabled={!csv.trim() || busy !== null} onClick={() => void previewImport()}>{busy === "previewing" ? "Checking…" : "Preview and reconcile"}</button></div>
    </div>

    {preview ? <div className={`preview ${preview.controlTotals.rejectedRows > 0 ? "has-errors" : "clean"}`}>
      <div className="preview-head"><div><span>Import reconciliation</span><strong>{preview.controlTotals.acceptedRows} of {preview.controlTotals.inputRows} source rows accepted</strong></div><div><span>Rejected</span><strong>{preview.controlTotals.rejectedRows}</strong></div></div>
      <div className="control-total-grid">{totals.slice(0, 12).map(([key, value]) => <div key={key}><span>{key.replaceAll(/([A-Z])/g, " $1")}</span><strong>{typeof value === "number" ? value.toLocaleString() : String(value)}</strong></div>)}</div>
      {preview.issues.length > 0 ? <div className="issue-list">{preview.issues.slice(0, 20).map((issue, index) => <div key={`${issue.rowNumber ?? issue.entityKey ?? index}-${issue.code}-${index}`}><strong>{issue.rowNumber ? `Row ${issue.rowNumber}` : issue.entityKey ?? "Import"}</strong><span>{issue.message}</span></div>)}</div> : <p className="success-copy">All records passed mapping and dependency checks.</p>}
      <label className="checkbox"><input type="checkbox" checked={acceptPartial} onChange={event => setAcceptPartial(event.target.checked)} /> Apply accepted records when other rows or operations are rejected</label>
      <button className="primary full" type="button" onClick={() => void applyImport()} disabled={blocked || !dependenciesReady || busy !== null || (preview.controlTotals.rejectedRows > 0 && !acceptPartial)}>{busy === "applying" ? "Applying…" : `Apply ${definition.label}`}</button>
    </div> : null}
  </aside>;
}
