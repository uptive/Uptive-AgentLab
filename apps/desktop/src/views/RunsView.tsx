import type { Run } from "@agentlab/contracts";

const demoRuns: Run[] = [];

export function RunsView() {
  return (
    <div>
      <h1>Runs</h1>
      <p>History and inspection of flow executions.</p>
      {demoRuns.length === 0 ? <p>No runs yet.</p> : null}
    </div>
  );
}
