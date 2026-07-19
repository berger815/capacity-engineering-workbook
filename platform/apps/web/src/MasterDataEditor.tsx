import { useEffect, useMemo, useState } from "react";
import type {
  ApplicabilityState,
  CapacityModel,
  CapacityUnit,
  PhaseAllocation,
  ResourceKind,
  RoutingOperation,
  RoutingRevision,
} from "@capacity/domain";

interface MasterDataEditorProps {
  model: CapacityModel;
  onSave: (model: CapacityModel) => Promise<void> | void;
  onBack: () => void;
  onContinue: () => void;
}

type Section = "products" | "calendars" | "groups" | "resources" | "routing";

function copyModel(model: CapacityModel): CapacityModel {
  return JSON.parse(JSON.stringify(model)) as CapacityModel;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function optionalText(target: Record<string, unknown>, key: string, value: string): void {
  if (value.trim()) target[key] = value.trim();
  else delete target[key];
}

export default function MasterDataEditor({ model, onSave, onBack, onContinue }: MasterDataEditorProps) {
  const [section, setSection] = useState<Section>("products");
  const [draft, setDraft] = useState<CapacityModel>(() => copyModel(model));
  const [selectedRevisionId, setSelectedRevisionId] = useState(model.routingRevisions[0]?.id ?? "");
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(copyModel(model));
    setDirty(false);
  }, [model]);

  const revision = draft.routingRevisions.find(item => item.id === selectedRevisionId) ?? draft.routingRevisions[0];
  const operation = revision?.operations.find(item => item.id === selectedOperationId) ?? revision?.operations[0];

  useEffect(() => {
    if (revision && revision.id !== selectedRevisionId) setSelectedRevisionId(revision.id);
    if (revision && !revision.operations.some(item => item.id === selectedOperationId)) setSelectedOperationId(revision.operations[0]?.id ?? "");
  }, [revision, selectedRevisionId, selectedOperationId]);

  const references = useMemo(() => ({
    product: new Set([...draft.demand.map(item => item.productId), ...draft.routingRevisions.map(item => item.productId)]),
    calendar: new Set(draft.resourceGroups.map(item => item.calendarId)),
    group: new Set([...draft.resources.map(item => item.resourceGroupId), ...draft.routingRevisions.flatMap(item => item.operations.flatMap(operationItem => operationItem.requirements.map(requirement => requirement.resourceGroupId)))]),
    resource: new Set((draft.scenarioActions ?? []).flatMap(action => action.kind === "resourceQuantityDelta" ? [action.resourceId] : [])),
  }), [draft]);

  function mutate(change: (next: CapacityModel) => void): void {
    setDraft(current => {
      const next = copyModel(current);
      change(next);
      return next;
    });
    setDirty(true);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await onSave(copyModel(draft));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function addProduct(): void {
    const organizationNodeId = draft.organization[0]?.id;
    if (!organizationNodeId) return;
    mutate(next => next.products.push({ id: newId("product"), name: "New product", organizationNodeId }));
  }

  function addCalendar(): void {
    mutate(next => next.calendars.push({ id: newId("calendar"), name: "New calendar", timezone: "America/New_York", weeklyMinutes: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 }, exceptions: [] }));
  }

  function addGroup(): void {
    const organizationNodeId = draft.organization[0]?.id;
    const calendarId = draft.calendars[0]?.id;
    if (!organizationNodeId || !calendarId) return;
    mutate(next => next.resourceGroups.push({ id: newId("group"), name: "New resource group", organizationNodeId, kind: "labor", capacityUnit: "hours", calendarId, pooled: true }));
  }

  function addResource(): void {
    const resourceGroupId = draft.resourceGroups[0]?.id;
    if (!resourceGroupId) return;
    mutate(next => next.resources.push({ id: newId("resource"), resourceGroupId, name: "New resource", quantity: 1, ratePerAvailableHour: 1, availability: 1, performance: 1, quality: 1 }));
  }

  function addRevision(): void {
    const productId = draft.products[0]?.id;
    const group = draft.resourceGroups[0];
    if (!productId || !group) return;
    const id = newId("routing");
    const phaseId = `${id}:phase-1`;
    const operationId = `${id}:operation-10`;
    mutate(next => next.routingRevisions.push({
      id,
      productId,
      revision: "A",
      effectiveFrom: next.horizonStart,
      phases: [{ id: phaseId, name: "Production", startWeeksBeforeShip: 4, endWeeksBeforeShip: 0, allocation: "spread" }],
      operations: [{ id: operationId, sequence: 10, name: "Operation 10", phaseId, requirements: [{ id: `${operationId}:${group.id}`, resourceGroupId: group.id, requirement: { state: "value", value: 1, unit: group.capacityUnit } }] }],
      sourceSystem: "Assessment Studio edit",
    }));
    setSelectedRevisionId(id);
    setSelectedOperationId(operationId);
  }

  function addPhase(target: RoutingRevision): void {
    const id = `${target.id}:phase-${target.phases.length + 1}`;
    mutate(next => {
      const found = next.routingRevisions.find(item => item.id === target.id);
      found?.phases.push({ id, name: `Phase ${target.phases.length + 1}`, startWeeksBeforeShip: 4, endWeeksBeforeShip: 0, allocation: "spread" });
    });
  }

  function addOperation(target: RoutingRevision): void {
    const phaseId = target.phases[0]?.id;
    if (!phaseId) return;
    const id = `${target.id}:operation-${(target.operations.length + 1) * 10}`;
    mutate(next => {
      const found = next.routingRevisions.find(item => item.id === target.id);
      found?.operations.push({ id, sequence: (target.operations.length + 1) * 10, name: `Operation ${(target.operations.length + 1) * 10}`, phaseId, requirements: [] });
    });
    setSelectedOperationId(id);
  }

  function addRequirement(targetRevision: RoutingRevision, targetOperation: RoutingOperation): void {
    const group = draft.resourceGroups.find(item => !targetOperation.requirements.some(requirement => requirement.resourceGroupId === item.id));
    if (!group) return;
    mutate(next => {
      const found = next.routingRevisions.find(item => item.id === targetRevision.id)?.operations.find(item => item.id === targetOperation.id);
      found?.requirements.push({ id: `${targetOperation.id}:${group.id}`, resourceGroupId: group.id, requirement: { state: "value", value: 1, unit: group.capacityUnit } });
    });
  }

  return <section className="panel master-editor">
    <div className="panel-heading"><div><span className="eyebrow blue">Step 2 · Data</span><h2>Edit the canonical model</h2></div><p>Changes remain local until saved. IDs are stable; referenced records cannot be deleted.</p></div>
    <div className="master-editor-tabs" role="tablist">
      {(["products", "calendars", "groups", "resources", "routing"] as Section[]).map(item => <button key={item} type="button" className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item === "groups" ? "Resource groups" : item === "routing" ? "Routing structure" : item}</button>)}
    </div>

    {section === "products" ? <div className="table-card"><div className="card-title-row"><div><h3>Products</h3><small>Create and maintain the canonical product master.</small></div><button className="secondary" type="button" onClick={addProduct}>Add product</button></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Family</th><th>Organization</th><th /></tr></thead><tbody>{draft.products.map(product => <tr key={product.id}><td><code>{product.id}</code></td><td><input value={product.name} onChange={event => mutate(next => { const found = next.products.find(item => item.id === product.id); if (found) found.name = event.target.value; })} /></td><td><input value={product.family ?? ""} onChange={event => mutate(next => { const found = next.products.find(item => item.id === product.id); if (found) optionalText(found as unknown as Record<string, unknown>, "family", event.target.value); })} /></td><td><select value={product.organizationNodeId} onChange={event => mutate(next => { const found = next.products.find(item => item.id === product.id); if (found) found.organizationNodeId = event.target.value; })}>{draft.organization.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></td><td>{references.product.has(product.id) ? <span className="reference-lock">Referenced</span> : <button className="text-danger" type="button" onClick={() => mutate(next => { next.products = next.products.filter(item => item.id !== product.id); })}>Remove</button>}</td></tr>)}</tbody></table></div></div> : null}

    {section === "calendars" ? <div className="table-card"><div className="card-title-row"><div><h3>Working calendars</h3><small>Minutes are productive availability by weekday before exceptions.</small></div><button className="secondary" type="button" onClick={addCalendar}>Add calendar</button></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Timezone</th>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day => <th className="number" key={day}>{day}</th>)}<th /></tr></thead><tbody>{draft.calendars.map(calendar => <tr key={calendar.id}><td><code>{calendar.id}</code></td><td><input value={calendar.name} onChange={event => mutate(next => { const found = next.calendars.find(item => item.id === calendar.id); if (found) found.name = event.target.value; })} /></td><td><input value={calendar.timezone} onChange={event => mutate(next => { const found = next.calendars.find(item => item.id === calendar.id); if (found) found.timezone = event.target.value; })} /></td>{([0,1,2,3,4,5,6] as const).map(day => <td key={day}><input className="number-input" type="number" min="0" max="1440" value={calendar.weeklyMinutes[day] ?? 0} onChange={event => mutate(next => { const found = next.calendars.find(item => item.id === calendar.id); if (!found) return; const value = Number(event.target.value); if (value > 0) found.weeklyMinutes[day] = value; else delete found.weeklyMinutes[day]; })} /></td>)}<td>{references.calendar.has(calendar.id) ? <span className="reference-lock">Referenced</span> : <button className="text-danger" type="button" onClick={() => mutate(next => { next.calendars = next.calendars.filter(item => item.id !== calendar.id); })}>Remove</button>}</td></tr>)}</tbody></table></div></div> : null}

    {section === "groups" ? <div className="table-card"><div className="card-title-row"><div><h3>Resource groups</h3><small>Groups define the constraint class, unit, calendar, and pooling basis.</small></div><button className="secondary" type="button" onClick={addGroup}>Add group</button></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Kind</th><th>Unit</th><th>Calendar</th><th>Organization</th><th>Pooled</th><th /></tr></thead><tbody>{draft.resourceGroups.map(group => <tr key={group.id}><td><code>{group.id}</code></td><td><input value={group.name} onChange={event => mutate(next => { const found = next.resourceGroups.find(item => item.id === group.id); if (found) found.name = event.target.value; })} /></td><td><select value={group.kind} onChange={event => mutate(next => { const found = next.resourceGroups.find(item => item.id === group.id); if (found) found.kind = event.target.value as ResourceKind; })}>{["labor","equipment","skill","tooling","space","external","other"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><select value={group.capacityUnit} onChange={event => mutate(next => { const found = next.resourceGroups.find(item => item.id === group.id); if (found) found.capacityUnit = event.target.value as CapacityUnit; })}>{["hours","units","squareFeet","palletPositions","custom"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><select value={group.calendarId} onChange={event => mutate(next => { const found = next.resourceGroups.find(item => item.id === group.id); if (found) found.calendarId = event.target.value; })}>{draft.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></td><td><select value={group.organizationNodeId} onChange={event => mutate(next => { const found = next.resourceGroups.find(item => item.id === group.id); if (found) found.organizationNodeId = event.target.value; })}>{draft.organization.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></td><td><input type="checkbox" checked={group.pooled} onChange={event => mutate(next => { const found = next.resourceGroups.find(item => item.id === group.id); if (found) found.pooled = event.target.checked; })} /></td><td>{references.group.has(group.id) ? <span className="reference-lock">Referenced</span> : <button className="text-danger" type="button" onClick={() => mutate(next => { next.resourceGroups = next.resourceGroups.filter(item => item.id !== group.id); })}>Remove</button>}</td></tr>)}</tbody></table></div></div> : null}

    {section === "resources" ? <div className="table-card"><div className="card-title-row"><div><h3>Resources</h3><small>Maintain effective quantity, conversion rate, and availability factors.</small></div><button className="secondary" type="button" onClick={addResource}>Add resource</button></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Group</th><th className="number">Qty.</th><th className="number">Rate</th><th className="number">Avail.</th><th className="number">Perf.</th><th className="number">Quality</th><th>From</th><th>To</th><th /></tr></thead><tbody>{draft.resources.map(resource => <tr key={resource.id}><td><code>{resource.id}</code></td><td><input value={resource.name} onChange={event => mutate(next => { const found = next.resources.find(item => item.id === resource.id); if (found) found.name = event.target.value; })} /></td><td><select value={resource.resourceGroupId} onChange={event => mutate(next => { const found = next.resources.find(item => item.id === resource.id); if (found) found.resourceGroupId = event.target.value; })}>{draft.resourceGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></td>{(["quantity","ratePerAvailableHour","availability","performance","quality"] as const).map(field => <td key={field}><input className="number-input" type="number" min="0" step="0.01" value={resource[field]} onChange={event => mutate(next => { const found = next.resources.find(item => item.id === resource.id); if (found) found[field] = Number(event.target.value); })} /></td>)}<td><input type="date" value={resource.effectiveFrom ?? ""} onChange={event => mutate(next => { const found = next.resources.find(item => item.id === resource.id); if (found) optionalText(found as unknown as Record<string, unknown>, "effectiveFrom", event.target.value); })} /></td><td><input type="date" value={resource.effectiveTo ?? ""} onChange={event => mutate(next => { const found = next.resources.find(item => item.id === resource.id); if (found) optionalText(found as unknown as Record<string, unknown>, "effectiveTo", event.target.value); })} /></td><td>{references.resource.has(resource.id) ? <span className="reference-lock">Referenced</span> : <button className="text-danger" type="button" onClick={() => mutate(next => { next.resources = next.resources.filter(item => item.id !== resource.id); })}>Remove</button>}</td></tr>)}</tbody></table></div></div> : null}

    {section === "routing" ? <div className="routing-builder">
      <div className="routing-list card"><div className="card-title-row"><h3>Revisions</h3><button className="secondary" type="button" onClick={addRevision} disabled={!draft.products.length || !draft.resourceGroups.length}>Add revision</button></div>{draft.routingRevisions.map(item => <button key={item.id} type="button" className={revision?.id === item.id ? "active" : ""} onClick={() => { setSelectedRevisionId(item.id); setSelectedOperationId(item.operations[0]?.id ?? ""); }}><strong>{draft.products.find(product => product.id === item.productId)?.name ?? item.productId}</strong><small>{item.revision} · {item.effectiveFrom}</small></button>)}</div>
      {revision ? <div className="routing-detail">
        <div className="table-card"><div className="card-title-row"><div><h3>Revision</h3><small><code>{revision.id}</code></small></div><button className="text-danger" type="button" onClick={() => mutate(next => { next.routingRevisions = next.routingRevisions.filter(item => item.id !== revision.id); })}>Remove revision</button></div><div className="routing-meta-grid"><label>Product<select value={revision.productId} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.productId = event.target.value; })}>{draft.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Revision<input value={revision.revision} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.revision = event.target.value; })} /></label><label>Effective from<input type="date" value={revision.effectiveFrom} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.effectiveFrom = event.target.value; })} /></label><label>Effective to<input type="date" value={revision.effectiveTo ?? ""} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) optionalText(found as unknown as Record<string, unknown>, "effectiveTo", event.target.value); })} /></label></div></div>
        <div className="table-card"><div className="card-title-row"><div><h3>Lead-time phases</h3><small>Operations must reference one of these phases.</small></div><button className="secondary" type="button" onClick={() => addPhase(revision)}>Add phase</button></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th className="number">Start</th><th className="number">End</th><th>Allocation</th><th /></tr></thead><tbody>{revision.phases.map(phase => <tr key={phase.id}><td><code>{phase.id.split(":").at(-1)}</code></td><td><input value={phase.name} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.name = event.target.value; })} /></td><td><input className="number-input" type="number" min="0" value={phase.startWeeksBeforeShip} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.startWeeksBeforeShip = Number(event.target.value); })} /></td><td><input className="number-input" type="number" min="0" value={phase.endWeeksBeforeShip} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.endWeeksBeforeShip = Number(event.target.value); })} /></td><td><select value={phase.allocation} onChange={event => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.allocation = event.target.value as PhaseAllocation; })}>{["spread","shiftToStart","shiftToEnd","shiftToMidpoint"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td>{revision.phases.length === 1 || revision.operations.some(item => item.phaseId === phase.id) ? <span className="reference-lock">Referenced</span> : <button className="text-danger" type="button" onClick={() => mutate(next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.phases = found.phases.filter(item => item.id !== phase.id); })}>Remove</button>}</td></tr>)}</tbody></table></div></div>
        <div className="routing-columns"><div className="table-card"><div className="card-title-row"><div><h3>Operations</h3><small>Select an operation to edit its requirements.</small></div><button className="secondary" type="button" onClick={() => addOperation(revision)}>Add operation</button></div><div className="table-wrap"><table><thead><tr><th>Seq.</th><th>Name</th><th>Phase</th><th /></tr></thead><tbody>{revision.operations.map(item => <tr key={item.id} className={operation?.id === item.id ? "selected-row" : ""} onClick={() => setSelectedOperationId(item.id)}><td><input className="number-input" type="number" min="0" value={item.sequence} onChange={event => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === item.id); if (found) found.sequence = Number(event.target.value); })} /></td><td><input value={item.name} onChange={event => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === item.id); if (found) found.name = event.target.value; })} /></td><td><select value={item.phaseId} onChange={event => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === item.id); if (found) found.phaseId = event.target.value; })}>{revision.phases.map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></td><td>{revision.operations.length === 1 ? <span className="reference-lock">Required</span> : <button className="text-danger" type="button" onClick={event => { event.stopPropagation(); mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id); if (found) found.operations = found.operations.filter(candidate => candidate.id !== item.id); }); }}>Remove</button>}</td></tr>)}</tbody></table></div></div>
        {operation ? <div className="table-card"><div className="card-title-row"><div><h3>{operation.name} requirements</h3><small>Only applicable resources belong here.</small></div><button className="secondary" type="button" onClick={() => addRequirement(revision, operation)} disabled={operation.requirements.length >= draft.resourceGroups.length}>Add requirement</button></div><div className="table-wrap"><table><thead><tr><th>Resource</th><th>State</th><th className="number">Standard</th><th>Unit</th><th /></tr></thead><tbody>{operation.requirements.map(requirement => <tr key={requirement.id}><td><select value={requirement.resourceGroupId} onChange={event => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id)?.requirements.find(candidate => candidate.id === requirement.id); const group = next.resourceGroups.find(candidate => candidate.id === event.target.value); if (found && group) { found.resourceGroupId = group.id; found.requirement.unit = group.capacityUnit; found.id = `${operation.id}:${group.id}`; } })}>{draft.resourceGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></td><td><select value={requirement.requirement.state} onChange={event => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id)?.requirements.find(candidate => candidate.id === requirement.id); if (!found) return; found.requirement.state = event.target.value as ApplicabilityState; if (found.requirement.state === "value") found.requirement.value ??= 0; else delete found.requirement.value; })}>{["value","zero","missing","notApplicable"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input className="number-input" type="number" min="0" step="0.001" disabled={requirement.requirement.state !== "value"} value={requirement.requirement.value ?? 0} onChange={event => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id)?.requirements.find(candidate => candidate.id === requirement.id); if (found) found.requirement.value = Number(event.target.value); })} /></td><td>{requirement.requirement.unit}</td><td><button className="text-danger" type="button" onClick={() => mutate(next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id); if (found) found.requirements = found.requirements.filter(candidate => candidate.id !== requirement.id); })}>Remove</button></td></tr>)}</tbody></table></div></div> : null}</div>
      </div> : <div className="empty-state"><h3>No routing revisions</h3><p>Create a product, resource group, and first routing revision.</p><button className="primary" type="button" onClick={addRevision}>Add routing revision</button></div>}
    </div> : null}

    <div className="editor-save-bar"><span>{dirty ? "Unsaved model changes" : "Model matches the saved assessment"}</span><div><button className="secondary" type="button" disabled={!dirty || saving} onClick={() => { setDraft(copyModel(model)); setDirty(false); }}>Discard</button><button className="primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Validating…" : "Save model changes"}</button></div></div>
    <div className="panel-actions split"><button className="secondary" type="button" onClick={onBack}>Back</button><button className="primary" type="button" onClick={onContinue}>Check readiness</button></div>
  </section>;
}
