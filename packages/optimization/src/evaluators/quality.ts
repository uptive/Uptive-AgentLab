import type { AgentDefinition, Recommendation } from "@agentlab/contracts";
import { agentName, inputMappingOf, parseSource, stepForNode } from "../helpers.js";
import type { EvaluationInput, Evaluator } from "../types.js";

const EVALUATOR_ID = "quality";
const MIN_INSTRUCTION_WORDS = 15;
const MIN_TASK_WORDS = 10;

/** Rule-based: size/shape heuristics. Also the fallback for the LLM-backed evaluator. */
export const qualityEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Quality",
  category: "quality",
  async evaluate(input) {
    const brokenHandoffs = brokenHandoffRecommendations(input);
    const flaggedProducers = new Set(brokenHandoffs.map((r) => (r.target.kind === "node" ? r.target.agentId : "")));
    return [
      ...brokenHandoffs,
      ...missingOutputSchemas(input, flaggedProducers),
      ...vagueInstructions(input),
      ...underspecifiedTask(input),
    ];
  },
};

/** Walks a `<nodeId>.<path>` reference against the recorded run. Returns undefined when the source isn't a node output. */
export function resolveOutputPath(input: EvaluationInput, source: string): { nodeId: string; path: string[]; value: unknown } | undefined {
  const ref = parseSource(source);
  if (ref.kind !== "node" || !input.flow.nodes.some((n) => n.id === ref.nodeId)) return undefined;
  const { nodeId, path } = ref;
  let value: unknown = stepForNode(input, nodeId)?.output;
  for (const key of path) {
    value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  }
  return { nodeId, path, value };
}

/** Schema for `field`, borrowed from another agent that already outputs a field with that name. */
function schemaForField(input: EvaluationInput, field: string): { schema: unknown; borrowedFrom?: AgentDefinition } {
  for (const agent of input.agents) {
    const properties = (agent.outputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
    if (properties?.[field]) {
      return { schema: { type: "object", required: [field], properties: { [field]: properties[field] } }, borrowedFrom: agent };
    }
  }
  return { schema: { type: "object", required: [field], properties: { [field]: {} } } };
}

/** A downstream input mapping points at a field the upstream step never produced. */
export function brokenHandoffRecommendations(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const consumer of input.flow.nodes) {
    for (const [field, source] of Object.entries(inputMappingOf(input, consumer))) {
      const resolved = resolveOutputPath(input, source);
      if (!resolved || (resolved.value !== undefined && resolved.value !== null)) continue;

      const producerNode = input.flow.nodes.find((n) => n.id === resolved.nodeId);
      const producerStep = stepForNode(input, resolved.nodeId);
      // A producer that failed or never ran is a failed step, not a broken handoff.
      if (!producerNode || !producerStep || producerStep.status !== "completed") continue;
      const producer = input.agents.find((a) => a.id === producerNode.agentId);
      const producerName = agentName(input, producerNode.agentId);
      const consumerName = agentName(input, consumer.agentId);
      const actualShape =
        typeof producerStep.output === "string" ? `free text (${producerStep.output.length} characters)` : typeof producerStep.output;
      const expectedField = resolved.path[0] ?? "output";
      const { schema, borrowedFrom } = schemaForField(input, expectedField);

      recommendations.push({
        id: `${EVALUATOR_ID}:broken-handoff:${consumer.id}:${field}`,
        evaluatorId: EVALUATOR_ID,
        title: `Fix ${producerName} → ${consumerName} handoff`,
        category: "quality",
        tags: ["Handoff", "Output", "Validation"],
        severity: "high",
        target: { kind: "node", nodeId: producerNode.id, agentId: producerNode.agentId },
        problem: `${consumerName} expects \`${source}\` as \`${field}\`, but ${producerName} returned ${actualShape}. ${consumerName} ran with \`${field}\` empty, so its verdict ignores ${producerName}'s work.`,
        suggestion: `Give ${producerName} an output schema${borrowedFrom ? ` (same \`${expectedField}\` shape as ${borrowedFrom.name})` : ""} and tell it to respond only with JSON. Make ${consumerName} fail when a mapped input is missing instead of continuing.`,
        change: { type: "add-output-schema", path: "outputSchema", before: producer?.outputSchema ?? null, after: schema },
        estimatedImpact: {
          quality: { risk: "high" },
          summary: `${consumerName}'s verdict will include ${producerName}'s findings, which are currently dropped.`,
        },
        evidence: [
          `${consumerName} ran with \`${field}\` = ${JSON.stringify(resolved.value ?? null)}.`,
          producer?.outputSchema ? `${producerName} has an output schema, but its output did not match it.` : `${producerName} has no output schema.`,
        ],
      });
    }
  }
  return recommendations;
}

/** Agents whose output feeds other nodes but who have no output schema. */
function missingOutputSchemas(input: EvaluationInput, alreadyFlagged: Set<string>): Recommendation[] {
  return input.flow.nodes.flatMap<Recommendation>((node) => {
    const agent = input.agents.find((a) => a.id === node.agentId);
    const consumers = input.flow.nodes.filter((n) => n.dependsOn.includes(node.id));
    if (!agent || agent.outputSchema || consumers.length === 0 || alreadyFlagged.has(agent.id)) return [];
    return [
      {
        id: `${EVALUATOR_ID}:missing-output-schema:${node.id}`,
        evaluatorId: EVALUATOR_ID,
        title: `Add an output schema to ${agent.name}`,
        category: "quality",
        tags: ["Output", "Handoff"],
        severity: "medium",
        target: { kind: "node", nodeId: node.id, agentId: agent.id },
        problem: `${agent.name} feeds ${consumers.map((n) => agentName(input, n.agentId)).join(", ")} but has no output schema, so downstream steps must parse free text.`,
        suggestion: `Define an output schema matching the fields its consumers map from it.`,
        change: { type: "add-output-schema", path: "outputSchema", before: null, after: { type: "object", properties: {} } },
        estimatedImpact: { quality: { risk: "medium" }, summary: "Makes handoffs to downstream steps machine-checkable." },
      },
    ];
  });
}

/** System instructions too short to define scope, evidence or output format. */
function vagueInstructions(input: EvaluationInput): Recommendation[] {
  return input.flow.nodes.flatMap<Recommendation>((node) => {
    const agent = input.agents.find((a) => a.id === node.agentId);
    if (!agent) return [];
    const words = wordCount(agent.systemInstructions);
    if (words >= MIN_INSTRUCTION_WORDS) return [];
    return [
      {
        id: `${EVALUATOR_ID}:vague-instructions:${node.id}`,
        evaluatorId: EVALUATOR_ID,
        title: `Rewrite ${agent.name}'s instructions`,
        category: "quality",
        tags: ["Instructions", "Output"],
        severity: "medium",
        target: { kind: "node", nodeId: node.id, agentId: agent.id },
        problem: `${agent.name}'s instructions are ${words} words and don't say what to check, how to rate severity or what format to answer in.`,
        suggestion: `Spell out a checklist, a severity scale, a requirement to cite file and line, and the output format.`,
        change: { type: "edit-instructions", path: "systemInstructions", before: agent.systemInstructions, after: proposedInstructions(agent) },
        estimatedImpact: { quality: { risk: "medium" }, summary: "More consistent, complete and parseable output from this step." },
        evidence: [`Other agents in this flow average ${averageInstructionWords(input)} words of instructions.`],
      },
    ];
  });
}

/** The run's task is too thin for agents to know what "done" means. */
function underspecifiedTask(input: EvaluationInput): Recommendation[] {
  const roots = input.flow.nodes.filter((n) => n.dependsOn.length === 0);
  return roots.flatMap<Recommendation>((node) => {
    const step = stepForNode(input, node.id);
    const task = (step?.input as Record<string, unknown> | undefined)?.task;
    if (typeof task !== "string") return [];
    const words = wordCount(task);
    if (words >= MIN_TASK_WORDS) return [];
    return [
      {
        id: `${EVALUATOR_ID}:underspecified-task:${node.id}`,
        evaluatorId: EVALUATOR_ID,
        title: "Add acceptance criteria to the run input",
        category: "quality",
        tags: ["Input", "Validation"],
        severity: "low",
        target: { kind: "node", nodeId: node.id, agentId: node.agentId },
        problem: `The run started from a ${words}-word task ("${task}") with no acceptance criteria, risk areas or merge bar, so each agent guesses what matters.`,
        suggestion: `Add structured fields to the run input and have ${agentName(input, node.agentId)} pass them on in its plan.`,
        change: {
          type: "extend-run-input",
          path: "$input",
          before: { task },
          after: { task, acceptanceCriteria: ["…"], riskAreas: ["…"], blockingSeverity: "high" },
        },
        estimatedImpact: { quality: { risk: "low" }, summary: "Reviewers and validator judge against the same, explicit bar." },
      },
    ];
  });
}

function proposedInstructions(agent: AgentDefinition): string {
  const checklist = /security/i.test(agent.role)
    ? "secrets or tokens written to logs; token generation, expiry and reuse; account enumeration through responses; missing rate limiting; injection"
    : "<what this step must check>";
  return [
    `You are a ${agent.name.toLowerCase()}. ${agent.role}`,
    `Check: ${checklist}.`,
    "Only report issues you can point to in the input. For each finding give file, line, severity (high/medium/low), the problem and a concrete fix.",
    "Respond only with JSON matching the output schema.",
  ].join("\n");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

function averageInstructionWords(input: EvaluationInput): number {
  const counts = input.agents.map((a) => wordCount(a.systemInstructions)).filter((n) => n >= MIN_INSTRUCTION_WORDS);
  return counts.length ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length) : 0;
}
