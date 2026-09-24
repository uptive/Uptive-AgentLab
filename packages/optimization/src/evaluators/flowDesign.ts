import type { Recommendation, RecommendationChange, RecommendationSeverity, RecommendationTarget } from "@agentlab/contracts";
import { agentName, consumedNodeOutputs, criticalPathMs, formatSeconds, stepForNode, stepLatencyMs } from "../helpers.js";
import type { EvaluationInput, Evaluator, ModelClient } from "../types.js";

const EVALUATOR_ID = "flow-design";

type FlowCheck = "parallelization" | "duplicated-work" | "missing-validation" | "unclear-responsibilities";
type FlowChangeType = "set-dependencies" | "add-node" | "merge-nodes" | "edit-role";

/** One finding as returned by the model (shape enforced by FINDINGS_SCHEMA). */
export interface FlowFinding {
  check: FlowCheck;
  nodeIds: string[];
  title: string;
  problem: string;
  suggestion: string;
  severity: RecommendationSeverity;
  evidence: string[];
  change: { type: FlowChangeType; nodeId: string; dependsOn: string[]; text: string };
}

const CHANGES_FOR_CHECK: Record<FlowCheck, FlowChangeType[]> = {
  parallelization: ["set-dependencies"],
  "missing-validation": ["add-node"],
  "duplicated-work": ["merge-nodes", "edit-role"],
  "unclear-responsibilities": ["edit-role", "merge-nodes"],
};

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["check", "nodeIds", "title", "problem", "suggestion", "severity", "evidence", "change"],
        properties: {
          check: { type: "string", enum: ["parallelization", "duplicated-work", "missing-validation", "unclear-responsibilities"] },
          nodeIds: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          problem: { type: "string" },
          suggestion: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: "array", items: { type: "string" } },
          change: {
            type: "object",
            additionalProperties: false,
            required: ["type", "nodeId", "dependsOn", "text"],
            properties: {
              type: { type: "string", enum: ["set-dependencies", "add-node", "merge-nodes", "edit-role"] },
              nodeId: { type: "string" },
              dependsOn: { type: "array", items: { type: "string" } },
              text: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export const FLOW_DESIGN_SYSTEM_PROMPT = `You review the design of multi-agent flows. You are given one flow (a graph of nodes, each run by an agent, connected by dependencies) together with measured data from one completed run. You critique the shape of the flow, not the task it performed and not the wording of individual prompts or model choices; other reviewers cover those.

Check for exactly these four kinds of problems:

1. parallelization: a node waits for another node (dependsOn) whose output it never reads, so the two run back to back when they could run at the same time. Use readsOutputOf and unusedDependencies, plus the measured start times and durations, to judge whether dropping the dependency would shorten the run. Do not suggest removing a dependency whose output the node reads.
2. duplicated-work: two or more nodes do the same or largely overlapping work (same inputs, same kind of analysis, overlapping outputs).
3. missing-validation: the flow ends without any node that checks or validates the final output before it is considered done. Only report this if no terminal node validates.
4. unclear-responsibilities: nodes whose roles overlap, or where it is ambiguous which node owns which part of the task.

Only report problems that the provided data supports, and cite the concrete numbers or fields in evidence. Returning no findings is fine. Report each problem once.

For each finding, describe one concrete change:
- set-dependencies: nodeId is the node to re-wire; dependsOn is its complete new dependency list; text is "".
- add-node: nodeId is the id of the new node; dependsOn is what it runs after; text is its responsibility.
- merge-nodes: nodeId is the node to keep; nodeIds lists every node being merged; dependsOn is []; text is the combined responsibility.
- edit-role: nodeId is the node whose role changes; dependsOn is []; text is the new one-sentence role.

Titles are short imperative headlines (at most 8 words). Problems and suggestions are one or two sentences each.`;

/** Deterministic facts about the flow graph and run timings that the model reasons over. */
export function buildFlowFacts(input: EvaluationInput) {
  const runStart = Date.parse(input.run.startedAt);
  const dependents = (nodeId: string) => input.flow.nodes.filter((n) => n.dependsOn.includes(nodeId)).map((n) => n.id);
  return {
    flow: { id: input.flow.id, name: input.flow.name, description: input.flow.description },
    run: { id: input.run.id, status: input.run.status, latencyMs: input.run.totalUsage?.latencyMs ?? criticalPathMs(input) },
    terminalNodeIds: input.flow.nodes.filter((n) => dependents(n.id).length === 0).map((n) => n.id),
    nodes: input.flow.nodes.map((node) => {
      const agent = input.agents.find((a) => a.id === node.agentId);
      const step = stepForNode(input, node.id);
      const readsOutputOf = consumedNodeOutputs(node);
      return {
        nodeId: node.id,
        agent: agent
          ? { id: agent.id, name: agent.name, role: agent.role, systemInstructions: agent.systemInstructions, model: agent.model }
          : { id: node.agentId },
        dependsOn: node.dependsOn,
        readsOutputOf,
        unusedDependencies: node.dependsOn.filter((dep) => !readsOutputOf.includes(dep)),
        dependents: dependents(node.id),
        inputMapping: node.inputMapping ?? {},
        outputFields:
          step?.output && typeof step.output === "object" ? Object.keys(step.output as object) : step?.output === undefined ? [] : ["(free text)"],
        status: step?.status ?? "not run",
        startOffsetMs: step?.startedAt ? Date.parse(step.startedAt) - runStart : null,
        durationMs: step ? stepLatencyMs(step) : null,
      };
    }),
  };
}

function hasCycle(nodeIds: string[], depsOf: (id: string) => string[]): boolean {
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): boolean => {
    if (state.get(id) === "visiting") return true;
    if (state.get(id) === "done") return false;
    state.set(id, "visiting");
    const cyclic = depsOf(id).some(visit);
    state.set(id, "done");
    return cyclic;
  };
  return nodeIds.some(visit);
}

const VALIDATION_PATTERN = /\b(validat\w*|verif\w*|gate|check\w*)\b/i;

/**
 * Checks a model finding against the actual graph and turns it into a Recommendation, computing
 * impact numbers in code. Returns a reason string when the finding is rejected.
 */
export function toRecommendation(input: EvaluationInput, finding: FlowFinding): Recommendation | string {
  const nodeIds = new Set(input.flow.nodes.map((n) => n.id));
  const { change } = finding;
  if (!CHANGES_FOR_CHECK[finding.check]?.includes(change.type)) return `change ${change.type} does not fit check ${finding.check}`;
  const unknown = [...finding.nodeIds, ...(change.type === "add-node" ? [] : [change.nodeId])].filter((id) => !nodeIds.has(id));
  if (unknown.length) return `unknown node ids: ${unknown.join(", ")}`;

  const node = input.flow.nodes.find((n) => n.id === change.nodeId);
  const target: RecommendationTarget = node
    ? { kind: "node", nodeId: node.id, agentId: node.agentId }
    : { kind: "flow", flowId: input.flow.id };
  const base = {
    id: `${EVALUATOR_ID}:${finding.check}:${change.nodeId}`,
    evaluatorId: EVALUATOR_ID,
    category: "flow-design" as const,
    title: finding.title,
    severity: finding.severity,
    target,
    problem: finding.problem,
    suggestion: finding.suggestion,
  };

  switch (change.type) {
    case "set-dependencies": {
      const newDeps = [...new Set(change.dependsOn)];
      if (newDeps.some((d) => !nodeIds.has(d) || d === node!.id)) return "invalid dependency list";
      const stillRead = consumedNodeOutputs(node!).filter((id) => !newDeps.includes(id));
      if (stillRead.length) return `${node!.id} reads the output of ${stillRead.join(", ")}, so that dependency must stay`;
      const overrides = new Map([[node!.id, newDeps]]);
      if (hasCycle([...nodeIds], (id) => overrides.get(id) ?? input.flow.nodes.find((n) => n.id === id)!.dependsOn)) return "creates a cycle";

      const before = criticalPathMs(input);
      const after = criticalPathMs(input, new Map(), overrides);
      const latencyMs = Math.round(after - before);
      if (latencyMs >= 0) return "does not shorten the run";
      const removed = node!.dependsOn.filter((d) => !newDeps.includes(d));
      return {
        ...base,
        change: { type: "set-dependencies", path: `nodes.${node!.id}.dependsOn`, before: node!.dependsOn, after: newDeps },
        estimatedImpact: {
          speed: { latencyMs, stepLatencyMs: 0 },
          summary: `Run ~${formatSeconds(-latencyMs)} faster (${formatSeconds(before)} → ${formatSeconds(after)} critical path)`,
        },
        evidence: [
          ...finding.evidence,
          `${agentName(input, node!.agentId)} waits for ${removed.map((d) => agentName(input, input.flow.nodes.find((n) => n.id === d)!.agentId)).join(", ")} but reads only: ${
            Object.values(node!.inputMapping ?? {}).join(", ") || "nothing"
          }.`,
        ],
      };
    }
    case "add-node": {
      if (nodeIds.has(change.nodeId)) return `node id ${change.nodeId} already exists`;
      if (change.dependsOn.some((d) => !nodeIds.has(d))) return "invalid dependency list";
      const terminals = input.flow.nodes.filter((n) => !input.flow.nodes.some((m) => m.dependsOn.includes(n.id)));
      const validators = terminals.filter((n) => {
        const agent = input.agents.find((a) => a.id === n.agentId);
        return VALIDATION_PATTERN.test(`${agent?.name ?? ""} ${agent?.role ?? ""}`);
      });
      if (validators.length) return `flow already ends in a validating node: ${validators.map((n) => n.id).join(", ")}`;
      return withQualityImpact(base, finding, {
        type: "add-node",
        path: "nodes",
        before: null,
        after: { id: change.nodeId, dependsOn: change.dependsOn, responsibility: change.text },
      });
    }
    case "merge-nodes":
      if (finding.nodeIds.length < 2) return "merge needs at least two nodes";
      return withQualityImpact(base, finding, {
        type: "merge-nodes",
        path: "nodes",
        before: finding.nodeIds,
        after: { keep: change.nodeId, responsibility: change.text },
      });
    case "edit-role": {
      const agent = input.agents.find((a) => a.id === node!.agentId);
      return withQualityImpact(base, finding, {
        type: "edit-role",
        path: `agents.${node!.agentId}.role`,
        before: agent?.role ?? null,
        after: change.text,
      });
    }
  }
}

function withQualityImpact(
  base: Omit<Recommendation, "change" | "estimatedImpact" | "evidence">,
  finding: FlowFinding,
  change: RecommendationChange,
): Recommendation {
  const summaries: Record<FlowCheck, string> = {
    parallelization: "",
    "duplicated-work": "Removes repeated work and conflicting outputs between steps.",
    "missing-validation": "The final output is checked before the run counts as done.",
    "unclear-responsibilities": "Each step owns a clear part of the task, so handoffs stop overlapping.",
  };
  return { ...base, change, estimatedImpact: { quality: { risk: finding.severity }, summary: summaries[finding.check] }, evidence: finding.evidence };
}

/**
 * Flow Design evaluator: sends the whole flow graph plus run timings to a model in one call and
 * turns its findings into recommendations. Findings that don't hold up against the graph are dropped.
 */
export function createFlowDesignEvaluator(client: ModelClient): Evaluator {
  return {
    id: EVALUATOR_ID,
    name: "Flow Design",
    category: "flow-design",
    async evaluate(input) {
      const response = (await client.generateJson({
        system: FLOW_DESIGN_SYSTEM_PROMPT,
        prompt: `Review this flow and run.\n\n${JSON.stringify(buildFlowFacts(input), null, 2)}`,
        schema: FINDINGS_SCHEMA as unknown as Record<string, unknown>,
      })) as { findings?: FlowFinding[] };

      const recommendations = new Map<string, Recommendation>();
      for (const finding of response.findings ?? []) {
        const result = toRecommendation(input, finding);
        if (typeof result === "string") {
          console.warn(`[flow-design] dropped "${finding.title}": ${result}`);
        } else if (!recommendations.has(result.id)) {
          recommendations.set(result.id, result);
        }
      }
      return [...recommendations.values()];
    },
  };
}
