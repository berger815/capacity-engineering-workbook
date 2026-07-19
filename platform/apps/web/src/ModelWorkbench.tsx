import { useEffect, useMemo, useState } from "react";
import type { CapacityModel } from "@capacity/domain";
import {
  CalendarsEditor,
  ProductsEditor,
  ResourceGroupsEditor,
  ResourcesEditor,
  RoutingEditor,
  type ModelMutator,
} from "./workbench/CoreDataEditors.js";
import EntityImportPanel from "./workbench/EntityImportPanel.js";
import {
  ActionLogEditor,
  DemandEditor,
  FootprintWipEditor,
} from "./workbench/PlanningEditors.js";
import {
  entitiesForScope,
  entityDefinition,
  type WorkbenchEntity,
  type WorkbenchScope,
  type WorkbenchTarget,
} from "./workbench/entityDefinitions.js";
import "./workbench/workbench.css";

interface ModelWorkbenchProps {
  model: CapacityModel;
  baselineScenarioId: string;
  scope: WorkbenchScope;
  target?: WorkbenchTarget | null;
  onModelChange: (model: CapacityModel) => Promise<void> | void;
  onBack: () => void;
  onContinue: () => void;
  onReturn?: (target: NonNullable<WorkbenchTarget["returnTo"]>) => void;
}

function copyModel(model: CapacityModel): CapacityModel {
  return JSON.parse(JSON.stringify(model)) as CapacityModel;
}

function validEntity(entity: WorkbenchEntity, scope: WorkbenchScope): boolean {
  return entitiesForScope(scope).some(item => item.id === entity);
}

export default function ModelWorkbench({ model, baselineScenarioId, scope, target, onModelChange, onBack, onContinue, onReturn }: ModelWorkbenchProps) {
  const definitions = useMemo(() => entitiesForScope(scope), [scope]);
  const initialEntity = target && validEntity(target.entity, scope) ? target.entity : definitions[0]?.id ?? "products";
  const [entity, setEntity] = useState<WorkbenchEntity>(initialEntity);
  const [draft, setDraft] = useState<CapacityModel>(() => copyModel(model));
  const [dirtySections, setDirtySections] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const definition = entityDefinition(entity);
  const dirty = dirtySections.size > 0;

  useEffect(() => {
    setDraft(copyModel(model));
    setDirtySections(new Set());
  }, [model]);

  useEffect(() => {
    if (target && validEntity(target.entity, scope)) setEntity(target.entity);
    else if (!validEntity(entity, scope)) setEntity(definitions[0]?.id ?? "products");
  }, [target, scope, entity, definitions]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const mutate: ModelMutator = (section, change) => {
    setDraft(current => {
      const next = copyModel(current);
      change(next);
      return next;
    });
    setDirtySections(current => new Set([...current, section]));
  };

  async function save(): Promise<void> {
    if (!dirty) return;
    setSaving(true);
    try {
      await onModelChange(copyModel(draft));
      setDirtySections(new Set());
    } finally {
      setSaving(false);
    }
  }

  function discard(): void {
    setDraft(copyModel(model));
    setDirtySections(new Set());
  }

  function confirmLeave(action: () => void): void {
    if (!dirty || window.confirm("Discard unsaved Workbench changes?")) {
      if (dirty) discard();
      action();
    }
  }

  async function applyImport(next: CapacityModel): Promise<void> {
    await onModelChange(next);
    setDraft(copyModel(next));
    setDirtySections(new Set());
    setImportOpen(false);
  }

  const editor = entity === "products" ? <ProductsEditor model={draft} mutate={mutate} targetId={target?.recordId} />
    : entity === "calendars" ? <CalendarsEditor model={draft} mutate={mutate} targetId={target?.recordId} />
      : entity === "resource-groups" ? <ResourceGroupsEditor model={draft} mutate={mutate} targetId={target?.recordId} />
        : entity === "resources" ? <ResourcesEditor model={draft} mutate={mutate} targetId={target?.recordId} />
          : entity === "routing" ? <RoutingEditor model={draft} mutate={mutate} targetId={target?.recordId} parentTargetId={target?.parentRecordId} />
            : entity === "demand" ? <DemandEditor model={draft} mutate={mutate} scenarioId={baselineScenarioId} targetId={target?.recordId} />
              : entity === "footprint" ? <FootprintWipEditor model={draft} mutate={mutate} scenarioId={baselineScenarioId} targetId={target?.recordId} />
                : <ActionLogEditor model={draft} mutate={mutate} scenarioId={baselineScenarioId} targetId={target?.recordId} />;

  return <section className="panel model-workbench">
    <div className="panel-heading workbench-heading"><div><span className="eyebrow blue">Model Workbench</span><h2>{scope === "footprint" ? "Footprint and WIP" : scope === "actions" ? "Assessment Action Log" : scope === "all" ? "Inspect and maintain the complete model" : "Build and reconcile the assessment model"}</h2></div><p>One validated editing surface for master data, demand, footprint context, and assessment governance.</p></div>

    {target?.returnTo ? <div className="workbench-breadcrumb"><span>{target.returnTo.label}</span><b>›</b><strong>{definition.label}</strong><button className="secondary" type="button" onClick={() => confirmLeave(() => onReturn?.(target.returnTo!))}>Return to {target.returnTo.label}</button></div> : null}

    <div className="workbench-commandbar">
      <div><strong>{definition.label}</strong><span>{definition.note}</span></div>
      <div className="workbench-command-actions">
        {definition.inputEntity ? <button className="secondary" type="button" onClick={() => setImportOpen(true)} disabled={dirty}>Import from file</button> : <span className="planning-only">Direct planning record</span>}
        <button className="secondary" type="button" onClick={discard} disabled={!dirty || saving}>Discard</button>
        <button className="primary" type="button" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Validating…" : `Save ${dirtySections.size > 1 ? "model changes" : "changes"}`}</button>
      </div>
    </div>

    {dirty ? <div className="unsaved-banner"><strong>Unsaved model changes</strong><span>{[...dirtySections].map(item => entityDefinition(item as WorkbenchEntity).label).join(", ")}</span></div> : null}

    <div className={`workbench-layout ${importOpen ? "drawer-open" : ""}`}>
      <nav className="entity-rail" aria-label="Model entities">{definitions.map(item => {
        const count = item.count(draft);
        const sectionDirty = dirtySections.has(item.id) || (item.id === "footprint" && dirtySections.has("footprint")) || (item.id === "actions" && dirtySections.has("actions"));
        return <button key={item.id} type="button" className={entity === item.id ? "active" : ""} onClick={() => { setEntity(item.id); setImportOpen(false); }}><span><strong>{item.label}</strong><small>{item.note}</small></span><b>{count.toLocaleString()}</b>{sectionDirty ? <i title="Unsaved changes">•</i> : null}</button>;
      })}</nav>
      <div className="workbench-editor" data-entity={entity}>{editor}</div>
      {importOpen ? <EntityImportPanel entity={entity} model={model} baselineScenarioId={baselineScenarioId} blocked={dirty} onApplied={applyImport} onClose={() => setImportOpen(false)} /> : null}
    </div>

    <div className="panel-actions split"><button className="secondary" type="button" onClick={() => confirmLeave(onBack)}>Back</button><button className="primary" type="button" onClick={() => confirmLeave(onContinue)}>{scope === "core-data" || scope === "all" ? "Check readiness" : scope === "footprint" ? "Continue to recovery" : "Continue to decision"}</button></div>
  </section>;
}
