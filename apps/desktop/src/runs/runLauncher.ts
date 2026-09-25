import type { AgentDefinition, FlowDefinition, Run } from "@agentlab/contracts";
import { getTelemetryStore, interruptRun } from "@agentlab/observability";
import { createFlowEngine, createMockRuntime } from "@agentlab/flow-engine";
import { canRunForReal, connectLiveRuns } from "../liveRuns.js";

// In the desktop app runs execute for real in the main process (Claude runtime). The mock runtime
// below is the fallback for a plain browser preview.

// Slow enough that you can watch a step go pending -> running -> completed.
const runtime = createMockRuntime({ minLatencyMs: 1500, maxLatencyMs: 4000 });

interface ActiveRun {
  controller: AbortController;
  /** Set once the user stops the run; later engine snapshots are ignored. */
  stopped: boolean;
}

// Module-level so runs keep going when the Runs view unmounts (e.g. switching tabs).
const active = new Map<string, ActiveRun>();

/** Wraps a single agent in a one-node flow so it can go through the same engine and views. */
export function singleAgentFlow(agent: AgentDefinition): FlowDefinition {
  return {
    id: `agent:${agent.id}`,
    name: agent.name,
    description: `Single-agent run of ${agent.name}`,
    nodes: [{ id: agent.id, agentId: agent.id, dependsOn: [] }],
  };
}

/**
 * Starts executing `flow` in the background and resolves with the new run's id. Every
 * state change is saved to the telemetry store, so views just subscribe to it.
 * `folder` is a folder the agents may read (real runs only).
 */
export async function startRun(
  flow: FlowDefinition,
  input: unknown,
  resolveAgent: (agentId: string) => AgentDefinition | undefined,
  folder?: string,
): Promise<string> {
  if (canRunForReal()) {
    connectLiveRuns();
    const { runId } = await window.agentlab.runs.start({ flow, input, folder });
    return runId;
  }
  return startMockRun(flow, input, resolveAgent);
}

function startMockRun(
  flow: FlowDefinition,
  input: unknown,
  resolveAgent: (agentId: string) => AgentDefinition | undefined,
): string {
  const store = getTelemetryStore();
  const controller = new AbortController();
  let entry: ActiveRun | undefined;
  let runId: string | undefined;

  const engine = createFlowEngine({
    runtime,
    resolveAgent,
    onEvent: (event) => store.recordEvent(event),
  });

  const save = (run: Run) => {
    if (entry?.stopped) return;
    store.saveRun({ ...run, flow, input });
  };

  const done = engine.execute(flow, input, {
    signal: controller.signal,
    onRunUpdate: (run) => {
      // The engine publishes the first snapshot synchronously, before execute() yields.
      if (!runId) {
        runId = run.id;
        entry = { controller, stopped: false };
        active.set(runId, entry);
      }
      save(run);
    },
  });

  void done
    .then(save)
    .catch((err) => console.error("Run failed to execute:", err))
    .finally(() => {
      if (runId) active.delete(runId);
    });

  if (!runId) throw new Error("The flow engine did not start the run.");
  return runId;
}

/**
 * Stops a run: no new steps are scheduled and anything still pending or running
 * is marked failed. Also works for runs left "running" by a previous session.
 */
export function stopRun(run: Run): void {
  // Real runs carry agent snapshots. The main process aborts them, or closes them out if they are no
  // longer running there, and publishes the final state.
  if (run.agents && canRunForReal()) {
    void window.agentlab.runs.cancel(run.id);
    if (run.status === "running") return;
  }
  const entry = active.get(run.id);
  if (entry) {
    entry.stopped = true;
    entry.controller.abort();
    active.delete(run.id);
  }
  getTelemetryStore().saveRun(interruptRun(run, "Cancelled by user"));
}
