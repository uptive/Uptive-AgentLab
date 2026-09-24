import type { AgentDefinition, FlowDefinition, TraceEvent } from "@agentlab/contracts";
import { demoAgents } from "@agentlab/agent-runtime";
import { dummyAgents, findFlow } from "@agentlab/flow-engine";
import { getTelemetryStore, type TelemetryStore } from "@agentlab/observability";
import type { EvaluationInput } from "@agentlab/optimization";

export interface RunSummary {
  runId: string;
  label: string;
  completedAt?: string;
}

/** Where the Optimize view gets analyzable runs from. The view only talks to this interface. */
export interface RunSource {
  listRuns(): Promise<RunSummary[]>;
  loadRun(runId: string): Promise<EvaluationInput | undefined>;
}

/**
 * Adapter for real runs from Group 3's telemetry store. Runs only reference flows/agents by id,
 * so the caller supplies lookups (from Group 1/2's registries) until those live somewhere shared.
 */
export function createTelemetryRunSource(deps: {
  store: TelemetryStore;
  getFlow: (flowId: string) => FlowDefinition | undefined;
  getAgents: (agentIds: string[]) => AgentDefinition[];
  getEvents?: (runId: string) => TraceEvent[];
}): RunSource {
  return {
    async listRuns() {
      return deps.store
        .listRuns()
        .filter((run) => run.status === "completed")
        .map((run) => ({ runId: run.id, label: `${deps.getFlow(run.flowId)?.name ?? run.flowId} · ${run.id}`, completedAt: run.completedAt }));
    },
    async loadRun(runId) {
      const run = deps.store.getRun(runId);
      const flow = run && deps.getFlow(run.flowId);
      if (!run || !flow) return undefined;
      const agents = deps.getAgents([...new Set(flow.nodes.map((n) => n.agentId))]);
      return { run, flow, agents, events: deps.getEvents?.(runId) };
    },
  };
}

const builtinAgents = [...demoAgents, ...dummyAgents.filter((a) => !demoAgents.some((d) => d.id === a.id))];

/**
 * Real runs from this computer's telemetry. Runs carry snapshots of the flow and agents they
 * executed, so the analysis sees exactly what ran even if the flow was edited since.
 */
function createLocalRunSource(): RunSource {
  const store = getTelemetryStore();
  const flowOf = (runId: string) => {
    const run = store.getRun(runId);
    return run?.flow ?? (run ? findFlow(run.flowId) : undefined);
  };
  const source = createTelemetryRunSource({
    store,
    getFlow: (flowId) => store.listRuns().find((r) => r.flowId === flowId && r.flow)?.flow ?? findFlow(flowId),
    getAgents: (ids) => ids.flatMap((id) => builtinAgents.filter((a) => a.id === id)),
    getEvents: (runId) => store.listEvents(runId),
  });
  return {
    async listRuns() {
      await store.hydrate();
      return (await source.listRuns()).map((summary) => ({ ...summary, label: `${flowOf(summary.runId)?.name ?? summary.label} · ${summary.runId.slice(0, 8)}` }));
    },
    async loadRun(runId) {
      await store.hydrate();
      const run = store.getRun(runId);
      const flow = flowOf(runId);
      if (!run || !flow) return undefined;
      const snapshot = new Map((run.agents ?? []).map((a) => [a.id, a]));
      const agents = [...new Set(flow.nodes.map((n) => n.agentId))].flatMap((id) => {
        const agent = snapshot.get(id) ?? builtinAgents.find((a) => a.id === id);
        return agent ? [agent] : [];
      });
      return { run, flow, agents, events: store.listEvents(runId) };
    },
  };
}

export const runSource: RunSource = createLocalRunSource();
