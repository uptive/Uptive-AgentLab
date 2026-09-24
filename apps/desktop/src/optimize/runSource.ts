import type { AgentDefinition, FlowDefinition, TraceEvent } from "@agentlab/contracts";
import type { TelemetryStore } from "@agentlab/observability";
import { codeReviewFixture, type EvaluationInput } from "@agentlab/optimization";

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

const fixtureRunSource: RunSource = {
  async listRuns() {
    const { run, flow } = codeReviewFixture;
    return [{ runId: run.id, label: `${flow.name} · ${run.id} (fixture)`, completedAt: run.completedAt }];
  },
  async loadRun(runId) {
    return runId === codeReviewFixture.run.id ? codeReviewFixture : undefined;
  },
};

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

// Swap point: once Group 3's store has real runs, replace with
//   createTelemetryRunSource({ store, getFlow, getAgents, getEvents })
export const runSource: RunSource = fixtureRunSource;
