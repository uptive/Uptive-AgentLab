import { useState } from "react";
import type { FlowDefinition, FlowRecord } from "@agentlab/contracts";
import { parseFlow } from "@agentlab/flow-engine";
import type { ProjectEntry } from "../../electron/api.js";
import { FlowEditor, type FlowSource } from "../flow-editor/FlowEditor.js";
import { ProjectsView } from "../flow-editor/ProjectsView.js";
import { errorMessage } from "../flow-editor/bridge.js";
import { DANGER } from "../flow-editor/EditorContext.js";
import { alpha } from "../theme.js";

type Open = { source: FlowSource; flow: FlowDefinition };

/** Project view (list of saved flows, local and cloud) <-> flow editor for one flow. */
export function FlowsView() {
  const [open, setOpen] = useState<Open>();
  const [error, setError] = useState<string>();

  if (open) {
    const key = open.source.kind === "local" ? `local:${open.source.filePath}` : `cloud:${open.source.id}`;
    return <FlowEditor key={key} source={open.source} initialFlow={open.flow} onClose={() => setOpen(undefined)} />;
  }

  const onOpenLocal = (entry: ProjectEntry, content: string) => {
    try {
      setOpen({ source: { kind: "local", filePath: entry.filePath }, flow: parseFlow(content) });
      setError(undefined);
    } catch (err) {
      setError(`Could not open ${entry.filePath}: ${errorMessage(err)}`);
    }
  };

  const onOpenCloud = (record: FlowRecord) => {
    setOpen({ source: { kind: "cloud", id: record.id }, flow: record });
    setError(undefined);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {error ? <div style={{ padding: "8px 24px", color: DANGER, background: alpha(DANGER, 13), fontSize: 13 }}>{error}</div> : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ProjectsView onOpenLocal={onOpenLocal} onOpenCloud={onOpenCloud} />
      </div>
    </div>
  );
}
