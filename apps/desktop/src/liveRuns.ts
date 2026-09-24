import type { AgentDefinition, FlowDefinition, Run } from "@agentlab/contracts";
import { demoAgents, findAgent } from "@agentlab/agent-runtime";
import { demoFlow, dummyAgents, findFlow } from "@agentlab/flow-engine";
import { getTelemetryStore } from "@agentlab/observability";

// Real runs execute in the Electron main process; their snapshots and trace events are pushed here
// and written into the shared telemetry store, which persists them and drives the Runs view.

let connected = false;

/** Subscribes the telemetry store to live runs once. No-op outside the desktop app. */
export function connectLiveRuns(): void {
  if (connected || !window.agentlab?.runs) return;
  connected = true;
  const store = getTelemetryStore();
  window.agentlab.runs.onEvent((event) => store.recordEvent(event));
  window.agentlab.runs.onUpdate((run) => store.saveRun(run));
}

export function canRunForReal(): boolean {
  return Boolean(window.agentlab?.runs);
}

export async function startRun(flow: FlowDefinition, input: unknown, folder?: string): Promise<string> {
  connectLiveRuns();
  const { runId } = await window.agentlab.runs.start({ flow, input, folder });
  return runId;
}

export function cancelRun(runId: string): Promise<void> {
  return window.agentlab.runs.cancel(runId);
}

/** The flow as it executed (snapshot), falling back to the demo registry for older runs. */
export function flowOf(run: Run): FlowDefinition {
  return run.flow ?? findFlow(run.flowId) ?? demoFlow;
}

const builtinAgents = [...demoAgents, ...dummyAgents.filter((a) => !demoAgents.some((d) => d.id === a.id))];

/** The agent as it executed (snapshot), falling back to the built-in agents. */
export function agentOf(run: Run, agentId: string): AgentDefinition | undefined {
  return run.agents?.find((a) => a.id === agentId) ?? findAgent(agentId, builtinAgents);
}
