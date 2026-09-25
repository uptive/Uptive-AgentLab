import type { AgentDefinition, AgentInput, FlowDefinition, Run } from "@agentlab/contracts";
import { parseFlow, serializeFlow } from "@agentlab/flow-engine";
import type { ChangePlan, PlannedEdit } from "@agentlab/optimization";

// Stage 1 runs a flow on edited copies (nothing saved); stage 2 writes the same edits to where the
// agents and flow are saved.

/**
 * Starts a real run of the plan's flow, agents and input, marked as a test of `recommendationIds`.
 * `onUpdate` gets every snapshot of the run; resolves with the finished run.
 */
export async function runTrial(
  plan: ChangePlan,
  baseRunId: string,
  recommendationIds: string[],
  onUpdate: (run: Run) => void,
): Promise<{ runId: string; done: Promise<Run> }> {
  const api = window.agentlab.runs;
  // Updates can arrive before start() resolves with the id, so keep them until it's known.
  const early = new Map<string, Run>();
  let runId: string | undefined;
  let finish!: (run: Run) => void;
  const done = new Promise<Run>((resolve) => (finish = resolve));
  const unsubscribe = api.onUpdate((run) => {
    if (!runId) {
      if (run.trial?.baseRunId === baseRunId) early.set(run.id, run);
      return;
    }
    if (run.id !== runId) return;
    onUpdate(run);
    if (run.status === "completed" || run.status === "failed") {
      unsubscribe();
      finish(run);
    }
  });
  try {
    ({ runId } = await api.start({
      flow: plan.flow,
      input: plan.runInput,
      agents: plan.agents,
      trial: { baseRunId, recommendationIds },
    }));
  } catch (error) {
    unsubscribe();
    throw error;
  }
  const latest = early.get(runId);
  if (latest) {
    onUpdate(latest);
    if (latest.status === "completed" || latest.status === "failed") {
      unsubscribe();
      finish(latest);
    }
  }
  return { runId, done };
}

/** Where an edit gets saved, and the value there now (which may differ from the analyzed run). */
export interface Destination {
  edit: PlannedEdit;
  /** e.g. "Local agent file", "MongoDB agent", "Flow file ~/Documents/…/Release notes.json". */
  where?: string;
  /** Current saved value; compared with `edit.before` to spot edits made since the run. */
  current?: unknown;
  /** Why this edit can't be saved. */
  unavailable?: string;
}

export interface FlowLocation {
  kind: "file" | "database";
  filePath?: string;
  flow: FlowDefinition;
}

async function findFlow(flowId: string): Promise<FlowLocation | undefined> {
  const { flows } = await window.agentlab.projects.list();
  const entry = flows.find((f) => f.id === flowId && f.status === "ok");
  if (entry) return { kind: "file", filePath: entry.filePath, flow: parseFlow(await window.agentlab.flows.read(entry.filePath)) };
  const cloud = await window.agentlab.cloudFlows.get(flowId).catch(() => undefined);
  return cloud ? { kind: "database", flow: cloud } : undefined;
}

const shortPath = (filePath: string) => filePath.replace(/^\/Users\/[^/]+/, "~");

/** Looks up where each edit would be saved and what's there now. Reads only. */
export async function resolveDestinations(plan: ChangePlan): Promise<{ destinations: Destination[]; flow?: FlowLocation }> {
  const needsFlow = plan.edits.some((e) => e.target.kind === "node");
  const flow = needsFlow ? await findFlow(plan.flow.id) : undefined;
  const destinations = await Promise.all(
    plan.edits.map(async (edit): Promise<Destination> => {
      switch (edit.target.kind) {
        case "agent": {
          const saved = await window.agentlab.agents.get(edit.target.agentId).catch(() => undefined);
          if (!saved) return { edit, unavailable: "This is a built-in agent, not a saved one. Save it as your own agent first." };
          return {
            edit,
            where: saved.source === "local" ? "Local agent file" : "Agent in MongoDB",
            current: (saved as unknown as Record<string, unknown>)[edit.field] ?? null,
          };
        }
        case "node": {
          if (!flow) return { edit, unavailable: `Flow "${plan.flow.name}" isn't in your flows list or in MongoDB.` };
          const node = flow.flow.nodes.find((n) => n.id === (edit.target as { nodeId: string }).nodeId);
          if (!node) return { edit, unavailable: "The saved flow no longer has this step." };
          return {
            edit,
            where: flow.kind === "file" ? `Flow file ${shortPath(flow.filePath!)}` : "Flow in MongoDB",
            current: edit.field === "dependsOn" ? node.dependsOn : (node.inputMapping ?? null),
          };
        }
        case "run-input":
          return { edit, unavailable: "Run input isn't saved with the flow. Add these fields when you start the next run." };
      }
    }),
  );
  return { destinations, flow };
}

export interface ApplyResult {
  edit: PlannedEdit;
  ok: boolean;
  error?: string;
}

/** Writes the edits that have a destination: agent fields through the agent store, step changes into the saved flow. */
export async function applyPlan(plan: ChangePlan, destinations: Destination[], flow?: FlowLocation): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  const saveable = destinations.filter((d) => !d.unavailable);

  // One update per agent, with every edited field.
  const byAgent = new Map<string, Destination[]>();
  for (const d of saveable.filter((d) => d.edit.target.kind === "agent")) {
    const id = (d.edit.target as { agentId: string }).agentId;
    byAgent.set(id, [...(byAgent.get(id) ?? []), d]);
  }
  for (const [agentId, items] of byAgent) {
    const edited = plan.agents.find((a) => a.id === agentId) as AgentDefinition;
    const patch = Object.fromEntries(items.map((d) => [d.edit.field, (edited as unknown as Record<string, unknown>)[d.edit.field]])) as Partial<AgentInput>;
    try {
      await window.agentlab.agents.update(agentId, patch);
      results.push(...items.map((d) => ({ edit: d.edit, ok: true })));
    } catch (error) {
      results.push(...items.map((d) => ({ edit: d.edit, ok: false, error: (error as Error).message })));
    }
  }

  // Step changes go into the saved flow as it is now, so other edits to it are kept.
  const nodeEdits = saveable.filter((d) => d.edit.target.kind === "node");
  if (nodeEdits.length && flow) {
    const updated: FlowDefinition = structuredClone(flow.flow);
    for (const d of nodeEdits) {
      const nodeId = (d.edit.target as { nodeId: string }).nodeId;
      const target = updated.nodes.find((n) => n.id === nodeId)!;
      const edited = plan.flow.nodes.find((n) => n.id === nodeId)!;
      target.dependsOn = [...edited.dependsOn];
      if (edited.inputMapping) target.inputMapping = { ...edited.inputMapping };
    }
    try {
      if (flow.kind === "file") await window.agentlab.flows.write(flow.filePath!, serializeFlow(updated));
      else await window.agentlab.cloudFlows.save(updated);
      results.push(...nodeEdits.map((d) => ({ edit: d.edit, ok: true })));
    } catch (error) {
      results.push(...nodeEdits.map((d) => ({ edit: d.edit, ok: false, error: (error as Error).message })));
    }
  }
  return results;
}
