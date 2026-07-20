import { useCallback, useEffect, useMemo, useState } from "react";
import type { CapacityModel } from "@capacity/domain";
import ActionLogEditor from "./workbench/ActionLogEditor.js";
import { CalendarsEditor, ProductsEditor, ResourceGroupsEditor, ResourcesEditor } from "./workbench/CoreEditors.js";
import DemandEditor from "./workbench/DemandEditor.js";
import EntityImportPanel from "./workbench/EntityImportPanel.js";
import FootprintWipEditor from "./workbench/FootprintWipEditor.js";
import RoutingEditor from "./workbench/RoutingEditor.js";
import { definitionForEntity, definitionsForScope, type WorkbenchEntity, type WorkbenchScope, type WorkbenchTarget } from "./workbench/entityDefinitions.js";
import "./workbench/workbench.css";

interface ModelWorkbenchProps {
  model: CapacityModel;
  baselineScenarioId: string;
  scope: WorkbenchScope;
  target?: WorkbenchTarget | null;
  onTargetChange?: (target: WorkbenchTarget) => void;
  onSave: (model: CapacityModel, changedEntities: WorkbenchEntity[]) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
  onReturn?: () => void;
  continueLabel?: string;
}

function copyModel(model: CapacityModel): CapacityModel {
  return JSON.parse(JSON.stringify(model)) as CapacityModel;
}

function scopeHeading(scope: WorkbenchScope): { eyebrow: string; title: string; description: string } {
  switch (scope) {
    case "footprint": return { eyebrow: "Planning context", title: "Footprint and WIP", description: "Maintain occupancy assumptions and verify required space against available footprint." };
    case "actions": return { eyebrow: "Assessment governance", title: "Action Log", description: "Track data gaps, assumptions, risks, decisions, and follow-up work." };
    case "all": return { eyebrow: "Expert model access", title: "Model Workbench", description: "Inspect and maintain the complete assessment model from one operating surface." };
    case "core-data": return { eyebrow: "Step 2 · Data", title: "Build and reconcile the model", description: "Edit canonical records directly or import governed source data within each entity." };
  }
}

export default function ModelWorkbench({ model, baselineScenarioId, scope, target, onTargetChange, onSave, onDirtyChange, onBack, onContinue, onReturn, continueLabel }: ModelWorkbenchProps) {
  const definitions = useMemo(() => definitionsForScope(scope), [scope]);
  const preferredEntity = target && definitions.some(item => item.id === target.entity) ? target.entity : definitions[0]?.id ?? "products";
  const [entity, setEntity] = useState<WorkbenchEntity>(preferredEntity);
  const [recordId, setRecordId] = useState<string | undefined>(target?.recordId);
  const [parentRecordId, setParentRecordId] = useState<string | undefined>(target?.parentRecordId);
  const [draft, setDraft] = useState<CapacityModel>(() => copyModel(model));
  const [dirtyEntities, setDirtyEntities] = useState<Set<WorkbenchEntity>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const heading = scopeHeading(scope);
  const activeDefinition = definitionForEntity(entity);
  const dirty = dirtyEntities.size > 0;

  useEffect(() => {
    if (!dirty) setDraft(copyModel(model));
  }, [model, dirty]);

  useEffect(() => {
    const nextEntity = target && definitions.some(item => item.id === target.entity) ? target.entity : definitions[0]?.id;
    if (nextEntity) setEntity(nextEntity);
    setRecordId(target?.recordId);
    setParentRecordId(target?.parentRecordId);
  }, [target, definitions]);

  useEffect(() => {
    if (!definitions.some(item => item.id === entity) && definitions[0]) {
      setEntity(definitions[0].id);
      setRecordId(undefined);
      setParentRecordId(undefined);
    }
  }, [definitions, entity]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const mutate = useCallback((changedEntity: WorkbenchEntity, change: (next: CapacityModel) => void): void => {
    setDraft(current => {
      const next = copyModel(current);
      change(next);
      return next;
    });
    setDirtyEntities(current => new Set(current).add(changedEntity));
    setSaveError(null);
  }, []);

  const updateTarget = useCallback((nextEntity: WorkbenchEntity, nextRecordId?: string, nextParentRecordId?: string): void => {
    setEntity(nextEntity);
    setRecordId(nextRecordId);
    setParentRecordId(nextParentRecordId);
    onTargetChange?.({
      entity: nextEntity,
      ...(nextRecordId ? { recordId: nextRecordId } : {}),
      ...(nextParentRecordId ? { parentRecordId: nextParentRecordId } : {}),
      ...(target?.returnTo ? { returnTo: target.returnTo } : {}),
    });
  }, [onTargetChange, target?.returnTo]);

  const selectRecord = useCallback((nextRecordId: string, nextParentRecordId?: string): void => {
    updateTarget(entity, nextRecordId, nextParentRecordId);
  }, [entity, updateTarget]);

  function confirmAbandon(): boolean {
    return !dirty || window.confirm("Discard unsaved Workbench changes?");
  }

  function selectEntity(next: WorkbenchEntity): void {
    if (next === entity) return;
    setImportOpen(false);
    updateTarget(next);
  }

  function discard(): void {
    setDraft(copyModel(model));
    setDirtyEntities(new Set());
    setSaveError(null);
  }

  async function save(): Promise<void> {
    if (!dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const changed = [...dirtyEntities];
      await onSave(copyModel(draft), changed);
      setDirtyEntities(new Set());
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "The model could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function applyImportedModel(next: CapacityModel): Promise<void> {
    await onSave(next, [entity]);
    setDraft(copyModel(next));
    setDirtyEntities(new Set());
    setSaveError(null);
  }

  function guardedNavigate(callback: () => void): void {
    if (!confirmAbandon()) return;
    if (dirty) discard();
    callback();
  }

  const editorProps = {
    draft,
    mutate,
    ...(recordId ? { targetRecordId: recordId } : {}),
    ...(parentRecordId ? { parentRecordId } : {}),
    onSelectRecord: selectRecord,
  };

  return <section className="panel model-workbench">
    <div className="workbench-heading">
      <div>
        {target?.returnTo && onReturn ? <button className="workbench-breadcrumb" type="button" onClick={() => guardedNavigate(onReturn)}>← {target.returnTo.label}</button> : null}
        <span className="eyebrow blue">{heading.eyebrow}</span><h2>{heading.title}</h2><p>{heading.description}</p>
      </div>
      <div className="workbench-heading-actions">
        {activeDefinition.inputEntity ? <button className="secondary" type="button" disabled={dirty} title={dirty ? "Save or discard inline edits before importing" : ""} onClick={() => setImportOpen(true)}>Import {activeDefinition.shortLabel.toLowerCase()} from file</button> : null}
        <button className="secondary" type="button" disabled={!dirty || saving} onClick={discard}>Discard</button>
        <button className="primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Validating…" : "Save model changes"}</button>
      </div>
    </div>

    {saveError ? <div className="error-panel"><strong>Model not saved</strong><span>{saveError}</span></div> : null}
    {dirty ? <div className="workbench-dirty-banner"><strong>Unsaved model changes</strong><span>{[...dirtyEntities].map(item => definitionForEntity(item).shortLabel).join(", ")}</span></div> : null}

    <div className={`workbench-layout ${importOpen ? "with-import" : ""}`}>
      <nav className="entity-rail" aria-label="Model entities">
        {definitions.map(definition => {
          const isDirty = dirtyEntities.has(definition.id);
          return <button key={definition.id} type="button" className={entity === definition.id ? "active" : ""} onClick={() => selectEntity(definition.id)}><span><strong>{definition.shortLabel}</strong><small>{definition.note}</small></span><span className="entity-count">{definition.count(draft, baselineScenarioId).toLocaleString()}</span>{isDirty ? <i aria-label="Unsaved changes">•</i> : null}</button>;
        })}
      </nav>

      <div className="workbench-content">
        <div className="workbench-entity-heading"><div><span>Model entity</span><h3>{activeDefinition.label}</h3><p>{activeDefinition.note}</p></div>{recordId ? <code>{recordId}</code> : null}</div>
        {entity === "products" ? <ProductsEditor {...editorProps} /> : null}
        {entity === "calendars" ? <CalendarsEditor {...editorProps} /> : null}
        {entity === "resource-groups" ? <ResourceGroupsEditor {...editorProps} /> : null}
        {entity === "resources" ? <ResourcesEditor {...editorProps} /> : null}
        {entity === "routing" ? <RoutingEditor {...editorProps} /> : null}
        {entity === "demand" ? <DemandEditor {...editorProps} baselineScenarioId={baselineScenarioId} /> : null}
        {entity === "footprint" ? <FootprintWipEditor {...editorProps} scenarioId={baselineScenarioId} /> : null}
        {entity === "actions" ? <ActionLogEditor {...editorProps} /> : null}
      </div>

      {importOpen ? <EntityImportPanel entity={entity} model={model} baselineScenarioId={baselineScenarioId} blockedByUnsavedChanges={dirty} onApplied={applyImportedModel} onClose={() => setImportOpen(false)} /> : null}
    </div>

    <div className="panel-actions split"><button className="secondary" type="button" onClick={() => guardedNavigate(onBack)}>Back</button><button className="primary" type="button" onClick={() => guardedNavigate(onContinue)}>{continueLabel ?? "Continue"}</button></div>
  </section>;
}
