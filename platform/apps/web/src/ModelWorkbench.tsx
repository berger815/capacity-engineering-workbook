import { useEffect, useState, type ComponentProps } from "react";
import { validateModel } from "./api.js";
import ModelWorkbenchCore from "./ModelWorkbenchCore.js";

class WorkbenchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchValidationError";
  }
}

function validationMessage(issues: Array<{ path?: string; message: string }>): string {
  const issue = issues[0];
  if (!issue) return "The edited model failed validation.";
  return `${issue.path ? `${issue.path}: ` : ""}${issue.message}`;
}

type ModelWorkbenchProps = ComponentProps<typeof ModelWorkbenchCore>;

export default function ModelWorkbench(props: ModelWorkbenchProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const guardNavigation = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const leavingControl = element?.closest(".step-button, .topbar-actions .secondary.light");
      const unsaved = document.querySelector(".model-workbench .unsaved-banner");
      if (!leavingControl || !unsaved) return;
      if (!window.confirm("Discard unsaved Workbench changes?")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", guardNavigation, true);
    return () => document.removeEventListener("click", guardNavigation, true);
  }, []);

  useEffect(() => {
    const suppressExpectedRejection = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof WorkbenchValidationError) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", suppressExpectedRejection);
    return () => window.removeEventListener("unhandledrejection", suppressExpectedRejection);
  }, []);

  async function applyValidatedModel(next: Parameters<ModelWorkbenchProps["onModelChange"]>[0]): Promise<void> {
    const result = await validateModel(next);
    if (!result.valid) {
      const message = validationMessage(result.issues);
      setValidationError(message);
      throw new WorkbenchValidationError(message);
    }
    setValidationError(null);
    await props.onModelChange(next);
  }

  return <>
    {validationError ? <div className="error-panel"><strong>Model changes were not applied</strong><span>{validationError}</span></div> : null}
    <ModelWorkbenchCore {...props} onModelChange={applyValidatedModel} />
  </>;
}
