import { useState } from "react";
import type { FlowDefinition } from "@agentlab/contracts";
import { parseFlow } from "@agentlab/flow-engine";
import type { ProjectEntry } from "../../electron/api.js";
import { FlowEditor } from "../flow-editor/FlowEditor.js";
import { ProjectsView } from "../flow-editor/ProjectsView.js";
import { errorMessage } from "../flow-editor/bridge.js";
import { DANGER } from "../flow-editor/EditorContext.js";

type Open = { filePath: string; flow: FlowDefinition };

/** Project view (list of saved flows) <-> flow editor for one flow file. */
export function FlowsView() {
  const [open, setOpen] = useState<Open>();
  const [error, setError] = useState<string>();

  if (open) {
    return <FlowEditor key={open.filePath} filePath={open.filePath} initialFlow={open.flow} onClose={() => setOpen(undefined)} />;
  }

  const onOpen = (entry: ProjectEntry, content: string) => {
    try {
      setOpen({ filePath: entry.filePath, flow: parseFlow(content) });
      setError(undefined);
    } catch (err) {
      setError(`Could not open ${entry.filePath}: ${errorMessage(err)}`);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {error ? <div style={{ padding: "8px 24px", color: DANGER, background: `${DANGER}22`, fontSize: 13 }}>{error}</div> : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ProjectsView onOpen={onOpen} />
      </div>
    </div>
  );
}
