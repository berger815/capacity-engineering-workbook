import { useMemo, useState } from "react";
import type { ActionLogCategory } from "@capacity/domain";
import type { WorkbenchEditorProps } from "./editorTypes.js";
import { createWorkbenchId as newId, optionalText } from "./editorTypes.js";

const categories: ActionLogCategory[] = ["data", "assumption", "risk", "decision", "followUp", "general"];

export default function ActionLogEditor({ draft, mutate, targetRecordId, onSelectRecord }: WorkbenchEditorProps) {
  const [category, setCategory] = useState<ActionLogCategory | "all">("all");
  const [showResolved, setShowResolved] = useState(true);
  const entries = useMemo(() => [...(draft.actionLog ?? [])]
    .filter(entry => category === "all" || entry.category === category)
    .filter(entry => showResolved || !entry.resolvedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [draft.actionLog, category, showResolved]);

  function addEntry(): void {
    const id = newId("log");
    mutate("actions", next => { next.actionLog ??= []; next.actionLog.unshift({ id, createdAt: new Date().toISOString(), category: "general", note: "New assessment note" }); });
    onSelectRecord?.(id);
  }

  return <div className="workbench-editor">
    <div className="action-log-toolbar"><label>Category<select value={category} onChange={event => setCategory(event.target.value as ActionLogCategory | "all")}><option value="all">All categories</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="checkbox"><input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} /> Show resolved</label><button className="secondary" type="button" onClick={addEntry}>Add log entry</button></div>
    <div className="metric-grid four compact"><div className="metric"><span>Total entries</span><strong>{draft.actionLog?.length ?? 0}</strong></div><div className="metric"><span>Open</span><strong>{draft.actionLog?.filter(entry => !entry.resolvedAt).length ?? 0}</strong></div><div className="metric"><span>Due</span><strong>{draft.actionLog?.filter(entry => !entry.resolvedAt && entry.dueDate && entry.dueDate <= new Date().toISOString().slice(0, 10)).length ?? 0}</strong></div><div className="metric"><span>Decisions</span><strong>{draft.actionLog?.filter(entry => entry.category === "decision").length ?? 0}</strong></div></div>
    <div className="table-card"><div className="table-wrap"><table><thead><tr><th>Status</th><th>Category</th><th>Note</th><th>Owner</th><th>Due</th><th>Related entity</th><th>Created</th><th /></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className={`${entry.resolvedAt ? "resolved-row" : ""} ${targetRecordId === entry.id ? "selected-row" : ""}`} onClick={() => onSelectRecord?.(entry.id)}><td><button type="button" className={`status-toggle ${entry.resolvedAt ? "resolved" : "open"}`} onClick={event => { event.stopPropagation(); mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (!target) return; if (target.resolvedAt) delete target.resolvedAt; else target.resolvedAt = new Date().toISOString(); }); }}>{entry.resolvedAt ? "Resolved" : "Open"}</button></td><td><select value={entry.category} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) target.category = event.target.value as ActionLogCategory; })}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></td><td><textarea value={entry.note} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) target.note = event.target.value; })} /></td><td><input value={entry.owner ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "owner", event.target.value); })} /></td><td><input type="date" value={entry.dueDate ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "dueDate", event.target.value); })} /></td><td><div className="related-fields"><input placeholder="Type" value={entry.relatedEntityType ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "relatedEntityType", event.target.value); })} /><input placeholder="ID" value={entry.relatedEntityId ?? ""} onChange={event => mutate("actions", next => { const target = next.actionLog?.find(item => item.id === entry.id); if (target) optionalText(target as unknown as Record<string, unknown>, "relatedEntityId", event.target.value); })} /></div></td><td><time>{entry.createdAt.slice(0, 10)}</time></td><td><button className="text-danger" type="button" onClick={event => { event.stopPropagation(); mutate("actions", next => { next.actionLog = next.actionLog?.filter(item => item.id !== entry.id); }); }}>Remove</button></td></tr>)}</tbody></table></div>{entries.length === 0 ? <div className="empty-state compact"><h3>No matching log entries</h3><p>Add a data gap, assumption, risk, decision, or follow-up note.</p></div> : null}</div>
  </div>;
}
