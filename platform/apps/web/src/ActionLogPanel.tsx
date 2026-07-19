import { useMemo, useState } from "react";
import type { ActionLogCategory, CapacityModel } from "@capacity/domain";

interface ActionLogPanelProps {
  model: CapacityModel;
  onModelChange: (model: CapacityModel) => void;
  onBack: () => void;
  onContinue: () => void;
}

function copyModel(model: CapacityModel): CapacityModel {
  return JSON.parse(JSON.stringify(model)) as CapacityModel;
}

const categories: ActionLogCategory[] = ["data", "assumption", "risk", "decision", "followUp", "general"];

export default function ActionLogPanel({ model, onModelChange, onBack, onContinue }: ActionLogPanelProps) {
  const [category, setCategory] = useState<ActionLogCategory | "all">("all");
  const [showResolved, setShowResolved] = useState(true);
  const entries = useMemo(() => [...(model.actionLog ?? [])]
    .filter(entry => category === "all" || entry.category === category)
    .filter(entry => showResolved || !entry.resolvedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [model.actionLog, category, showResolved]);

  function change(update: (next: CapacityModel) => void): void {
    const next = copyModel(model);
    next.actionLog ??= [];
    update(next);
    onModelChange(next);
  }

  function addEntry(): void {
    change(next => next.actionLog?.unshift({
      id: `log-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      category: "general",
      note: "New assessment note",
    }));
  }

  return <section className="panel action-log-panel">
    <div className="panel-heading"><div><span className="eyebrow blue">Assessment governance</span><h2>Action Log</h2></div><p>Track data gaps, assumptions, risks, decisions, and follow-up work without turning every note into a recovery action.</p></div>
    <div className="action-log-toolbar">
      <label>Category<select value={category} onChange={event => setCategory(event.target.value as ActionLogCategory | "all")}><option value="all">All categories</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="checkbox"><input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} /> Show resolved</label>
      <button className="primary" type="button" onClick={addEntry}>Add log entry</button>
    </div>
    <div className="metric-grid four compact">
      <div className="metric"><span>Total entries</span><strong>{model.actionLog?.length ?? 0}</strong></div>
      <div className="metric"><span>Open</span><strong>{model.actionLog?.filter(entry => !entry.resolvedAt).length ?? 0}</strong></div>
      <div className="metric"><span>Due</span><strong>{model.actionLog?.filter(entry => !entry.resolvedAt && entry.dueDate && entry.dueDate <= new Date().toISOString().slice(0, 10)).length ?? 0}</strong></div>
      <div className="metric"><span>Decisions</span><strong>{model.actionLog?.filter(entry => entry.category === "decision").length ?? 0}</strong></div>
    </div>
    <div className="table-card"><div className="table-wrap"><table><thead><tr><th>Status</th><th>Category</th><th>Note</th><th>Owner</th><th>Due</th><th>Related entity</th><th>Created</th><th /></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className={entry.resolvedAt ? "resolved-row" : ""}>
      <td><button type="button" className={`status-toggle ${entry.resolvedAt ? "resolved" : "open"}`} onClick={() => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (target.resolvedAt) delete target.resolvedAt; else target.resolvedAt = new Date().toISOString(); })}>{entry.resolvedAt ? "Resolved" : "Open"}</button></td>
      <td><select value={entry.category} onChange={event => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) target.category = event.target.value as ActionLogCategory; })}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></td>
      <td><textarea value={entry.note} onChange={event => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) target.note = event.target.value; })} /></td>
      <td><input value={entry.owner ?? ""} onChange={event => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (event.target.value.trim()) target.owner = event.target.value; else delete target.owner; })} /></td>
      <td><input type="date" value={entry.dueDate ?? ""} onChange={event => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (event.target.value) target.dueDate = event.target.value; else delete target.dueDate; })} /></td>
      <td><div className="related-fields"><input placeholder="Type" value={entry.relatedEntityType ?? ""} onChange={event => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (event.target.value.trim()) target.relatedEntityType = event.target.value; else delete target.relatedEntityType; })} /><input placeholder="ID" value={entry.relatedEntityId ?? ""} onChange={event => change(next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (event.target.value.trim()) target.relatedEntityId = event.target.value; else delete target.relatedEntityId; })} /></div></td>
      <td><time>{entry.createdAt.slice(0, 10)}</time></td>
      <td><button className="text-danger" type="button" onClick={() => change(next => { next.actionLog = next.actionLog?.filter(item => item.id !== entry.id); })}>Remove</button></td>
    </tr>)}</tbody></table></div>{entries.length === 0 ? <div className="empty-state compact"><h3>No matching log entries</h3><p>Add a data gap, assumption, risk, decision, or follow-up note.</p></div> : null}</div>
    <div className="panel-actions split"><button className="secondary" type="button" onClick={onBack}>Back to recovery</button><button className="primary" type="button" onClick={onContinue}>Continue to decision</button></div>
  </section>;
}
