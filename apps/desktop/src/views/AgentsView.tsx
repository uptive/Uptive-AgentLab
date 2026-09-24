import type { AgentDefinition } from "@agentlab/contracts";

const demoAgents: AgentDefinition[] = [];

export function AgentsView() {
  return (
    <div>
      <h1>Agents</h1>
      <p>Create, configure and test reusable agents.</p>
      {demoAgents.length === 0 ? <p>No agents yet.</p> : null}
    </div>
  );
}
