import { useMemo, useState } from "react";
import type { CapacityModel } from "@capacity/domain";
import {
  exportCalendarExceptionsCsv,
  exportCalendarsCsv,
  exportDemandCsv,
  exportProductsCsv,
  exportResourceGroupsCsv,
  exportResourcesCsv,
  exportRoutingCsv,
  genericCalendarExceptionProfile,
  genericCalendarProfile,
  genericDemandProfile,
  genericProductProfile,
  genericResourceGroupProfile,
  genericResourceProfile,
  genericRoutingProfile,
} from "@capacity/importer";
import { applyInputImport, previewInputImport, type InputEntity, type InputPreview } from "./inputApi.js";
import { readTabularFile, type WorkbookData } from "./workbookReader.js";
import "./data-workspace.css";

interface DataWorkspaceProps {
  model: CapacityModel;
  baselineScenarioId: string;
  onModelChange: (model: CapacityModel) => Promise<void> | void;
  onBack: () => void;
  onContinue: () => void;
}

interface StoredProfile {
  id: string;
  version: number;
  entity: InputEntity;
  label: string;
  sourceSystem: string;
  mapping: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface EntityDefinition {
  id: InputEntity;
  label: string;
  note: string;
  count: (model: CapacityModel) => number;
  dependencies: InputEntity[];
  profile: { id: string; label: string; mapping: Record<string, unknown> };
  exportCsv: (model: CapacityModel, scenarioId: string) => string;
}

const definitions: EntityDefinition[] = [
  {
    id: "calendars",
    label: "Working Calendars",
    note: "Weekly availability and exceptions",
    count: model => model.calendars.length,
    dependencies: [],
    profile: genericCalendarProfile as unknown as EntityDefinition["profile"],
    exportCsv: model => exportCalendarsCsv(model),
  },
  {
    id: "resource-groups",
    label: "Resource Groups",
    note: "Labor, equipment, tooling, space, and skills",
    count: model => model.resourceGroups.length,
    dependencies: ["calendars"],
    profile: genericResourceGroupProfile as unknown as EntityDefinition["profile"],
    exportCsv: model => exportResourceGroupsCsv(model),
  },
  {
    id: "resources",
    label: "Resources",
    note: "Quantity, conversion rate, and OEE factors",
    count: model => model.resources.length,
    dependencies: ["calendars", "resource-groups"],
    profile: genericResourceProfile as unknown as EntityDefinition["profile"],
    exportCsv: model => exportResourcesCsv(model),
  },
  {
    id: "products",
    label: "Products",
    note: "Canonical IDs, names, families, and external keys",
    count: model => model.products.length,
    dependencies: [],
    profile: genericProductProfile as unknown as EntityDefinition["profile"],
    exportCsv: model => exportProductsCsv(model),
  },
  {
    id: "routing",
    label: "Routing Revisions",
    note: "Phases, operations, and resource requirements",
    count: model => model.routingRevisions.length,
    dependencies: ["products", "resource-groups"],
    profile: genericRoutingProfile as unknown as EntityDefinition["profile"],
    exportCsv: model => exportRoutingCsv({ ...model, routingRevisions: [] }),
  },
  {
    id: "demand",
    label: "Demand",
    note: "Product, ship date, quantity, and demand class",
    count: model => model.demand.length,
    dependencies: ["products"],
    profile: genericDemandProfile as unknown as EntityDefinition["profile"],
    exportCsv: (model, scenarioId) => exportDemandCsv(model, scenarioId),
  },
];

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

function dependencyCount(model: CapacityModel, entity: InputEntity): number {
  return definitions.find(item => item.id === entity)?.count(model) ?? 0;
}

function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DataWorkspace({ model, baselineScenarioId, onModelChange, onBack, onContinue }: DataWorkspaceProps) {
  const [entity, setEntity] = useState<InputEntity>("calendars");
  const definition = definitions.find(item => item.id === entity) ?? definitions[0]!;
  const [mapping, setMapping] = useState<Record<string, unknown>>(() => cloneMapping(definition.profile.mapping));
  const [csv, setCsv] = useState(() => definition.exportCsv(model, baselineScenarioId));
  const [exceptionsCsv, setExceptionsCsv] = useState(() => exportCalendarExceptionsCsv(model));
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [preview, setPreview] = useState<InputPreview | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [mode, setMode] = useState<"append" | "replaceById">("replaceById");
  const [busy, setBusy] = useState<"reading" | "previewing" | "applying" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<StoredProfile[]>(storedProfiles);
  const [profileId, setProfileId] = useState(definition.profile.id);
  const [profileName, setProfileName] = useState("");

  const dependenciesReady = definition.dependencies.every(required => dependencyCount(model, required) > 0);
  const missingDependencies = definition.dependencies
    .filter(required => dependencyCount(model, required) === 0)
    .map(required => definitions.find(item => item.id === required)?.label ?? required);
  const entityProfiles = useMemo(() => saved.filter(profile => profile.entity === entity), [entity, saved]);

  function selectEntity(next: InputEntity): void {
    const nextDefinition = definitions.find(item => item.id === next) ?? definitions[0]!;
    setEntity(next);
    setMapping(cloneMapping(nextDefinition.profile.mapping));
    setCsv(nextDefinition.exportCsv(model, baselineScenarioId));
    setExceptionsCsv(next === "calendars" ? exportCalendarExceptionsCsv(model) : "");
    setWorkbook(null);
    setSelectedSheet("");
    setPreview(null);
    setError(null);
    setAcceptPartial(false);
    setMode("replaceById");
    setProfileId(nextDefinition.profile.id);
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

  function changeSheet(sheet: string): void {
    setSelectedSheet(sheet);
    setCsv(workbook?.csvBySheet[sheet] ?? "");
    setPreview(null);
  }

  function updateMapping(key: string, value: unknown): void {
    setMapping(current => ({ ...current, [key]: value }));
    setProfileId("custom");
    setPreview(null);
  }

  function chooseProfile(id: string): void {
    setProfileId(id);
    if (id === definition.profile.id) setMapping(cloneMapping(definition.profile.mapping));
    else {
      const profile = entityProfiles.find(item => item.id === id);
      if (profile) setMapping(cloneMapping(profile.mapping));
    }
    setPreview(null);
  }

  function saveProfile(): void {
    const label = profileName.trim();
    if (!label) return;
    const now = new Date().toISOString();
    const profile: StoredProfile = {
      id: `custom-${entity}-${crypto.randomUUID()}`,
      version: 1,
      entity,
      label,
      sourceSystem: String(mapping.sourceSystem ?? "Custom"),
      mapping: cloneMapping(mapping),
      createdAt: now,
      updatedAt: now,
    };
    const next = [...saved, profile];
    saveProfiles(next);
    setSaved(next);
    setProfileId(profile.id);
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
      setPreview(await previewInputImport(entity, model, csv, mapping, options()));
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
      const applied = await applyInputImport(entity, model, csv, mapping, options());
      await onModelChange(applied.model);
      setPreview(applied.import);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import could not be applied");
    } finally {
      setBusy(null);
    }
  }

  const totals = preview
    ? Object.entries(preview.controlTotals).filter(([, value]) => typeof value === "number" || typeof value === "string")
    : [];

  return <section className="panel data-workspace">
    <div className="panel-heading"><div><span className="eyebrow blue">Step 2 · Data</span><h2>Build and reconcile the assessment model</h2></div><p>Import in dependency order. Every entity uses the same file, mapping, preview, reconciliation, and atomic-apply workflow.</p></div>

    <div className="intake-grid">
      {definitions.map((item, index) => {
        const count = item.count(model);
        const blocked = item.dependencies.some(required => dependencyCount(model, required) === 0);
        return <button key={item.id} type="button" className={`intake-row ${entity === item.id ? "active" : ""}`} onClick={() => selectEntity(item.id)}>
          <span className="intake-order">{index + 1}</span>
          <span><strong>{item.label}</strong><small>{item.note}</small></span>
          <b>{count.toLocaleString()}</b>
          <i className={count > 0 ? "ready" : blocked ? "blocked" : "missing"}>{count > 0 ? "Loaded" : blocked ? "Waiting" : "Import"}</i>
        </button>;
      })}
    </div>

    <div className="data-editor">
      <div className="data-editor-header">
        <div><h3>{definition.label}</h3><p>{definition.note}</p></div>
        <div className="data-editor-actions">
          {entity !== "routing" && entity !== "demand" ? <label>Merge<select value={mode} onChange={event => setMode(event.target.value as "append" | "replaceById")}><option value="replaceById">Replace by ID</option><option value="append">Append new only</option></select></label> : null}
          <button className="secondary" type="button" onClick={() => downloadCsv(`${entity}-template.csv`, definition.exportCsv(model, baselineScenarioId))}>Download template</button>
        </div>
      </div>

      {!dependenciesReady ? <div className="dependency-note"><strong>Apply is waiting for:</strong> {missingDependencies.join(", ")}. File selection, profile mapping, and preview remain available.</div> : null}
      {error ? <div className="error-panel"><strong>Input issue</strong><span>{error}</span></div> : null}

      <div className="input-layout">
        <div className="card import-card">
          <div className="card-title-row"><h3>Source file</h3><label className="file-button">Choose CSV or Excel<input type="file" accept=".csv,.xlsx,.xls,.xlsm,.xlsb,text/csv" onChange={event => void readFile(event.target.files?.[0])} /></label></div>
          {workbook && workbook.sheetNames.length > 1 ? <label>Worksheet<select value={selectedSheet} onChange={event => changeSheet(event.target.value)}>{workbook.sheetNames.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label> : null}
          <textarea value={csv} onChange={event => { setCsv(event.target.value); setPreview(null); }} aria-label={`${definition.label} CSV content`} spellCheck={false} />
          <small>{busy === "reading" ? "Reading workbook…" : "Excel worksheets are converted to CSV in the browser; no spreadsheet logic enters the importer package."}</small>
          {entity === "calendars" ? <div className="exception-input"><div className="card-title-row"><h4>Optional exceptions</h4><label className="file-button compact">Choose file<input type="file" accept=".csv,.xlsx,.xls,.xlsm,.xlsb,text/csv" onChange={event => void readExceptionsFile(event.target.files?.[0])} /></label></div><textarea value={exceptionsCsv} onChange={event => { setExceptionsCsv(event.target.value); setPreview(null); }} aria-label="Calendar exceptions CSV" spellCheck={false} /></div> : null}
        </div>

        <div className="card mapping-card">
          <h3>Source profile and mapping</h3>
          <label>Profile<select value={profileId} onChange={event => chooseProfile(event.target.value)}><option value={definition.profile.id}>{definition.profile.label}</option>{entityProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · v{profile.version}</option>)}<option value="custom">Custom mapping</option></select></label>
          <div className="mapping-fields">{Object.entries(mapping).map(([key, value]) => {
            const choices = selectOptions[key];
            if (typeof value === "boolean") return <label key={key}>{key}<select value={String(value)} onChange={event => updateMapping(key, event.target.value === "true")}><option value="true">true</option><option value="false">false</option></select></label>;
            if (choices) return <label key={key}>{key}<select value={String(value ?? "")} onChange={event => updateMapping(key, event.target.value)}>{choices.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
            return <label key={key}>{key}<input value={String(value ?? "")} onChange={event => updateMapping(key, event.target.value)} /></label>;
          })}</div>
          <div className="save-profile"><input placeholder="Saved profile name" value={profileName} onChange={event => setProfileName(event.target.value)} /><button className="secondary" type="button" onClick={saveProfile} disabled={!profileName.trim()}>Save mapping</button></div>
          <button className="primary full" type="button" disabled={!csv.trim() || busy !== null} onClick={() => void previewImport()}>{busy === "previewing" ? "Checking…" : "Preview and reconcile"}</button>
        </div>
      </div>

      {preview ? <div className={`preview ${preview.controlTotals.rejectedRows > 0 ? "has-errors" : "clean"}`}>
        <div className="preview-head"><div><span>Import reconciliation</span><strong>{preview.controlTotals.acceptedRows} of {preview.controlTotals.inputRows} source rows accepted</strong></div><div><span>Rejected</span><strong>{preview.controlTotals.rejectedRows}</strong></div></div>
        <div className="control-total-grid">{totals.slice(0, 12).map(([key, value]) => <div key={key}><span>{key.replaceAll(/([A-Z])/g, " $1")}</span><strong>{typeof value === "number" ? value.toLocaleString() : String(value)}</strong></div>)}</div>
        {preview.issues.length > 0 ? <div className="issue-list">{preview.issues.slice(0, 20).map((issue, index) => <div key={`${issue.rowNumber ?? issue.entityKey ?? index}-${issue.code}-${index}`}><strong>{issue.rowNumber ? `Row ${issue.rowNumber}` : issue.entityKey ?? "Import"}</strong><span>{issue.message}</span></div>)}</div> : <p className="success-copy">All records passed mapping and dependency checks.</p>}
        <label className="checkbox"><input type="checkbox" checked={acceptPartial} onChange={event => setAcceptPartial(event.target.checked)} /> Apply accepted records when other rows or operations are rejected</label>
        <button className="primary" type="button" onClick={() => void applyImport()} disabled={!dependenciesReady || busy !== null || (preview.controlTotals.rejectedRows > 0 && !acceptPartial)}>{busy === "applying" ? "Applying…" : `Apply ${definition.label}`}</button>
      </div> : null}
    </div>

    <div className="panel-actions split"><button className="secondary" type="button" onClick={onBack}>Back</button><button className="primary" type="button" onClick={onContinue}>Check readiness</button></div>
  </section>;
}
