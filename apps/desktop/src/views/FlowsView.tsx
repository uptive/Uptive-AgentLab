import type { FlowDefinition } from "@agentlab/contracts";

const demoFlows: FlowDefinition[] = [];

export function FlowsView() {
  return (
    <div>
      <h1>Flows</h1>
      <p>Build and configure agent flows.</p>
      {demoFlows.length === 0 ? <p>No flows yet.</p> : null}
    </div>
  );
}
