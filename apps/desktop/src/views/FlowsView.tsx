import { useState } from "react";
import { FlowEditor } from "../flow-editor/FlowEditor.js";
import { FlowsListView } from "./FlowsListView.js";

export function FlowsView() {
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>();

  if (selectedFlowId) {
    return <FlowEditor flowId={selectedFlowId} onBack={() => setSelectedFlowId(undefined)} />;
  }
  return <FlowsListView onOpen={setSelectedFlowId} />;
}
