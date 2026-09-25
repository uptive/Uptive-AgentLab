import type { AgentDefinition, Run, StepRun, TraceEvent } from "@agentlab/contracts";
import type { EvaluationInput } from "./types.js";

/** Where to find an agent that a run doesn't carry a snapshot of. */
export interface RunLookups {
  findAgent?: (agentId: string) => AgentDefinition | undefined;
}

export type RunInputResult = { input: EvaluationInput } | { reason: string };

/**
 * Turns a recorded run (from the local telemetry files or the shared database) into what the
 * evaluators read. Uses the run's own flow and agent snapshots (agents fall back to `lookups`) and
 * fills in step inputs that only the trace recorded. Returns why a run can't be analyzed.
 *
 * The flow must come from the run: a flow looked up by id today may not be what the run executed,
 * and analyzing a run against the wrong flow reports handoffs and inputs that never existed.
 */
export function toEvaluationInput(run: Run, events: TraceEvent[] = [], lookups: RunLookups = {}): RunInputResult {
  if (run.status !== "completed") return { reason: `the run is ${run.status}` };
  const flow = run.flow;
  if (!flow) return { reason: "it was recorded before runs saved a copy of their flow" };

  const snapshot = new Map((run.agents ?? []).map((a) => [a.id, a]));
  const agents = [...new Set(flow.nodes.map((n) => n.agentId))].flatMap((id) => {
    const agent = snapshot.get(id) ?? lookups.findAgent?.(id);
    return agent ? [agent] : [];
  });
  if (agents.length === 0) return { reason: "none of the run's agents are saved with it or were found" };

  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  const steps = run.steps.filter((s) => nodeIds.has(s.nodeId)).map((s) => withRecordedInput(s, events));
  if (!steps.some((s) => s.usage && s.usage.inputTokens + s.usage.outputTokens > 0)) {
    return { reason: "no step recorded token usage" };
  }

  const runEvents = events.filter((e) => e.runId === run.id);
  return { input: { run: { ...run, steps }, flow, agents, events: runEvents.length ? runEvents : undefined } };
}

/** A step's input, taken from its agent_start trace event when the step itself didn't keep it. */
function withRecordedInput(step: StepRun, events: TraceEvent[]): StepRun {
  if (step.input !== undefined) return step;
  const start = events.find((e) => e.type === "agent_start" && e.stepRunId === step.id);
  const input = (start?.data as { input?: unknown } | undefined)?.input;
  return input === undefined ? step : { ...step, input };
}
