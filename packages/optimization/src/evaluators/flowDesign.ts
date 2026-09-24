import type { AgentDefinition, FlowNode, Recommendation } from "@agentlab/contracts";
import { agentName, consumedNodeOutputs, criticalPathMs, formatSeconds, stepForNode, stepLatencyMs } from "../helpers.js";
import type { EvaluationInput, Evaluator } from "../types.js";

const EVALUATOR_ID = "flow-design";
/** Re-wiring that saves less end-to-end time than this isn't worth reporting. */
const MIN_PARALLEL_GAIN_MS = 500;
/** Share of role words two agents must have in common before their responsibilities count as overlapping. */
const ROLE_OVERLAP_THRESHOLD = 0.5;
const VALIDATION_PATTERN = /\b(validat\w*|verif\w*|gate|check\w*)\b/i;
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "it", "its", "is", "this", "that"]);

/** Looks at the shape of the flow (nodes and dependencies) together with run timings. */
export const flowDesignEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Flow Design",
  category: "flow-design",
  async evaluate(input) {
    return [...parallelization(input), ...duplicatedWork(input), ...unclearResponsibilities(input), ...missingValidation(input)];
  },
};

function agentOf(input: EvaluationInput, node: FlowNode): AgentDefinition | undefined {
  return input.agents.find((a) => a.id === node.agentId);
}

function nodeName(input: EvaluationInput, nodeId: string): string {
  const node = input.flow.nodes.find((n) => n.id === nodeId);
  return node ? agentName(input, node.agentId) : nodeId;
}

/** A node waits for upstream nodes whose output it never reads, so steps run back to back for no reason. */
function parallelization(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const baseline = criticalPathMs(input);

  for (const node of input.flow.nodes) {
    const reads = consumedNodeOutputs(node);
    const unused = node.dependsOn.filter((dep) => !reads.includes(dep));
    if (unused.length === 0) continue;

    // Depend on exactly what the node reads; everything else can overlap with it.
    const newDeps = node.dependsOn.filter((dep) => reads.includes(dep)).concat(reads.filter((id) => !node.dependsOn.includes(id)));
    const after = criticalPathMs(input, new Map(), new Map([[node.id, newDeps]]));
    const latencyMs = Math.round(after - baseline);
    if (-latencyMs < MIN_PARALLEL_GAIN_MS) continue;

    const step = stepForNode(input, node.id);
    const waitedFor = unused.map((id) => nodeName(input, id));
    const name = agentName(input, node.agentId);
    const readSources = Object.values(node.inputMapping ?? {});
    recommendations.push({
      id: `${EVALUATOR_ID}:parallelization:${node.id}`,
      evaluatorId: EVALUATOR_ID,
      category: "flow-design",
      title: `Run ${name} in parallel with ${waitedFor.join(" and ")}`,
      severity: -latencyMs / baseline > 0.2 ? "high" : "medium",
      target: { kind: "node", nodeId: node.id, agentId: node.agentId },
      problem: `${name} waits for ${waitedFor.join(" and ")} but never reads ${unused.length === 1 ? "its" : "their"} output, so the steps run back to back instead of at the same time.`,
      suggestion: `Make ${name} depend only on the steps it reads from${newDeps.length ? ` (${newDeps.map((id) => nodeName(input, id)).join(", ")})` : ""}, so it starts as soon as its inputs are ready.`,
      change: { type: "set-dependencies", path: `nodes.${node.id}.dependsOn`, before: node.dependsOn, after: newDeps },
      estimatedImpact: {
        speed: { latencyMs, stepLatencyMs: 0 },
        summary: `Run ~${formatSeconds(-latencyMs)} faster (${formatSeconds(baseline)} → ${formatSeconds(after)} critical path)`,
      },
      evidence: [
        `${name} reads: ${readSources.join(", ") || "nothing from other steps"}.`,
        ...(step?.startedAt
          ? [`${name} started ${formatSeconds(Date.parse(step.startedAt) - Date.parse(input.run.startedAt))} into the run and took ${formatSeconds(stepLatencyMs(step))}.`]
          : []),
      ],
    });
  }
  return recommendations;
}

/** Two nodes run the same agent, or receive the same inputs and produce the same output fields. */
function duplicatedWork(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const nodes = input.flow.nodes;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [a, b] = [nodes[i], nodes[j]];
      const sameAgent = a.agentId === b.agentId;
      const sameInputs = sameValues(a.inputMapping, b.inputMapping) && Object.keys(a.inputMapping ?? {}).length > 0;
      const sameOutputs = sameValues(schemaFields(agentOf(input, a)), schemaFields(agentOf(input, b)));
      if (!sameAgent && !(sameInputs && sameOutputs)) continue;

      const [nameA, nameB] = [nodeName(input, a.id), nodeName(input, b.id)];
      recommendations.push({
        id: `${EVALUATOR_ID}:duplicated-work:${a.id}:${b.id}`,
        evaluatorId: EVALUATOR_ID,
        category: "flow-design",
        title: `Merge ${nameA} and ${nameB}`,
        severity: "medium",
        target: { kind: "node", nodeId: b.id, agentId: b.agentId },
        problem: sameAgent
          ? `${a.id} and ${b.id} both run ${nameA}, so the same work happens twice in one run.`
          : `${nameA} and ${nameB} get the same inputs and produce the same output fields.`,
        suggestion: `Keep one of the two steps, or give each a distinct scope and input.`,
        change: { type: "merge-nodes", path: "nodes", before: [a.id, b.id], after: { keep: a.id } },
        estimatedImpact: { quality: { risk: "medium" }, summary: "Removes repeated work and conflicting outputs between steps." },
      });
    }
  }
  return recommendations;
}

/** Two agents' role descriptions overlap so much that it's unclear which one owns what. */
function unclearResponsibilities(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const nodes = input.flow.nodes;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [agentA, agentB] = [agentOf(input, nodes[i]), agentOf(input, nodes[j])];
      if (!agentA || !agentB || agentA.id === agentB.id) continue;
      const overlap = wordOverlap(agentA.role, agentB.role);
      if (overlap < ROLE_OVERLAP_THRESHOLD) continue;

      recommendations.push({
        id: `${EVALUATOR_ID}:unclear-responsibilities:${nodes[i].id}:${nodes[j].id}`,
        evaluatorId: EVALUATOR_ID,
        category: "flow-design",
        title: `Separate ${agentA.name}'s and ${agentB.name}'s roles`,
        severity: "low",
        target: { kind: "node", nodeId: nodes[j].id, agentId: agentB.id },
        problem: `${agentA.name} and ${agentB.name} have overlapping roles (${Math.round(overlap * 100)}% of role words shared), so it's unclear which one owns which part of the task.`,
        suggestion: `Rewrite ${agentB.name}'s role to state what it covers that ${agentA.name} does not.`,
        change: { type: "edit-role", path: `agents.${agentB.id}.role`, before: agentB.role, after: `${agentB.role} (excluding what ${agentA.name} covers)` },
        estimatedImpact: { quality: { risk: "low" }, summary: "Each step owns a clear part of the task, so handoffs stop overlapping." },
        evidence: [`${agentA.name}: "${agentA.role}"`, `${agentB.name}: "${agentB.role}"`],
      });
    }
  }
  return recommendations;
}

/** The flow ends without any step that checks the final output. */
function missingValidation(input: EvaluationInput): Recommendation[] {
  const terminals = input.flow.nodes.filter((n) => !input.flow.nodes.some((m) => m.dependsOn.includes(n.id)));
  const validates = terminals.some((n) => {
    const agent = agentOf(input, n);
    return VALIDATION_PATTERN.test(`${agent?.name ?? ""} ${agent?.role ?? ""}`);
  });
  if (validates || terminals.length === 0) return [];

  const last = terminals[0];
  return [
    {
      id: `${EVALUATOR_ID}:missing-validation`,
      evaluatorId: EVALUATOR_ID,
      category: "flow-design",
      title: "Add a validation step at the end",
      severity: "medium",
      target: { kind: "flow", flowId: input.flow.id },
      problem: `The flow ends with ${terminals.map((n) => nodeName(input, n.id)).join(", ")}, and none of them checks the final output before the run counts as done.`,
      suggestion: "Add a final step that validates the output against the task and fails the run if it doesn't hold up.",
      change: {
        type: "add-node",
        path: "nodes",
        before: null,
        after: { id: "validate", dependsOn: terminals.map((n) => n.id), responsibility: `Validate ${nodeName(input, last.id)}'s output against the task` },
      },
      estimatedImpact: { quality: { risk: "medium" }, summary: "The final output is checked before the run counts as done." },
    },
  ];
}

function schemaFields(agent: AgentDefinition | undefined): Record<string, string> | undefined {
  const properties = (agent?.outputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return properties ? Object.fromEntries(Object.keys(properties).map((k) => [k, k])) : undefined;
}

function sameValues(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  if (!a || !b) return false;
  const [va, vb] = [Object.values(a).sort(), Object.values(b).sort()];
  return va.length === vb.length && va.every((v, i) => v === vb[i]);
}

function wordOverlap(a: string, b: string): number {
  const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]+/g)?.filter((w) => !STOPWORDS.has(w)) ?? []);
  const [wa, wb] = [words(a), words(b)];
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union ? shared / union : 0;
}
