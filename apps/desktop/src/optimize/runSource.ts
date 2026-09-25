import type { Run, TraceEvent } from "@agentlab/contracts";
import { demoAgents } from "@agentlab/agent-runtime";
import { dummyAgents } from "@agentlab/flow-engine";
import { getTelemetryStore } from "@agentlab/observability";
import { toEvaluationInput, type EvaluationInput } from "@agentlab/optimization";

export interface RunSummary {
  runId: string;
  label: string;
  completedAt?: string;
  /** This computer's runs, or runs saved to the shared database before runs moved to local files. */
  source: "local" | "shared";
}

/** Where the Optimize view gets analyzable runs from. The view only talks to this interface. */
export interface RunSource {
  listRuns(): Promise<RunSummary[]>;
  /** Throws with the reason when the run can't be analyzed. */
  loadRun(runId: string): Promise<EvaluationInput>;
}

const builtinAgents = [...demoAgents, ...dummyAgents.filter((a) => !demoAgents.some((d) => d.id === a.id))];

// Some older runs saved their flow but not their agents; look those up among the built-in agents.
const lookups = { findAgent: (id: string) => builtinAgents.find((a) => a.id === id) };

// Absent in a plain browser preview (no Electron preload): then there are only local runs.
const sharedRuns = (window as { agentlab?: Window["agentlab"] }).agentlab?.sharedRuns;

function label(flowName: string, runId: string, completedAt: string | undefined, source: RunSummary["source"]): string {
  const when = completedAt ? new Date(completedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
  return [flowName, when, runId.slice(0, 8), source === "shared" ? "shared" : undefined].filter(Boolean).join(" · ");
}

/**
 * Completed runs from this computer's telemetry and from the shared database, newest first. A run
 * in both is taken from this computer.
 */
function createRunSource(): RunSource {
  // Looked up on every call, not once: this module loads (through App) before main.tsx replaces
  // the in-memory default with the store that reads this computer's run files.
  const telemetry = () => getTelemetryStore();

  async function load(runId: string): Promise<{ run: Run; events: TraceEvent[] } | undefined> {
    const store = telemetry();
    await store.hydrate();
    const local = store.getRun(runId);
    if (local) return { run: local, events: [...store.listEvents(runId)] };
    return sharedRuns?.get(runId);
  }

  return {
    async listRuns() {
      const store = telemetry();
      await store.hydrate();
      const local = store
        .listRuns()
        // Only runs that saved a copy of their flow can be analyzed (see toEvaluationInput).
        .filter((run) => run.status === "completed" && run.flow)
        .map<RunSummary>((run) => ({
          runId: run.id,
          label: label(`${run.trial ? "Test · " : ""}${run.flow!.name}`, run.id, run.completedAt, "local"),
          completedAt: run.completedAt,
          source: "local",
        }));
      const localIds = new Set(local.map((r) => r.runId));
      const shared = (await sharedRuns?.list().catch(() => []))
        // flowName is only there when the run saved a copy of its flow.
        ?.filter((run) => run.status === "completed" && run.flowName && !localIds.has(run.id))
        .map<RunSummary>((run) => ({
          runId: run.id,
          label: label(run.flowName!, run.id, run.completedAt, "shared"),
          completedAt: run.completedAt,
          source: "shared",
        }));
      return [...local, ...(shared ?? [])].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    },
    async loadRun(runId) {
      const loaded = await load(runId);
      if (!loaded) throw new Error(`Run ${runId} was not found. Pick another run.`);
      const result = toEvaluationInput(loaded.run, loaded.events, lookups);
      if ("reason" in result) throw new Error(`This run can't be analyzed: ${result.reason}.`);
      return result.input;
    },
  };
}

export const runSource: RunSource = createRunSource();
