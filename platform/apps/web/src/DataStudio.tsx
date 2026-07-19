import { useState } from "react";
import type { CapacityModel } from "@capacity/domain";
import DataWorkspace from "./DataWorkspace.js";
import MasterDataEditor from "./MasterDataEditor.js";

interface DataStudioProps {
  model: CapacityModel;
  baselineScenarioId: string;
  onModelChange: (model: CapacityModel) => Promise<void> | void;
  onBack: () => void;
  onContinue: () => void;
}

export default function DataStudio(props: DataStudioProps) {
  const [mode, setMode] = useState<"import" | "edit">("import");
  return <div className="data-studio">
    <div className="module-mode-tabs" role="tablist" aria-label="Data workspace mode">
      <button type="button" className={mode === "import" ? "active" : ""} onClick={() => setMode("import")}>Import & reconcile</button>
      <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>Edit model</button>
    </div>
    {mode === "import" ? <DataWorkspace {...props} /> : <MasterDataEditor model={props.model} onSave={props.onModelChange} onBack={props.onBack} onContinue={props.onContinue} />}
  </div>;
}
