import type { CapacityModel } from "@capacity/domain";
import type { WorkbenchEntity } from "./entityDefinitions.js";

export type ModelMutation = (entity: WorkbenchEntity, change: (next: CapacityModel) => void) => void;

export interface WorkbenchEditorProps {
  draft: CapacityModel;
  mutate: ModelMutation;
  targetRecordId?: string;
  parentRecordId?: string;
  onSelectRecord?: (recordId: string, parentRecordId?: string) => void;
}

export function createWorkbenchId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export function optionalText(target: Record<string, unknown>, key: string, value: string): void {
  if (value.trim()) target[key] = value.trim();
  else delete target[key];
}
