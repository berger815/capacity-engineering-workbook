import { useEffect, useState } from "react";
import type { ApplicabilityState, PhaseAllocation, RoutingOperation, RoutingRevision } from "@capacity/domain";
import type { WorkbenchEditorProps } from "./editorTypes.js";
import { createWorkbenchId as newId, optionalText } from "./editorTypes.js";

export default function RoutingEditor({ draft, mutate, targetRecordId, parentRecordId, onSelectRecord }: WorkbenchEditorProps) {
  const [selectedRevisionId, setSelectedRevisionId] = useState(parentRecordId ?? targetRecordId ?? draft.routingRevisions[0]?.id ?? "");
  const [selectedOperationId, setSelectedOperationId] = useState(parentRecordId ? targetRecordId ?? "" : "");
  const revision = draft.routingRevisions.find(item => item.id === selectedRevisionId) ?? draft.routingRevisions[0];
  const operation = revision?.operations.find(item => item.id === selectedOperationId) ?? revision?.operations[0];

  useEffect(() => {
    if (parentRecordId) setSelectedRevisionId(parentRecordId);
    else if (targetRecordId && draft.routingRevisions.some(item => item.id === targetRecordId)) setSelectedRevisionId(targetRecordId);
    if (parentRecordId && targetRecordId) setSelectedOperationId(targetRecordId);
  }, [parentRecordId, targetRecordId, draft.routingRevisions]);

  useEffect(() => {
    if (revision && revision.id !== selectedRevisionId) setSelectedRevisionId(revision.id);
    if (revision && !revision.operations.some(item => item.id === selectedOperationId)) setSelectedOperationId(revision.operations[0]?.id ?? "");
  }, [revision, selectedRevisionId, selectedOperationId]);

  function selectRevision(id: string): void {
    const next = draft.routingRevisions.find(item => item.id === id);
    setSelectedRevisionId(id);
    setSelectedOperationId(next?.operations[0]?.id ?? "");
    onSelectRecord?.(id);
  }

  function selectOperation(id: string): void {
    setSelectedOperationId(id);
    if (revision) onSelectRecord?.(id, revision.id);
  }

  function addRevision(): void {
    const productId = draft.products[0]?.id;
    const group = draft.resourceGroups[0];
    if (!productId || !group) return;
    const id = newId("routing");
    const phaseId = `${id}:phase-1`;
    const operationId = `${id}:operation-10`;
    mutate("routing", next => next.routingRevisions.push({
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
    onSelectRecord?.(id);
  }

  function addPhase(target: RoutingRevision): void {
    const id = `${target.id}:phase-${target.phases.length + 1}`;
    mutate("routing", next => {
      const found = next.routingRevisions.find(item => item.id === target.id);
      found?.phases.push({ id, name: `Phase ${target.phases.length + 1}`, startWeeksBeforeShip: 4, endWeeksBeforeShip: 0, allocation: "spread" });
    });
  }

  function addOperation(target: RoutingRevision): void {
    const phaseId = target.phases[0]?.id;
    if (!phaseId) return;
    const id = `${target.id}:operation-${(target.operations.length + 1) * 10}`;
    mutate("routing", next => {
      const found = next.routingRevisions.find(item => item.id === target.id);
      found?.operations.push({ id, sequence: (target.operations.length + 1) * 10, name: `Operation ${(target.operations.length + 1) * 10}`, phaseId, requirements: [] });
    });
    setSelectedOperationId(id);
    onSelectRecord?.(id, target.id);
  }

  function addRequirement(targetRevision: RoutingRevision, targetOperation: RoutingOperation): void {
    const group = draft.resourceGroups.find(item => !targetOperation.requirements.some(requirement => requirement.resourceGroupId === item.id));
    if (!group) return;
    mutate("routing", next => {
      const found = next.routingRevisions.find(item => item.id === targetRevision.id)?.operations.find(item => item.id === targetOperation.id);
      found?.requirements.push({ id: `${targetOperation.id}:${group.id}`, resourceGroupId: group.id, requirement: { state: "value", value: 1, unit: group.capacityUnit } });
    });
  }

  return <div className="workbench-editor routing-builder">
    <div className="routing-list card"><div className="card-title-row"><div><h3>Routing revisions</h3><small>Product-specific and effective-dated.</small></div><button className="secondary" type="button" onClick={addRevision} disabled={!draft.products.length || !draft.resourceGroups.length}>Add revision</button></div>{draft.routingRevisions.map(item => <button key={item.id} type="button" className={revision?.id === item.id ? "active" : ""} onClick={() => selectRevision(item.id)}><strong>{draft.products.find(product => product.id === item.productId)?.name ?? item.productId}</strong><small>{item.revision} · {item.effectiveFrom}</small></button>)}</div>
    {revision ? <div className="routing-detail">
      <div className="table-card"><div className="card-title-row"><div><h3>Revision</h3><small><code>{revision.id}</code></small></div><button className="text-danger" type="button" onClick={() => mutate("routing", next => { next.routingRevisions = next.routingRevisions.filter(item => item.id !== revision.id); })}>Remove revision</button></div><div className="routing-meta-grid"><label>Product<select value={revision.productId} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.productId = event.target.value; })}>{draft.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Revision<input value={revision.revision} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.revision = event.target.value; })} /></label><label>Effective from<input type="date" value={revision.effectiveFrom} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.effectiveFrom = event.target.value; })} /></label><label>Effective to<input type="date" value={revision.effectiveTo ?? ""} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) optionalText(found as unknown as Record<string, unknown>, "effectiveTo", event.target.value); })} /></label></div></div>
      <div className="table-card"><div className="card-title-row"><div><h3>Lead-time phases</h3><small>These phases position load relative to ship date.</small></div><button className="secondary" type="button" onClick={() => addPhase(revision)}>Add phase</button></div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th className="number">Start weeks</th><th className="number">End weeks</th><th>Allocation</th><th /></tr></thead><tbody>{revision.phases.map(phase => <tr key={phase.id}><td><code>{phase.id.split(":").at(-1)}</code></td><td><input value={phase.name} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.name = event.target.value; })} /></td><td><input className="number-input" type="number" min="0" value={phase.startWeeksBeforeShip} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.startWeeksBeforeShip = Number(event.target.value); })} /></td><td><input className="number-input" type="number" min="0" value={phase.endWeeksBeforeShip} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.endWeeksBeforeShip = Number(event.target.value); })} /></td><td><select value={phase.allocation} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id)?.phases.find(item => item.id === phase.id); if (found) found.allocation = event.target.value as PhaseAllocation; })}>{["spread","shiftToStart","shiftToEnd","shiftToMidpoint"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td>{revision.phases.length === 1 || revision.operations.some(item => item.phaseId === phase.id) ? <span className="reference-lock">Referenced</span> : <button className="text-danger" type="button" onClick={() => mutate("routing", next => { const found = next.routingRevisions.find(item => item.id === revision.id); if (found) found.phases = found.phases.filter(item => item.id !== phase.id); })}>Remove</button>}</td></tr>)}</tbody></table></div></div>
      <div className="routing-columns"><div className="table-card"><div className="card-title-row"><div><h3>Operations</h3><small>Select an operation to edit its resource requirements.</small></div><button className="secondary" type="button" onClick={() => addOperation(revision)}>Add operation</button></div><div className="table-wrap"><table><thead><tr><th>Seq.</th><th>Name</th><th>Phase</th><th /></tr></thead><tbody>{revision.operations.map(item => <tr key={item.id} className={operation?.id === item.id ? "selected-row" : ""} onClick={() => selectOperation(item.id)}><td><input className="number-input" type="number" min="0" value={item.sequence} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === item.id); if (found) found.sequence = Number(event.target.value); })} /></td><td><input value={item.name} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === item.id); if (found) found.name = event.target.value; })} /></td><td><select value={item.phaseId} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === item.id); if (found) found.phaseId = event.target.value; })}>{revision.phases.map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></td><td>{revision.operations.length === 1 ? <span className="reference-lock">Required</span> : <button className="text-danger" type="button" onClick={event => { event.stopPropagation(); mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id); if (found) found.operations = found.operations.filter(candidate => candidate.id !== item.id); }); }}>Remove</button>}</td></tr>)}</tbody></table></div></div>
      {operation ? <div className="table-card"><div className="card-title-row"><div><h3>{operation.name} requirements</h3><small>Only applicable resources belong in the sparse route.</small></div><button className="secondary" type="button" onClick={() => addRequirement(revision, operation)} disabled={operation.requirements.length >= draft.resourceGroups.length}>Add requirement</button></div><div className="table-wrap"><table><thead><tr><th>Resource group</th><th>State</th><th className="number">Standard</th><th>Unit</th><th /></tr></thead><tbody>{operation.requirements.map(requirement => <tr key={requirement.id}><td><select value={requirement.resourceGroupId} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id)?.requirements.find(candidate => candidate.id === requirement.id); const group = next.resourceGroups.find(candidate => candidate.id === event.target.value); if (found && group) { found.resourceGroupId = group.id; found.requirement.unit = group.capacityUnit; found.id = `${operation.id}:${group.id}`; } })}>{draft.resourceGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></td><td><select value={requirement.requirement.state} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id)?.requirements.find(candidate => candidate.id === requirement.id); if (!found) return; found.requirement.state = event.target.value as ApplicabilityState; if (found.requirement.state === "value") found.requirement.value ??= 0; else delete found.requirement.value; })}>{["value","zero","missing","notApplicable"].map(value => <option key={value} value={value}>{value}</option>)}</select></td><td><input className="number-input" type="number" min="0" step="0.001" disabled={requirement.requirement.state !== "value"} value={requirement.requirement.value ?? 0} onChange={event => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id)?.requirements.find(candidate => candidate.id === requirement.id); if (found) found.requirement.value = Number(event.target.value); })} /></td><td>{requirement.requirement.unit}</td><td><button className="text-danger" type="button" onClick={() => mutate("routing", next => { const found = next.routingRevisions.find(candidate => candidate.id === revision.id)?.operations.find(candidate => candidate.id === operation.id); if (found) found.requirements = found.requirements.filter(candidate => candidate.id !== requirement.id); })}>Remove</button></td></tr>)}</tbody></table></div></div> : null}</div>
    </div> : <div className="empty-state"><h3>No routing revisions</h3><p>Create a product, resource group, and first routing revision.</p><button className="primary" type="button" onClick={addRevision}>Add routing revision</button></div>}
  </div>;
}
